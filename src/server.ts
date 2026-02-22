import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { loadCommands } from "./config.js";
import { executeCommand } from "./executor.js";
import type { Logger } from "./logger.js";

const CONFIG_PATH = process.env.EXO_COMMAND_FILE || "./.exocommand";

export interface CreateServerOptions {
  taskMode?: boolean;
}

export function createServer(
  logger: Logger,
  options?: CreateServerOptions,
): McpServer {
  const taskMode = options?.taskMode ?? false;
  const activeExecutions = new Map<string, AbortController>();

  // Build server options conditionally based on mode
  const serverOptions = taskMode
    ? buildTaskServerOptions(activeExecutions)
    : { capabilities: { logging: {} } };

  const server = new McpServer(
    {
      name: "exocommand",
      version: "1.0.0",
    },
    serverOptions,
  );

  // Abort all running commands when the session closes
  server.server.onclose = () => {
    for (const ac of activeExecutions.values()) {
      ac.abort();
    }
    activeExecutions.clear();
    if (taskMode && "taskStore" in serverOptions) {
      (serverOptions.taskStore as { cleanup(): void }).cleanup();
    }
  };

  server.registerTool(
    "listCommands",
    {
      title: "List Commands",
      description:
        "List all available commands defined in the .exocommand config file",
    },
    async () => {
      try {
        const commands = await loadCommands(CONFIG_PATH);
        logger.info("listCommands", `found ${commands.length} command(s)`);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                commands.map((c) => ({
                  name: c.name,
                  description: c.description,
                  command: c.command,
                  ...(c.cwd ? { cwd: c.cwd } : {}),
                })),
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error loading commands: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  if (taskMode) {
    registerTaskMode(server, logger, activeExecutions);
  } else {
    registerSyncMode(server, logger, activeExecutions);
  }

  return server;
}

// -- Task mode: delegate to src/task.ts -----------------------------------

function buildTaskServerOptions(
  activeExecutions: Map<string, AbortController>,
): Record<string, unknown> {
  // Dynamic import at call-time would be async; instead we import eagerly
  // but only call when taskMode is true. The import is at module level below.
  const ctx = getTaskContext(activeExecutions);
  return {
    capabilities: {
      logging: {},
      ...ctx.capabilities,
    },
    taskStore: ctx.taskStore,
    taskMessageQueue: ctx.taskMessageQueue,
    defaultTaskPollInterval: 1000,
  };
}

function registerTaskMode(
  server: McpServer,
  logger: Logger,
  activeExecutions: Map<string, AbortController>,
): void {
  // Lazy-loaded to avoid pulling task dependencies when not needed
  const { registerTaskExecute } = require("./task.js") as typeof import("./task.js");
  registerTaskExecute(server, logger, activeExecutions);
}

function getTaskContext(
  activeExecutions: Map<string, AbortController>,
): import("./task.js").TaskContext {
  const { createTaskContext } = require("./task.js") as typeof import("./task.js");
  return createTaskContext(activeExecutions);
}

// -- Sync mode: streaming via extra.sendNotification() --------------------

function registerSyncMode(
  server: McpServer,
  logger: Logger,
  activeExecutions: Map<string, AbortController>,
): void {
  server.registerTool(
    "execute",
    {
      title: "Execute Command",
      description:
        "Execute a predefined command by name. Streams stdout and stderr line-by-line as logging notifications on the response stream.",
      inputSchema: {
        name: z.string().describe("The command name/id to execute"),
        timeout: z
          .number()
          .positive()
          .optional()
          .describe(
            "Maximum execution time in seconds. If exceeded, the command is killed and buffered output is returned.",
          ),
      },
    },
    async ({ name: commandName, timeout }, extra) => {
      logger.warn("execute", `running "${commandName}"`);

      let commands;
      try {
        commands = await loadCommands(CONFIG_PATH);
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `Error loading config: ${(err as Error).message}`,
          }],
          isError: true,
        };
      }

      const cmd = commands.find((c) => c.name === commandName);
      if (!cmd) {
        const available = commands.map((c) => c.name).join(", ");
        return {
          content: [{
            type: "text" as const,
            text: `Command "${commandName}" not found. Available commands: ${available}`,
          }],
          isError: true,
        };
      }

      const executionId = crypto.randomUUID();
      const ac = new AbortController();
      activeExecutions.set(executionId, ac);

      // Propagate request cancellation
      if (!extra.signal.aborted) {
        extra.signal.addEventListener("abort", () => ac.abort(), {
          once: true,
        });
      }

      const timeoutSignal = timeout
        ? AbortSignal.timeout(timeout * 1000)
        : undefined;
      const combinedSignal = timeoutSignal
        ? AbortSignal.any([ac.signal, timeoutSignal])
        : ac.signal;

      const lines: string[] = [];

      const log = async (
        level: "info" | "error",
        loggerName: string,
        data: string,
      ): Promise<void> => {
        lines.push(`[${loggerName}] ${data}`);

        // Route through the POST SSE stream via relatedRequestId
        try {
          await extra.sendNotification({
            method: "notifications/message",
            params: { level, logger: loggerName, data },
          } as ServerNotification);
        } catch {
          // client may have disconnected
        }
      };

      try {
        const result = await executeCommand(
          cmd.command,
          log,
          combinedSignal,
          cmd.cwd,
        );
        const output = lines.join("\n");

        if (result.killed) {
          const timedOut = timeoutSignal?.aborted ?? false;
          const status = timedOut
            ? `Command "${commandName}" timed out after ${timeout}s.`
            : `Command "${commandName}" was cancelled.`;

          logger.warn(
            "execute",
            `"${commandName}" ${timedOut ? "timed out" : "was cancelled"}`,
          );
          return {
            content: [{
              type: "text" as const,
              text: output ? `${status}\n\nOutput:\n${output}` : status,
            }],
            isError: true,
          };
        }

        if (result.exitCode !== 0) {
          const status = `Command "${commandName}" exited with code ${result.exitCode}`;
          logger.error(
            "execute",
            `"${commandName}" exited with code ${result.exitCode}`,
          );
          return {
            content: [{
              type: "text" as const,
              text: output ? `${status}\n\nOutput:\n${output}` : status,
            }],
            isError: true,
          };
        }

        logger.success("execute", `"${commandName}" completed (exit code 0)`);
        return {
          content: [{
            type: "text" as const,
            text: output
              ? `Command "${commandName}" completed successfully (exit code 0)\n\nOutput:\n${output}`
              : `Command "${commandName}" completed successfully (exit code 0)`,
          }],
        };
      } catch (err) {
        const output = lines.join("\n");
        const status = `Command "${commandName}" failed: ${(err as Error).message}`;
        logger.error(
          "execute",
          `"${commandName}" failed: ${(err as Error).message}`,
        );
        return {
          content: [{
            type: "text" as const,
            text: output ? `${status}\n\nOutput:\n${output}` : status,
          }],
          isError: true,
        };
      } finally {
        activeExecutions.delete(executionId);
      }
    },
  );
}
