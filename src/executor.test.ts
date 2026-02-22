import { test, expect, describe } from "bun:test";
import { executeCommand, type LogCallback } from "./executor";

type LogEntry = { level: "info" | "error"; logger: string; data: string };

function createLogCollector(): { log: LogCallback; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const log: LogCallback = async (level, logger, data) => {
    entries.push({ level, logger, data });
  };
  return { log, entries };
}

describe("executeCommand", () => {
  test("runs a simple command and captures output", async () => {
    const { log, entries } = createLogCollector();
    const ac = new AbortController();

    const result = await executeCommand("echo hello", log, ac.signal);

    expect(result.exitCode).toBe(0);
    expect(result.killed).toBe(false);
    expect(entries).toContainEqual({
      level: "info",
      logger: "stdout",
      data: "hello",
    });
  });

  test("returns non-zero exit code", async () => {
    const { log } = createLogCollector();
    const ac = new AbortController();

    const result = await executeCommand("exit 42", log, ac.signal);

    expect(result.exitCode).toBe(42);
    expect(result.killed).toBe(false);
  });

  test("captures stderr with correct level", async () => {
    const { log, entries } = createLogCollector();
    const ac = new AbortController();

    const result = await executeCommand("echo err >&2", log, ac.signal);

    expect(result.exitCode).toBe(0);
    expect(entries).toContainEqual({
      level: "error",
      logger: "stderr",
      data: "err",
    });
  });

  test("captures mixed stdout and stderr", async () => {
    const { log, entries } = createLogCollector();
    const ac = new AbortController();

    const result = await executeCommand(
      'echo out && echo err >&2',
      log,
      ac.signal,
    );

    expect(result.exitCode).toBe(0);

    const stdoutEntries = entries.filter((e) => e.logger === "stdout");
    const stderrEntries = entries.filter((e) => e.logger === "stderr");

    expect(stdoutEntries.length).toBeGreaterThanOrEqual(1);
    expect(stderrEntries.length).toBeGreaterThanOrEqual(1);
    expect(stdoutEntries.some((e) => e.data === "out")).toBe(true);
    expect(stderrEntries.some((e) => e.data === "err")).toBe(true);
  });

  test("produces no log entries for silent command", async () => {
    const { log, entries } = createLogCollector();
    const ac = new AbortController();

    const result = await executeCommand("true", log, ac.signal);

    expect(result.exitCode).toBe(0);
    expect(entries).toHaveLength(0);
  });

  test("captures multiline output as separate entries", async () => {
    const { log, entries } = createLogCollector();
    const ac = new AbortController();

    const result = await executeCommand(
      'echo "line1" && echo "line2" && echo "line3"',
      log,
      ac.signal,
    );

    expect(result.exitCode).toBe(0);

    const stdoutData = entries
      .filter((e) => e.logger === "stdout")
      .map((e) => e.data);
    expect(stdoutData).toEqual(["line1", "line2", "line3"]);
  });

  test("returns immediately with pre-aborted signal", async () => {
    const { log, entries } = createLogCollector();
    const ac = new AbortController();
    ac.abort();

    const result = await executeCommand("echo should-not-run", log, ac.signal);

    expect(result.exitCode).toBe(-1);
    expect(result.killed).toBe(true);
    expect(entries).toHaveLength(0);
  });

  test("kills process on abort during execution", async () => {
    const { log } = createLogCollector();
    const ac = new AbortController();

    const promise = executeCommand(
      "while true; do echo tick; sleep 0.1; done",
      log,
      ac.signal,
    );

    // Wait a moment for the process to start, then abort
    await new Promise((r) => setTimeout(r, 200));
    ac.abort();

    const result = await promise;

    expect(result.killed).toBe(true);
  }, 10000);

  test("does not log empty lines", async () => {
    const { log, entries } = createLogCollector();
    const ac = new AbortController();

    const result = await executeCommand(
      'echo "a" && echo "" && echo "b"',
      log,
      ac.signal,
    );

    expect(result.exitCode).toBe(0);

    const stdoutData = entries
      .filter((e) => e.logger === "stdout")
      .map((e) => e.data);
    expect(stdoutData).toEqual(["a", "b"]);
  });

  test("flushes output without trailing newline", async () => {
    const { log, entries } = createLogCollector();
    const ac = new AbortController();

    const result = await executeCommand("printf 'no-newline'", log, ac.signal);

    expect(result.exitCode).toBe(0);
    expect(entries).toContainEqual({
      level: "info",
      logger: "stdout",
      data: "no-newline",
    });
  });

  test("runs command in specified cwd", async () => {
    const { log, entries } = createLogCollector();
    const ac = new AbortController();

    const result = await executeCommand("pwd", log, ac.signal, "/tmp");

    expect(result.exitCode).toBe(0);
    expect(result.killed).toBe(false);

    const output = entries
      .filter((e) => e.logger === "stdout")
      .map((e) => e.data);

    // /tmp may resolve to /private/tmp on macOS
    expect(output.some((line) => line.includes("tmp"))).toBe(true);
  });

  test("runs command in default cwd when cwd is undefined", async () => {
    const { log, entries } = createLogCollector();
    const ac = new AbortController();

    const result = await executeCommand("pwd", log, ac.signal, undefined);

    expect(result.exitCode).toBe(0);
    expect(entries.length).toBeGreaterThan(0);
  });
});
