import { readFile, writeFile, access } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

export interface ExoCommand {
  name: string;
  description: string;
  command: string;
  cwd?: string;
}

export interface ExoConfig {
  port?: number;
  taskMode?: boolean;
  commands: ExoCommand[];
}

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

const RESERVED_KEYS = new Set(["port", "taskMode"]);

export async function loadConfig(filePath: string): Promise<ExoConfig> {
  try {
    await access(filePath);
  } catch {
    throw new Error(`Config file not found: ${filePath}`);
  }

  const content = await readFile(filePath, "utf-8");
  const parsed = parseYaml(content);

  if (parsed === null || parsed === undefined || typeof parsed !== "object") {
    throw new Error(
      `Invalid config: expected a YAML mapping, got ${typeof parsed}`,
    );
  }

  const config: ExoConfig = { commands: [] };

  // Parse port
  const rawPort = (parsed as Record<string, unknown>).port;
  if (rawPort !== undefined) {
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(
        `Invalid port "${rawPort}": must be an integer between 1 and 65535`,
      );
    }
    config.port = port;
  }

  // Parse taskMode
  const rawTaskMode = (parsed as Record<string, unknown>).taskMode;
  if (rawTaskMode !== undefined) {
    if (typeof rawTaskMode !== "boolean") {
      throw new Error(
        `Invalid taskMode "${rawTaskMode}": must be a boolean (true or false)`,
      );
    }
    config.taskMode = rawTaskMode;
  }

  // Parse commands
  for (const [name, value] of Object.entries(parsed)) {
    if (RESERVED_KEYS.has(name)) {
      continue;
    }

    if (!NAME_PATTERN.test(name)) {
      throw new Error(
        `Invalid command name "${name}": must match ${NAME_PATTERN}`,
      );
    }

    if (
      typeof value !== "object" ||
      value === null ||
      typeof (value as Record<string, unknown>).description !== "string" ||
      typeof (value as Record<string, unknown>).command !== "string"
    ) {
      throw new Error(
        `Invalid command "${name}": must have "description" (string) and "command" (string)`,
      );
    }

    const rawCwd = (value as Record<string, unknown>).cwd;
    if (rawCwd !== undefined && typeof rawCwd !== "string") {
      throw new Error(
        `Invalid command "${name}": "cwd" must be a string`,
      );
    }

    const { description, command, cwd } = value as {
      description: string;
      command: string;
      cwd?: string;
    };

    config.commands.push({
      name,
      description,
      command: command.trim(),
      ...(cwd ? { cwd } : {}),
    });
  }

  return config;
}

export async function loadCommands(filePath: string): Promise<ExoCommand[]> {
  const config = await loadConfig(filePath);
  return config.commands;
}

export async function configExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

const SAMPLE_CONFIG = `\
# ExoCommand Configuration
# Define shell commands that AI agents can discover and execute.
#
# Format:
#   command-name:
#     description: "What this command does"
#     command: "shell command to run"
#     cwd: "../optional/working/directory"
#
# Optional: override the default server port (default: 5555)
# port: 5555

build:
  description: "Run the build"
  command: "npm run build"

test:
  description: "Run tests"
  command: "npm test"

lint:
  description: "Run linter"
  command: |
    echo "Running linter..."
    npm run lint
`;

export async function createSampleConfig(filePath: string): Promise<void> {
  await writeFile(filePath, SAMPLE_CONFIG, "utf-8");
}
