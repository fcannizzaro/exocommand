import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

interface ExecutionResult {
  exitCode: number;
  killed: boolean;
}

export type LogCallback = (
  level: "info" | "error",
  logger: string,
  data: string
) => Promise<void>;

export async function executeCommand(
  command: string,
  log: LogCallback,
  signal: AbortSignal,
  cwd?: string,
): Promise<ExecutionResult> {
  if (signal.aborted) {
    return { exitCode: -1, killed: true };
  }

  const proc: ChildProcess = spawn("sh", ["-c", command], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    cwd,
  });

  const onAbort = () => {
    // Kill the entire process group to ensure child processes are also terminated
    if (proc.pid) {
      try {
        process.kill(-proc.pid, "SIGTERM");
      } catch {
        // process may have already exited
      }
    }
  };
  signal.addEventListener("abort", onAbort, { once: true });

  const streamLines = (
    stream: Readable,
    logger: "stdout" | "stderr"
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const decoder = new TextDecoder();
      let buffer = "";
      let settled = false;
      let pending = Promise.resolve();

      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      stream.on("data", (chunk: Buffer) => {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          if (line.length > 0) {
            const level = logger === "stderr" ? "error" : "info";
            pending = pending.then(() => log(level, logger, line));
          }
        }
      });

      stream.on("end", () => {
        // flush remaining buffer, then settle after all pending logs
        if (buffer.length > 0) {
          const level = logger === "stderr" ? "error" : "info";
          pending = pending.then(() => log(level, logger, buffer));
        }
        pending.then(settle);
      });

      // When a process is killed, streams may emit 'close' without 'end'
      stream.on("close", () => {
        pending.then(settle);
      });

      stream.on("error", () => {
        // stream may error if process is killed; ignore when aborted
        if (!signal.aborted) {
          reject(new Error(`Error reading ${logger} stream`));
        } else {
          pending.then(settle);
        }
      });
    });
  };

  // Set up exit code promise eagerly, before consuming streams,
  // to avoid missing the 'close' event.
  const exitPromise = new Promise<number>((resolve) => {
    proc.on("close", (code) => {
      resolve(code ?? 1);
    });
  });

  await Promise.all([
    streamLines(proc.stdout!, "stdout"),
    streamLines(proc.stderr!, "stderr"),
  ]);

  const exitCode = await exitPromise;

  signal.removeEventListener("abort", onAbort);

  return {
    exitCode,
    killed: signal.aborted,
  };
}
