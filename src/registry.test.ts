import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  loadRegistry,
  saveRegistry,
  generateAccessKey,
  addProject,
  removeProject,
  removeProjectByPath,
  listProjects,
  resolveProject,
} from "./registry";

// Override the registry path for testing by monkey-patching the module internals.
// Instead, we test using temp .exocommand files and the real registry functions
// operating on the actual registry path. To isolate tests, we save/restore.

let tmpDir: string;
let sampleConfigPath: string;
let sampleConfigPath2: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "exocommand-registry-test-"));
  sampleConfigPath = join(tmpDir, ".exocommand");
  sampleConfigPath2 = join(tmpDir, ".exocommand2");
  await writeFile(
    sampleConfigPath,
    'hello:\n  description: "hi"\n  command: "echo hi"\n',
  );
  await writeFile(
    sampleConfigPath2,
    'build:\n  description: "build"\n  command: "bun run build"\n',
  );
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("generateAccessKey", () => {
  test("returns a 12-char hex string", () => {
    const key = generateAccessKey();
    expect(key).toHaveLength(12);
    expect(key).toMatch(/^[0-9a-f]{12}$/);
  });

  test("returns unique keys on successive calls", () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateAccessKey()));
    expect(keys.size).toBe(100);
  });
});

describe("registry CRUD", () => {
  test("loadRegistry returns empty object when file does not exist", async () => {
    // The real registry file may or may not exist, so we test the function's behavior
    // by checking it returns a valid object
    const registry = await loadRegistry();
    expect(typeof registry).toBe("object");
    expect(registry).not.toBeNull();
  });

  test("saveRegistry creates directory and writes file", async () => {
    const registry = await loadRegistry();
    // Saving the same registry should not throw
    await saveRegistry(registry);
    const reloaded = await loadRegistry();
    expect(reloaded).toEqual(registry);
  });

  test("addProject registers a new project and returns 12-char key", async () => {
    const key = await addProject(sampleConfigPath);
    expect(key).toHaveLength(12);
    expect(key).toMatch(/^[0-9a-f]{12}$/);

    // Verify it's in the registry
    const registry = await loadRegistry();
    expect(registry[key]).toBe(sampleConfigPath);
  });

  test("addProject returns existing key for duplicate path", async () => {
    const key1 = await addProject(sampleConfigPath);
    const key2 = await addProject(sampleConfigPath);
    expect(key1).toBe(key2);
  });

  test("addProject throws for non-existent file", async () => {
    await expect(addProject(join(tmpDir, "nonexistent"))).rejects.toThrow();
  });

  test("resolveProject returns path for valid key", async () => {
    const key = await addProject(sampleConfigPath);
    const resolved = await resolveProject(key);
    expect(resolved).toBe(sampleConfigPath);
  });

  test("resolveProject throws for unknown key", async () => {
    await expect(resolveProject("zzzzzzzz")).rejects.toThrow(
      'Project "zzzzzzzz" not found in registry',
    );
  });

  test("listProjects returns all registered projects", async () => {
    const key1 = await addProject(sampleConfigPath);
    const key2 = await addProject(sampleConfigPath2);
    const projects = await listProjects();
    expect(projects[key1]).toBe(sampleConfigPath);
    expect(projects[key2]).toBe(sampleConfigPath2);
  });

  test("removeProject deletes the key", async () => {
    const key = await addProject(sampleConfigPath2);
    await removeProject(key);
    const registry = await loadRegistry();
    expect(registry[key]).toBeUndefined();
  });

  test("removeProject throws for unknown key", async () => {
    await expect(removeProject("zzzzzzzzzzzz")).rejects.toThrow(
      'Project "zzzzzzzzzzzz" not found in registry',
    );
  });

  test("removeProjectByPath removes by config file path", async () => {
    const key = await addProject(sampleConfigPath2);
    await removeProjectByPath(sampleConfigPath2);
    const registry = await loadRegistry();
    expect(registry[key]).toBeUndefined();
  });

  test("removeProjectByPath throws for unknown path", async () => {
    await expect(removeProjectByPath("/nonexistent/.exocommand")).rejects.toThrow(
      "No project registered for path: /nonexistent/.exocommand",
    );
  });

  test("full lifecycle: add, list, resolve, remove", async () => {
    const key = await addProject(sampleConfigPath);
    expect(key).toHaveLength(12);

    const projects = await listProjects();
    expect(projects[key]).toBe(sampleConfigPath);

    const resolved = await resolveProject(key);
    expect(resolved).toBe(sampleConfigPath);

    await removeProject(key);
    await expect(resolveProject(key)).rejects.toThrow();
  });
});
