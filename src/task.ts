import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  InMemoryTaskStore,
  InMemoryTaskMessageQueue,
  type Task,
  type CreateTaskRequestHandlerExtra,
} from "@modelcontextprotocol/sdk/experimental/tasks";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { loadCommands } from "./config.js";
import { executeCommand } from "./executor.js";
import type { Logger } from "./logger.js";

const CONFIG_PATH = process.env.EXO_COMMAND_FILE || "./.exocommand";

// Subclass InMemoryTaskStore to abort running processes on task cancellation.
// The SDK calls updateTaskStatus("cancelled") when a tasks/cancel request arrives.
class ExoTaskStore extends InMemoryTaskStore {
  private _controllers: Map<string, AbortController>;

  constructor(controllers: Map<string, AbortController>) {
    super();
    this._controllers = controllers;
  }

  override async updateTaskStatus(
    taskId: string,
    status: Task["status"],
    statusMessage?: string,
    sessionId?: string,
  ): Promise<void> {
    await super.updateTaskStatus(taskId, status, statusMessage, sessionId);
    if (status === "cancelled") {
      const ac = this._controllers.get(taskId);
      if (ac) {
        ac.abort();
        this._controllers.delete(taskId);
      }
    }
  }
}

interface BackgroundExecutionParams {
  taskId: string;
  commandName: string;
  command: string;
  cwd?: string;
  signal: AbortSignal;
  timeoutSignal?: AbortSignal;
  timeout?: number;
  taskStore: CreateTaskRequestHandlerExtra["taskStore"];
  server: McpServer;
  logger: Logger;
  activeExecutions: Map<string, AbortController>;
}

async function runBackgroundExecution(
  params: BackgroundExecutionParams,
): Promise<void> {
  const {
    taskId, commandName, command, cwd, signal, timeoutSignal, timeout,
    taskStore, server, logger, activeExecutions,
  } = params;

  const lines: string[] = [];
  let lineCount = 0;

  const log = async (
    level: "info" | "error",
    loggerName: string,
    data: string,
  ): Promise<void> => {
    lineCount++;
    lines.push(`[${loggerName}] ${data}`);

    try {
      await taskStore.updateTaskStatus(
        taskId,
        "working",
        `${lineCount} line(s) | ${loggerName}: ${data}`,
      );
    } catch {
      // task may have been cancelled or reached a terminal state
    }

    try {
      await server.sendLoggingMessage({ level, logger: loggerName, data });
    } catch {
      // client may have disconnected
    }
  };

  try {
    const result = await executeCommand(command, log, signal, cwd);
    const output = lines.join("\n");

    if (result.killed) {
      // Check if the task was already cancelled via tasks/cancel
      let task: Task | undefined;
      try {
        task = await taskStore.getTask(taskId);
      } catch {
        // task may have been cleaned up
      }

      if (task?.status === "cancelled") {
        logger.warn("execute", `"${commandName}" was cancelled`);
        return;
      }

      const timedOut = timeoutSignal?.aborted ?? false;
      const status = timedOut
        ? `Command "${commandName}" timed out after ${timeout}s.`
        : `Command "${commandName}" was cancelled.`;

      logger.warn(
        "execute",
        `"${commandName}" ${timedOut ? "timed out" : "was cancelled"}`,
      );
      await taskStore.storeTaskResult(taskId, "failed", {
        content: [{
          type: "text" as const,
          text: output ? `${status}\n\nOutput:\n${output}` : status,
        }],
        isError: true,
      });
      return;
    }

    if (result.exitCode !== 0) {
      const status = `Command "${commandName}" exited with code ${result.exitCode}`;
      logger.error(
        "execute",
        `"${commandName}" exited with code ${result.exitCode}`,
      );
      await taskStore.storeTaskResult(taskId, "failed", {
        content: [{
          type: "text" as const,
          text: output ? `${status}\n\nOutput:\n${output}` : status,
        }],
        isError: true,
      });
      return;
    }

    logger.success("execute", `"${commandName}" completed (exit code 0)`);
    await taskStore.storeTaskResult(taskId, "completed", {
      content: [{
        type: "text" as const,
        text: output
          ? `Command "${commandName}" completed successfully (exit code 0)\n\nOutput:\n${output}`
          : `Command "${commandName}" completed successfully (exit code 0)`,
      }],
    });
  } catch (err) {
    const output = lines.join("\n");
    const status = `Command "${commandName}" failed: ${(err as Error).message}`;
    logger.error(
      "execute",
      `"${commandName}" failed: ${(err as Error).message}`,
    );
    await taskStore.storeTaskResult(taskId, "failed", {
      content: [{
        type: "text" as const,
        text: output ? `${status}\n\nOutput:\n${output}` : status,
      }],
      isError: true,
    });
  } finally {
    activeExecutions.delete(taskId);
  }
}

export interface TaskContext {
  taskStore: ExoTaskStore;
  taskMessageQueue: InMemoryTaskMessageQueue;
  capabilities: {
    tasks: {
      list: Record<string, never>;
      cancel: Record<string, never>;
      requests: { tools: { call: Record<string, never> } };
    };
  };
}

export function createTaskContext(
  activeExecutions: Map<string, AbortController>,
): TaskContext {
  return {
    taskStore: new ExoTaskStore(activeExecutions),
    taskMessageQueue: new InMemoryTaskMessageQueue(),
    capabilities: {
      tasks: {
        list: {},
        cancel: {},
        requests: { tools: { call: {} } },
      },
    },
  };
}

export function registerTaskExecute(
  server: McpServer,
  logger: Logger,
  activeExecutions: Map<string, AbortController>,
): void {
  server.experimental.tasks.registerToolTask(
    "execute",
    {
      title: "Execute Command",
      description:
        "Execute a predefined command by name. Streams stdout and stderr via logging notifications and task status updates.",
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
      execution: { taskSupport: "optional" },
    },
    {
      createTask: async ({ name: commandName, timeout }, extra) => {
        logger.warn("execute", `running "${commandName}"`);

        // Validate before creating a task — throw to fail without a zombie task
        let commands;
        try {
          commands = await loadCommands(CONFIG_PATH);
        } catch (err) {
          throw new Error(
            `Error loading config: ${(err as Error).message}`,
          );
        }

        const cmd = commands.find((c) => c.name === commandName);
        if (!cmd) {
          const available = commands.map((c) => c.name).join(", ");
          throw new Error(
            `Command "${commandName}" not found. Available commands: ${available}`,
          );
        }

        const task = await extra.taskStore.createTask({
          ttl: extra.taskRequestedTtl !== undefined
            ? extra.taskRequestedTtl
            : 300_000,
          pollInterval: 1000,
        });

        // Compose abort signal from cancellation + optional timeout
        const ac = new AbortController();
        activeExecutions.set(task.taskId, ac);

        // Wire the request signal so auto-polling cancellation propagates
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

        // Fire and forget — errors are stored in the task store
        runBackgroundExecution({
          taskId: task.taskId,
          commandName,
          command: cmd.command,
          cwd: cmd.cwd,
          signal: combinedSignal,
          timeoutSignal,
          timeout,
          taskStore: extra.taskStore,
          server,
          logger,
          activeExecutions,
        }).catch(() => {
          // errors are stored in the task store, not propagated here
        });

        return { task };
      },

      getTask: async (_args, extra) => {
        return await extra.taskStore.getTask(extra.taskId);
      },

      getTaskResult: async (_args, extra) => {
        return (await extra.taskStore.getTaskResult(
          extra.taskId,
        )) as CallToolResult;
      },
    },
  );
}
