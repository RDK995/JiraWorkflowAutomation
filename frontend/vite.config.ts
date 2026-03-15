import { spawn } from "node:child_process";
import type { ServerResponse } from "node:http";
import net from "node:net";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

function isPortReachable(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function setupApiLauncherPlugin(): Plugin {
  return {
    name: "pronto-setup-api-launcher",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "POST" || req.url !== "/__local/start-setup-api") {
          next();
          return;
        }

        const response = res as ServerResponse;

        const send = (status: number, payload: Record<string, unknown>) => {
          if (response.writableEnded) {
            return;
          }
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.writeHead(status, { "Cache-Control": "no-store" });
          res.end(JSON.stringify(payload));
        };

        void (async () => {
          const alreadyRunning = await isPortReachable(3010);
          if (alreadyRunning) {
            send(200, { ok: true, started: false, status: "already-running" });
            return;
          }

          const workspaceRoot = path.resolve(server.config.root, "..");
          const child = spawn("npm", ["run", "dev:setup-api"], {
            cwd: workspaceRoot,
            detached: true,
            stdio: "ignore"
          });
          child.unref();

          send(200, { ok: true, started: true, status: "starting" });
        })().catch((error) => {
          send(500, { ok: false, error: error instanceof Error ? error.message : "Failed to start setup-api" });
        });
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), setupApiLauncherPlugin()],
  server: {
    host: true,
    port: 5173
  }
});
