import { test, expect, describe } from "bun:test";
import { parseArgs } from "./cli";

describe("parseArgs", () => {
  test("no args returns serve action", () => {
    const result = parseArgs(["node", "exocommand"]);
    expect(result).toEqual({ kind: "serve" });
  });

  test("add with path returns add action", () => {
    const result = parseArgs(["node", "exocommand", "add", "."]);
    expect(result).toEqual({ kind: "add", path: "." });
  });

  test("add with absolute path returns add action", () => {
    const result = parseArgs(["node", "exocommand", "add", "/home/user/project/.exocommand"]);
    expect(result).toEqual({ kind: "add", path: "/home/user/project/.exocommand" });
  });

  test("add without path throws", () => {
    expect(() => parseArgs(["node", "exocommand", "add"])).toThrow(
      "Usage: exocommand add <path-to-.exocommand-or-directory>",
    );
  });

  test("ls returns ls action", () => {
    const result = parseArgs(["node", "exocommand", "ls"]);
    expect(result).toEqual({ kind: "ls" });
  });

  test("rm with key returns rm action", () => {
    const result = parseArgs(["node", "exocommand", "rm", "a1b2c3d4e5f6"]);
    expect(result).toEqual({ kind: "rm", target: "a1b2c3d4e5f6" });
  });

  test("rm with path returns rm action", () => {
    const result = parseArgs(["node", "exocommand", "rm", "."]);
    expect(result).toEqual({ kind: "rm", target: "." });
  });

  test("rm with absolute path returns rm action", () => {
    const result = parseArgs(["node", "exocommand", "rm", "/home/user/project"]);
    expect(result).toEqual({ kind: "rm", target: "/home/user/project" });
  });

  test("rm without target throws", () => {
    expect(() => parseArgs(["node", "exocommand", "rm"])).toThrow(
      "Usage: exocommand rm <access-key-or-path>",
    );
  });

  test("init returns init action", () => {
    const result = parseArgs(["node", "exocommand", "init"]);
    expect(result).toEqual({ kind: "init" });
  });

  test("unknown subcommand throws", () => {
    expect(() => parseArgs(["node", "exocommand", "unknown"])).toThrow(
      'Unknown subcommand "unknown". Available: add, init, ls, rm',
    );
  });
});


