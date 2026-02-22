#!/usr/bin/env node
import { watch } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { getRequestListener } from "@hono/node-server";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { loadConfig, configExists, createSampleConfig } from "./config.js";
import { logger } from "./logger.js";

const _require = createRequire(import.meta.url);
const { version } = _require("../package.json");

const CONFIG_PATH = process.env.EXO_COMMAND_FILE || "./.exocommand";

const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();
const servers = new Set<McpServer>();
let nextAgentId = 0;
let taskMode = false;

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
    // reuse existing session
    if (sessionId && transports.has(sessionId)) {
      return transports.get(sessionId)!.handleRequest(req);
    }

    // parse body to check if it's an initialize request
    const body = await req.json();

    if (!sessionId && isInitializeRequest(body)) {
      const agentId = ++nextAgentId;
      const agentLogger = logger.withAgent(agentId);

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, transport);
          agentLogger.info("session", `created ${sid}`);
        },
        onsessionclosed: (sid) => {
          transports.delete(sid);
          agentLogger.warn("session", `closed ${sid}`);
        },
      });

      const server = createServer(agentLogger, { taskMode });
      servers.add(server);

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
        }
        servers.delete(server);
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

async function main() {
  logger.banner(version);

  if (!(await configExists(CONFIG_PATH))) {
    await createSampleConfig(CONFIG_PATH);
    logger.info("setup", `created sample config at ${CONFIG_PATH}`);
    logger.info(
      "setup",
      "edit the file with your commands, then restart the server",
    );
    process.exit(0);
  }

  let config;

  try {
    config = await loadConfig(CONFIG_PATH);
  } catch (err) {
    logger.error(
      "startup",
      `Failed to load config from ${CONFIG_PATH}: ${(err as Error).message}`,
    );
    process.exit(1);
  }

  const PORT = parseInt(
    process.env.EXO_PORT || String(config.port ?? 5555),
    10,
  );

  // Resolve task mode: env var overrides config
  const envTaskMode = process.env.EXO_TASK_MODE;
  taskMode = envTaskMode !== undefined
    ? envTaskMode === "true" || envTaskMode === "1"
    : config.taskMode ?? false;

  logger.info(
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
    logger.error(
      "startup",
      `Failed to start server on port ${PORT}: ${(err as Error).message}`,
    );
    process.exit(1);
  }

  logger.info("server", `listening on http://127.0.0.1:${PORT}/mcp`);

  // Watch .exocommand for changes and notify connected clients
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  watch(CONFIG_PATH, (eventType) => {
    if (eventType !== "change") return;

    if (debounceTimer) clearTimeout(debounceTimer);

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      logger.info("watcher", ".exocommand changed, notifying clients");
      for (const server of servers) {
        try {
          server.sendToolListChanged();
        } catch {
          // client may have disconnected
        }
      }
    }, 200);
  });

  logger.info("watcher", `watching ${CONFIG_PATH} for changes`);
}

main().catch((err) => {
  logger.error("fatal", `Unexpected error: ${(err as Error).message}`);
  process.exit(1);
});
