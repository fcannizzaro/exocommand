#!/usr/bin/env node
import { type FSWatcher, watch } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { resolve, join, dirname, basename } from "node:path";
import { stat } from "node:fs/promises";
import { getRequestListener } from "@hono/node-server";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { parseArgs } from "./cli.js";
import { loadConfig, configExists, createSampleConfig } from "./config.js";
import { logger, createTuiLogger, type RootLogger } from "./logger.js";
import {
  addProject,
  removeProject,
  removeProjectByPath,
  listProjects,
  resolveProject,
  getRegistryPath,
} from "./registry.js";
import { createServer } from "./server.js";
import { createTui, type TuiManager } from "./tui.js";

const _require = createRequire(import.meta.url);
const { version } = _require("../package.json");

// ANSI styling for CLI output
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";

const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();
const servers = new Set<McpServer>();

// Session -> accessKey mapping
const sessionProject = new Map<string, string>();

// AccessKey -> Set<McpServer> (for targeted config-change notifications)
const projectServers = new Map<string, Set<McpServer>>();

// Per-project .exocommand file watchers
const configWatchers = new Map<string, FSWatcher>();
const configTimers = new Map<string, ReturnType<typeof setTimeout>>();

let nextAgentId = 0;
let taskMode = false;
let tui: TuiManager | null = null;
let activeLogger: RootLogger = logger;

// -- Per-project config file watchers -------------------------------------

function ensureConfigWatcher(accessKey: string, configPath: string): void {
  if (configWatchers.has(accessKey)) return;

  const watcher = watch(configPath, (eventType) => {
    if (eventType !== "change") return;

    const existing = configTimers.get(accessKey);
    if (existing) clearTimeout(existing);

    configTimers.set(
      accessKey,
      setTimeout(() => {
        configTimers.delete(accessKey);
        activeLogger.info(
          "watcher",
          `${configPath} changed, notifying project ${accessKey}`,
        );

        const projectSet = projectServers.get(accessKey);
        if (projectSet) {
          for (const server of projectSet) {
            try {
              server.sendToolListChanged();
            } catch {
              // client may have disconnected
            }
          }
        }
      }, 200),
    );
  });

  configWatchers.set(accessKey, watcher);
  activeLogger.info(
    "watcher",
    `watching ${configPath} (project: ${accessKey})`,
  );
}

function stopConfigWatcher(accessKey: string): void {
  const watcher = configWatchers.get(accessKey);
  if (watcher) {
    watcher.close();
    configWatchers.delete(accessKey);
  }

  const timer = configTimers.get(accessKey);
  if (timer) {
    clearTimeout(timer);
    configTimers.delete(accessKey);
  }

  activeLogger.info("watcher", `stopped watching project ${accessKey}`);
}

// Sync config watchers with the current registry state
async function syncConfigWatchers(): Promise<void> {
  const registry = await listProjects();
  const registeredKeys = new Set(Object.keys(registry));

  // Start watchers for newly registered projects
  for (const [accessKey, configPath] of Object.entries(registry)) {
    ensureConfigWatcher(accessKey, configPath);
  }

  // Stop watchers for projects no longer in the registry
  for (const accessKey of configWatchers.keys()) {
    if (!registeredKeys.has(accessKey)) {
      stopConfigWatcher(accessKey);
    }
  }
}

// -- Registry file watcher (detect add/rm from other processes) -----------

function watchRegistry(): void {
  const registryPath = getRegistryPath();

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    watch(registryPath, (eventType) => {
      if (eventType !== "change") return;

      if (debounceTimer) clearTimeout(debounceTimer);

      debounceTimer = setTimeout(async () => {
        debounceTimer = null;
        activeLogger.info(
          "registry",
          "registry changed, reloading project list",
        );
        await syncConfigWatchers();
      }, 200);
    });
    activeLogger.info("registry", "watching exocommand.db.json for changes");
  } catch {
    // registry file may not exist yet; it will be created on first add
    activeLogger.warn("registry", "registry file not found, skipping watch");
  }
}

// -- MCP request handler --------------------------------------------------

async function handleMcp(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname !== "/mcp") {
    return new Response("Not Found", { status: 404 });
  }

  const sessionId = req.headers.get("mcp-session-id") ?? undefined;

  if (req.method === "GET") {
    if (!sessionId || !transports.has(sessionId)) {
      return new Response("Invalid or missing session ID", { status: 400 });
    }
    return transports.get(sessionId)!.handleRequest(req);
  }

  if (req.method === "DELETE") {
    if (!sessionId || !transports.has(sessionId)) {
      return new Response("Invalid or missing session ID", { status: 400 });
    }
    return transports.get(sessionId)!.handleRequest(req);
  }

  if (req.method === "POST") {
    // Reuse existing session
    if (sessionId && transports.has(sessionId)) {
      return transports.get(sessionId)!.handleRequest(req);
    }

    // Parse body to check if it's an initialize request
    const body = await req.json();

    if (!sessionId && isInitializeRequest(body)) {
      // Extract project access key from header
      const accessKey = req.headers.get("exocommand-project");
      if (!accessKey) {
        return Response.json(
          {
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Missing exocommand-project header",
            },
            id: null,
          },
          { status: 400 },
        );
      }

      // Resolve config path from registry
      let configPath: string;
      try {
        configPath = await resolveProject(accessKey);
      } catch {
        return Response.json(
          {
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: `Unknown project key: ${accessKey}`,
            },
            id: null,
          },
          { status: 400 },
        );
      }

      // Verify the .exocommand file still exists
      if (!(await configExists(configPath))) {
        return Response.json(
          {
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: `Config file not found: ${configPath} (project may have been moved or deleted)`,
            },
            id: null,
          },
          { status: 400 },
        );
      }

      const agentId = ++nextAgentId;
      const agentLogger = activeLogger.withAgent(agentId);
      const projectLabel = basename(dirname(configPath));

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, transport);
          sessionProject.set(sid, accessKey);

          // Track this server under the project
          if (!projectServers.has(accessKey)) {
            projectServers.set(accessKey, new Set());
          }
          const isFirstSession = projectServers.get(accessKey)!.size === 0;
          projectServers.get(accessKey)!.add(server);

          // Notify TUI about new project on first session
          if (isFirstSession) {
            tui?.addProject(accessKey, projectLabel);
          }

          // Start watching this project's config if not already watched
          ensureConfigWatcher(accessKey, configPath);

          agentLogger.info("session", `created ${sid} (project: ${accessKey})`);
        },
        onsessionclosed: (sid) => {
          transports.delete(sid);
          sessionProject.delete(sid);
          agentLogger.warn("session", `closed ${sid}`);
        },
      });

      const server = createServer(agentLogger, {
        configPath,
        taskMode,
        tui,
        agentId,
        projectKey: accessKey,
      });
      servers.add(server);

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
          sessionProject.delete(transport.sessionId);
        }
        servers.delete(server);

        // Remove from project tracking
        const projectSet = projectServers.get(accessKey);
        if (projectSet) {
          projectSet.delete(server);
          if (projectSet.size === 0) {
            projectServers.delete(accessKey);
            stopConfigWatcher(accessKey);
            tui?.removeProject(accessKey);
          }
        }
      };

      await server.connect(transport);

      return transport.handleRequest(req, { parsedBody: body });
    }

    return Response.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: no valid session ID",
        },
        id: null,
      },
      { status: 400 },
    );
  }

  return new Response("Method Not Allowed", { status: 405 });
}

// -- CLI command handlers -------------------------------------------------

async function handleAdd(rawPath: string): Promise<void> {
  let resolved = resolve(rawPath);
  const fileStat = await stat(resolved).catch(() => null);
  if (fileStat?.isDirectory()) {
    resolved = join(resolved, ".exocommand");
  }

  if (!(await configExists(resolved))) {
    console.error(
      `\n  ${RED}${BOLD}✗${RESET} Config file not found: ${DIM}${resolved}${RESET}\n`,
    );
    process.exit(1);
  }

  try {
    await loadConfig(resolved);
  } catch (err) {
    console.error(
      `\n  ${RED}${BOLD}✗${RESET} Invalid config: ${(err as Error).message}\n`,
    );
    process.exit(1);
  }

  const accessKey = await addProject(resolved);
  console.log(`
  ${GREEN}${BOLD}✓${RESET} Project registered

    ${DIM}Key${RESET}     ${CYAN}${BOLD}${accessKey}${RESET}
    ${DIM}Header${RESET}  ${DIM}exocommand-project: ${accessKey}${RESET}
    ${DIM}Config${RESET}  ${DIM}${resolved}${RESET}
`);
}

async function handleLs(): Promise<void> {
  const registry = await listProjects();
  const entries = Object.entries(registry);

  if (entries.length === 0) {
    console.log(`\n  ${DIM}No projects registered.${RESET}\n`);
    return;
  }

  const keyWidth = 14;
  console.log(
    `\n  ${BOLD}${MAGENTA}KEY${RESET}${" ".repeat(keyWidth - 3)}${BOLD}${MAGENTA}PATH${RESET}`,
  );
  console.log(`  ${DIM}${"─".repeat(keyWidth)}${"─".repeat(40)}${RESET}`);

  for (const [key, filePath] of entries) {
    const exists = await configExists(filePath);
    const pathDisplay = exists
      ? `${DIM}${filePath}${RESET}`
      : `${DIM}${filePath} ${RED}(missing)${RESET}`;
    console.log(
      `  ${CYAN}${BOLD}${key}${RESET}${" ".repeat(keyWidth - key.length)}${pathDisplay}`,
    );
  }
  console.log();
}

async function handleRm(target: string): Promise<void> {
  // Detect if target is a path (contains / or . or \) vs an access key
  const isPath =
    target.includes("/") || target.includes("\\") || target === ".";

  try {
    if (isPath) {
      let resolved = resolve(target);
      const fileStat = await stat(resolved).catch(() => null);
      if (fileStat?.isDirectory()) {
        resolved = join(resolved, ".exocommand");
      }
      await removeProjectByPath(resolved);
      console.log(
        `\n  ${GREEN}${BOLD}✓${RESET} Project removed ${DIM}(${resolved})${RESET}\n`,
      );
    } else {
      await removeProject(target);
      console.log(
        `\n  ${GREEN}${BOLD}✓${RESET} Project ${CYAN}${BOLD}${target}${RESET} removed\n`,
      );
    }
  } catch (err) {
    console.error(`\n  ${RED}${BOLD}✗${RESET} ${(err as Error).message}\n`);
    process.exit(1);
  }
}

async function handleInit(): Promise<void> {
  const configPath = resolve(".exocommand");

  if (await configExists(configPath)) {
    console.error(
      `\n  ${RED}${BOLD}✗${RESET} Config file already exists: ${DIM}${configPath}${RESET}\n`,
    );
    process.exit(1);
  }

  await createSampleConfig(configPath);
  console.log(
    `\n  ${GREEN}${BOLD}✓${RESET} Created ${DIM}${configPath}${RESET}\n`,
  );
}

// -- Server startup -------------------------------------------------------

async function startServer(): Promise<void> {
  if (process.stdout.isTTY) {
    tui = await createTui(version);
    activeLogger = createTuiLogger(tui);
  }

  const PORT = parseInt(process.env.EXO_PORT || "5555", 10);

  tui?.setPort(PORT);

  // Resolve task mode from env
  const envTaskMode = process.env.EXO_TASK_MODE;
  taskMode = envTaskMode === "true" || envTaskMode === "1";

  activeLogger.info(
    "startup",
    `execution mode: ${taskMode ? "task" : "streaming"}`,
  );

  try {
    const listener = getRequestListener(handleMcp, {
      overrideGlobalObjects: false,
    });
    const httpServer = createHttpServer(listener);
    httpServer.setTimeout(0);
    httpServer.keepAliveTimeout = 0;
    httpServer.listen(PORT, "127.0.0.1");
  } catch (err) {
    activeLogger.error(
      "startup",
      `Failed to start server on port ${PORT}: ${(err as Error).message}`,
    );
    tui?.destroy();
    process.exit(1);
  }

  activeLogger.info("server", `listening on http://127.0.0.1:${PORT}/mcp`);

  // Watch the registry file for changes from other CLI processes
  watchRegistry();

  // Start watching all currently registered project configs
  await syncConfigWatchers();
}

// -- Main entry point -----------------------------------------------------

async function main(): Promise<void> {
  const action = parseArgs(process.argv);

  switch (action.kind) {
    case "add":
      await handleAdd(action.path);
      return;
    case "init":
      await handleInit();
      return;
    case "ls":
      await handleLs();
      return;
    case "rm":
      await handleRm(action.target);
      return;
    case "serve":
      await startServer();
      return;
  }
}

main().catch((err) => {
  tui?.destroy();
  logger.error("fatal", `Unexpected error: ${(err as Error).message}`);
  process.exit(1);
});
