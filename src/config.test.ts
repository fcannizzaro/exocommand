import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { loadConfig, loadCommands } from "./config";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "exocommand-test-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeConfig(name: string, content: string): Promise<string> {
  const path = join(tmpDir, name);
  await Bun.write(path, content);
  return path;
}

describe("loadConfig", () => {
  test("parses valid config with commands", async () => {
    const path = await writeConfig(
      "valid.yaml",
      `
hello:
  description: "Print hello"
  command: "echo hello"
build:
  description: "Run build"
  command: "bun run build"
`,
    );

    const config = await loadConfig(path);
    expect(config.port).toBeUndefined();
    expect(config.commands).toHaveLength(2);
    expect(config.commands[0]).toEqual({
      name: "hello",
      description: "Print hello",
      command: "echo hello",
    });
    expect(config.commands[1]).toEqual({
      name: "build",
      description: "Run build",
      command: "bun run build",
    });
  });

  test("parses valid port", async () => {
    const path = await writeConfig(
      "port-valid.yaml",
      `
port: 8080
hello:
  description: "hi"
  command: "echo hi"
`,
    );

    const config = await loadConfig(path);
    expect(config.port).toBe(8080);
  });

  test("accepts port boundary values", async () => {
    const pathMin = await writeConfig("port-min.yaml", "port: 1\n");
    const pathMax = await writeConfig("port-max.yaml", "port: 65535\n");

    expect((await loadConfig(pathMin)).port).toBe(1);
    expect((await loadConfig(pathMax)).port).toBe(65535);
  });

  test("rejects port 0", async () => {
    const path = await writeConfig("port-zero.yaml", "port: 0\n");
    expect(loadConfig(path)).rejects.toThrow("Invalid port");
  });

  test("rejects port above 65535", async () => {
    const path = await writeConfig("port-high.yaml", "port: 65536\n");
    expect(loadConfig(path)).rejects.toThrow("Invalid port");
  });

  test("rejects non-numeric port", async () => {
    const path = await writeConfig("port-abc.yaml", 'port: "abc"\n');
    expect(loadConfig(path)).rejects.toThrow("Invalid port");
  });

  test("rejects float port", async () => {
    const path = await writeConfig("port-float.yaml", "port: 3.14\n");
    expect(loadConfig(path)).rejects.toThrow("Invalid port");
  });

  test("port key is not treated as a command", async () => {
    const path = await writeConfig(
      "port-reserved.yaml",
      `
port: 3000
hello:
  description: "hi"
  command: "echo hi"
`,
    );

    const config = await loadConfig(path);
    expect(config.commands).toHaveLength(1);
    expect(config.commands[0]!.name).toBe("hello");
  });

  test("accepts valid command names", async () => {
    const path = await writeConfig(
      "names-valid.yaml",
      `
hello:
  description: "a"
  command: "echo a"
my-cmd:
  description: "b"
  command: "echo b"
test_123:
  description: "c"
  command: "echo c"
`,
    );

    const config = await loadConfig(path);
    expect(config.commands).toHaveLength(3);
    expect(config.commands.map((c) => c.name)).toEqual([
      "hello",
      "my-cmd",
      "test_123",
    ]);
  });

  test("rejects command name with spaces", async () => {
    const path = await writeConfig(
      "name-space.yaml",
      `
"has space":
  description: "x"
  command: "echo x"
`,
    );
    expect(loadConfig(path)).rejects.toThrow("Invalid command name");
  });

  test("rejects command name with dots", async () => {
    const path = await writeConfig(
      "name-dot.yaml",
      `
"has.dot":
  description: "x"
  command: "echo x"
`,
    );
    expect(loadConfig(path)).rejects.toThrow("Invalid command name");
  });

  test("rejects command missing description", async () => {
    const path = await writeConfig(
      "no-desc.yaml",
      `
broken:
  command: "echo x"
`,
    );
    expect(loadConfig(path)).rejects.toThrow('Invalid command "broken"');
  });

  test("rejects command missing command field", async () => {
    const path = await writeConfig(
      "no-cmd.yaml",
      `
broken:
  description: "x"
`,
    );
    expect(loadConfig(path)).rejects.toThrow('Invalid command "broken"');
  });

  test("rejects command with wrong types", async () => {
    const path = await writeConfig(
      "wrong-type.yaml",
      `
broken:
  description: 123
  command: "echo x"
`,
    );
    expect(loadConfig(path)).rejects.toThrow('Invalid command "broken"');
  });

  test("throws on file not found", async () => {
    expect(loadConfig("/nonexistent/path/.exocommand")).rejects.toThrow(
      "Config file not found",
    );
  });

  test("throws on empty file", async () => {
    const path = await writeConfig("empty.yaml", "");
    expect(loadConfig(path)).rejects.toThrow("expected a YAML mapping");
  });

  test("throws on non-object YAML (string)", async () => {
    const path = await writeConfig("string.yaml", '"hello"');
    expect(loadConfig(path)).rejects.toThrow("expected a YAML mapping");
  });

  test("throws on non-object YAML (number)", async () => {
    const path = await writeConfig("number.yaml", "42");
    expect(loadConfig(path)).rejects.toThrow("expected a YAML mapping");
  });

  test("throws on non-object YAML (array)", async () => {
    const path = await writeConfig("array.yaml", "- one\n- two\n");
    expect(loadConfig(path)).rejects.toThrow("Invalid command");
  });

  test("preserves multiline block scalar command", async () => {
    const path = await writeConfig(
      "multiline.yaml",
      `
deploy:
  description: "Deploy"
  command: |
    echo "step 1"
    echo "step 2"
`,
    );

    const config = await loadConfig(path);
    expect(config.commands[0]!.command).toBe('echo "step 1"\necho "step 2"');
  });

  test("trims whitespace from command", async () => {
    const path = await writeConfig(
      "trim.yaml",
      `
hello:
  description: "hi"
  command: "  echo hello  "
`,
    );

    const config = await loadConfig(path);
    expect(config.commands[0]!.command).toBe("echo hello");
  });

  test("returns empty commands when only port is set", async () => {
    const path = await writeConfig("port-only.yaml", "port: 5000\n");
    const config = await loadConfig(path);
    expect(config.port).toBe(5000);
    expect(config.commands).toHaveLength(0);
  });
});

describe("loadCommands", () => {
  test("returns only the commands array", async () => {
    const path = await writeConfig(
      "load-cmds.yaml",
      `
port: 3000
hello:
  description: "hi"
  command: "echo hi"
`,
    );

    const commands = await loadCommands(path);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({
      name: "hello",
      description: "hi",
      command: "echo hi",
    });
  });

  test("parses command with cwd", async () => {
    const path = await writeConfig(
      "cwd-valid.yaml",
      `
hello:
  description: "hi"
  command: "echo hi"
  cwd: "/tmp"
`,
    );

    const commands = await loadCommands(path);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({
      name: "hello",
      description: "hi",
      command: "echo hi",
      cwd: "/tmp",
    });
  });

  test("command without cwd has no cwd property", async () => {
    const path = await writeConfig(
      "cwd-absent.yaml",
      `
hello:
  description: "hi"
  command: "echo hi"
`,
    );

    const commands = await loadCommands(path);
    expect(commands[0]).not.toHaveProperty("cwd");
  });

  test("rejects non-string cwd", async () => {
    const path = await writeConfig(
      "cwd-invalid.yaml",
      `
hello:
  description: "hi"
  command: "echo hi"
  cwd: 123
`,
    );

    expect(loadCommands(path)).rejects.toThrow('"cwd" must be a string');
  });
});
