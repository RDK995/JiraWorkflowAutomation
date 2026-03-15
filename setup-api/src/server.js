import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import { validateConfig } from "./config.js";
import { frontendDistPath } from "./paths.js";
import { buildImage, getContainerLogs, listDockerContexts, openDockerDesktop, runContainer, startColima, stopContainer, switchDockerContext } from "./services/docker-service.js";
import { readCurrentConfig, saveConfig } from "./services/env-file.js";
import { getCodexReadinessStatus, getDockerReadinessStatus, getFullStatus, getGitHubReadinessStatus, getHealthStatus, getJiraReadinessStatus, getNgrokReadinessStatus, getPrerequisiteChecks } from "./services/status-service.js";

const PORT = Number(process.env.SETUP_API_PORT || 3010);

function withCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(response, statusCode, payload) {
  withCorsHeaders(response);
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, payload, type = "text/plain; charset=utf-8") {
  withCorsHeaders(response);
  response.writeHead(statusCode, { "Content-Type": type });
  response.end(payload);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStaticAsset(requestPath, response) {
  try {
    const candidate = requestPath === "/"
      ? path.join(frontendDistPath, "index.html")
      : path.join(frontendDistPath, requestPath.replace(/^\//, ""));
    const content = await fs.readFile(candidate);
    const extension = path.extname(candidate);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    };
    sendText(response, 200, content, types[extension] || "application/octet-stream");
    return true;
  } catch (error) {
    return false;
  }
}

export function createRequestListener(deps = {}) {
  const {
    getFullStatusImpl = getFullStatus,
    readCurrentConfigImpl = readCurrentConfig,
    validateConfigImpl = validateConfig,
    saveConfigImpl = saveConfig,
    getPrerequisiteChecksImpl = getPrerequisiteChecks,
    getDockerReadinessStatusImpl = getDockerReadinessStatus,
    getJiraReadinessStatusImpl = getJiraReadinessStatus,
    getGitHubReadinessStatusImpl = getGitHubReadinessStatus,
    getCodexReadinessStatusImpl = getCodexReadinessStatus,
    getNgrokReadinessStatusImpl = getNgrokReadinessStatus,
    buildImageImpl = buildImage,
    startColimaImpl = startColima,
    openDockerDesktopImpl = openDockerDesktop,
    listDockerContextsImpl = listDockerContexts,
    switchDockerContextImpl = switchDockerContext,
    stopContainerImpl = stopContainer,
    runContainerImpl = runContainer,
    getContainerLogsImpl = getContainerLogs,
    getHealthStatusImpl = getHealthStatus,
    serveStaticAssetImpl = serveStaticAsset
  } = deps;

  return async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "OPTIONS") {
      withCorsHeaders(response);
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/status") {
        sendJson(response, 200, await getFullStatusImpl());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/config") {
        sendJson(response, 200, await readCurrentConfigImpl());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/config/validate") {
        const body = await readJsonBody(request);
        sendJson(response, 200, validateConfigImpl(body.config || body));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/config/save") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await saveConfigImpl(body.config || body));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/checks/prerequisites") {
        sendJson(response, 200, await getPrerequisiteChecksImpl());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/checks/docker-readiness") {
        sendJson(response, 200, await getDockerReadinessStatusImpl());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/checks/jira-readiness") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await getJiraReadinessStatusImpl(body.config || body));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/checks/github-readiness") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await getGitHubReadinessStatusImpl(body.config || body));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/checks/codex-readiness") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await getCodexReadinessStatusImpl(body.config || body));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/checks/ngrok-readiness") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await getNgrokReadinessStatusImpl(body.config || body));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/docker/build") {
        sendJson(response, 200, await buildImageImpl());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/docker/start-colima") {
        sendJson(response, 200, await startColimaImpl());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/docker/open-docker-desktop") {
        sendJson(response, 200, await openDockerDesktopImpl());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/docker/contexts") {
        sendJson(response, 200, await listDockerContextsImpl());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/docker/context/use") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await switchDockerContextImpl(body.name));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/docker/run") {
        await stopContainerImpl();
        sendJson(response, 200, await runContainerImpl());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/docker/stop") {
        sendJson(response, 200, await stopContainerImpl());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/docker/logs") {
        const tail = Number(url.searchParams.get("tail") || 200);
        sendJson(response, 200, await getContainerLogsImpl(tail));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/docker/health") {
        sendJson(response, 200, await getHealthStatusImpl());
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }

      if (await serveStaticAssetImpl(url.pathname, response)) {
        return;
      }

      if (await serveStaticAssetImpl("/", response)) {
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      sendJson(response, 500, {
        error: error.message || "Unexpected server error"
      });
    }
  };
}

export function createAppServer(deps = {}) {
  return createServer(createRequestListener(deps));
}

export function startServer(port = PORT, deps = {}) {
  const server = createAppServer(deps);
  server.listen(port, () => {
    console.log(`Setup API listening on http://localhost:${port}`);
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  startServer();
}
