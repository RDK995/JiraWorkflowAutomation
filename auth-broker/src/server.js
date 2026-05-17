import { createServer } from "node:http";

import { HttpError, readJsonBody, sendJson, withCorsHeaders } from "./http/responses.js";
import { createAuthBrokerService } from "./services/auth-broker-service.js";

const PORT = Number(process.env.AUTH_BROKER_PORT || 3020);
const HOST = process.env.AUTH_BROKER_HOST || "127.0.0.1";

export function createRequestListener(service = createAuthBrokerService()) {
  return async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "OPTIONS") {
      withCorsHeaders(response);
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/auth/health") {
        sendJson(response, 200, {
          ok: true,
          service: "auth-broker",
          hostType: process.env.AUTH_BROKER_HOST_TYPE || "node_dev_broker",
          hostMode: process.env.AUTH_BROKER_HOST_MODE || "launcher_http_compatible",
          nodeVersion: process.versions.node,
          providers: service.listProviders()
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/auth/providers") {
        sendJson(response, 200, { providers: service.listProviders() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/preflight") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await service.runPreflight(body.provider, body.context || {}));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/sessions/start") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await service.startAuthSession(body.provider, body.context || {}));
        return;
      }

      const sessionIdMatch = url.pathname.match(/^\/api\/auth\/sessions\/([^/]+)$/);
      if (request.method === "GET" && sessionIdMatch) {
        sendJson(response, 200, await service.getAuthSessionStatus(sessionIdMatch[1]));
        return;
      }

      const submitCodeMatch = url.pathname.match(/^\/api\/auth\/sessions\/([^/]+)\/code$/);
      if (request.method === "POST" && submitCodeMatch) {
        const body = await readJsonBody(request);
        sendJson(response, 200, await service.submitAuthCode(submitCodeMatch[1], body.code));
        return;
      }

      const loginMatch = url.pathname.match(/^\/api\/auth\/sessions\/([^/]+)\/login$/);
      if (request.method === "POST" && loginMatch) {
        sendJson(response, 200, await service.runAuthSessionLogin(loginMatch[1]));
        return;
      }

      const verifyMatch = url.pathname.match(/^\/api\/auth\/sessions\/([^/]+)\/verify$/);
      if (request.method === "POST" && verifyMatch) {
        sendJson(response, 200, await service.verifyAuthSession(verifyMatch[1]));
        return;
      }

      const cancelMatch = url.pathname.match(/^\/api\/auth\/sessions\/([^/]+)\/cancel$/);
      if (request.method === "POST" && cancelMatch) {
        sendJson(response, 200, await service.cancelAuthSession(cancelMatch[1]));
        return;
      }

      sendJson(response, 404, { ok: false, error: "Not found" });
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      sendJson(response, statusCode, {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected auth broker error"
      });
    }
  };
}

export function startServer(port = PORT) {
  const server = createServer(createRequestListener());
  server.listen(port, HOST, () => {
    console.log(`Auth broker listening on http://${HOST}:${port}`);
  });
  return server;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startServer();
}
