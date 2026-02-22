import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { loadCommands } from "./config.js";
import { executeCommand } from "./executor.js";
import type { Logger } from "./logger.js";

const CONFIG_PATH = process.env.EXO_COMMAND_FILE || "./.exocommand";

export function createServer(logger: Logger): McpServer {
  const server = new McpServer(
    {
      name: "exocommand",
      version: "1.0.0",
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

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

  server.registerTool(
    "execute",
    {
      title: "Execute Command",
      description:
        "Execute a predefined command by name. Streams stdout and stderr via logging notifications.",
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
          content: [
            {
              type: "text" as const,
              text: `Error loading config: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }

      const cmd = commands.find((c) => c.name === commandName);
      if (!cmd) {
        const available = commands.map((c) => c.name).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: `Command "${commandName}" not found. Available commands: ${available}`,
            },
          ],
          isError: true,
        };
      }

      const signal = timeout
        ? AbortSignal.any([extra.signal, AbortSignal.timeout(timeout * 1000)])
        : extra.signal;

      const lines: string[] = [];
      const log = async (
        level: "info" | "error",
        loggerName: string,
        data: string,
      ) => {
        lines.push(`[${loggerName}] ${data}`);
        await extra.sendNotification({
          method: "notifications/message",
          params: { level, logger: loggerName, data },
        });
      };

      try {
        const result = await executeCommand(cmd.command, log, signal, cmd.cwd);
        const output = lines.join("\n");

        if (result.killed) {
          const timedOut = timeout && !extra.signal.aborted;
          const status = timedOut
            ? `Command "${commandName}" timed out after ${timeout}s.`
            : `Command "${commandName}" was cancelled.`;

          logger.warn("execute", `"${commandName}" ${timedOut ? "timed out" : "was cancelled"}`);
          return {
            content: [
              {
                type: "text" as const,
                text: output ? `${status}\n\nOutput:\n${output}` : status,
              },
            ],
            isError: true,
          };
        }

        if (result.exitCode !== 0) {
          const status = `Command "${commandName}" exited with code ${result.exitCode}`;
          logger.error("execute", `"${commandName}" exited with code ${result.exitCode}`);
          return {
            content: [
              {
                type: "text" as const,
                text: output ? `${status}\n\nOutput:\n${output}` : status,
              },
            ],
            isError: true,
          };
        }

        logger.success("execute", `"${commandName}" completed (exit code 0)`);
        return {
          content: [
            {
              type: "text" as const,
              text: output
                ? `Command "${commandName}" completed successfully (exit code 0)\n\nOutput:\n${output}`
                : `Command "${commandName}" completed successfully (exit code 0)`,
            },
          ],
        };
      } catch (err) {
        const output = lines.join("\n");
        const status = `Command "${commandName}" failed: ${(err as Error).message}`;
        logger.error("execute", `"${commandName}" failed: ${(err as Error).message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: output ? `${status}\n\nOutput:\n${output}` : status,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}
