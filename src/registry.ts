import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

interface Registry {
  [accessKey: string]: string;
}

const REGISTRY_DIR = join(homedir(), ".exocommand");
const REGISTRY_PATH = join(REGISTRY_DIR, "exocommand.db.json");

export function getRegistryPath(): string {
  return REGISTRY_PATH;
}

export async function loadRegistry(): Promise<Registry> {
  try {
    await access(REGISTRY_PATH);
  } catch {
    return {};
  }
  const content = await readFile(REGISTRY_PATH, "utf-8");
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid registry format: expected a JSON object");
  }
  return parsed as Registry;
}

export async function saveRegistry(registry: Registry): Promise<void> {
  await mkdir(REGISTRY_DIR, { recursive: true });
  await writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n", "utf-8");
}

export function generateAccessKey(): string {
  return createHash("sha256").update(randomUUID()).digest("hex").slice(0, 12);
}

export async function addProject(filePath: string): Promise<string> {
  const absolute = resolve(filePath);

  await access(absolute);

  const registry = await loadRegistry();

  // Check for duplicate path — return existing key
  for (const [key, existingPath] of Object.entries(registry)) {
    if (existingPath === absolute) {
      return key;
    }
  }

  // Generate a unique key (handle unlikely collisions)
  let accessKey = generateAccessKey();
  while (registry[accessKey] !== undefined) {
    accessKey = generateAccessKey();
  }

  registry[accessKey] = absolute;
  await saveRegistry(registry);
  return accessKey;
}

export async function removeProject(accessKey: string): Promise<void> {
  const registry = await loadRegistry();
  if (registry[accessKey] === undefined) {
    throw new Error(`Project "${accessKey}" not found in registry`);
  }
  delete registry[accessKey];
  await saveRegistry(registry);
}

export async function removeProjectByPath(filePath: string): Promise<void> {
  const absolute = resolve(filePath);
  const registry = await loadRegistry();

  for (const [key, existingPath] of Object.entries(registry)) {
    if (existingPath === absolute) {
      delete registry[key];
      await saveRegistry(registry);
      return;
    }
  }

  throw new Error(`No project registered for path: ${absolute}`);
}

export async function listProjects(): Promise<Registry> {
  return loadRegistry();
}

export async function resolveProject(accessKey: string): Promise<string> {
  const registry = await loadRegistry();
  const path = registry[accessKey];
  if (path === undefined) {
    throw new Error(`Project "${accessKey}" not found in registry`);
  }
  return path;
}
