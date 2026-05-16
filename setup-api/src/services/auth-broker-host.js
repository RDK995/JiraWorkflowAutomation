import { spawn } from "node:child_process";
import path from "node:path";

import { projectRoot } from "../paths.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envFlagEnabled(value, defaultValue = false) {
  if (value === undefined) {
    return defaultValue;
  }
  return String(value).toLowerCase() === "true";
}

function parsePortFromBaseUrl(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  } catch {
    return 3020;
  }
}

export function createAuthBrokerHostManager({
  fetchImpl = fetch,
  spawnImpl = spawn,
  execPath = process.execPath,
  env = process.env
} = {}) {
  let launchPromise = null;

  async function isReachable(baseUrl) {
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/api/auth/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async function ensureAvailable(config) {
    if (config.transport !== "launcher_http") {
      return { ok: true, started: false, status: "transport-bypassed" };
    }

    if (await isReachable(config.baseUrl)) {
      return { ok: true, started: false, status: "already-running" };
    }

    const devEmulationEnabled = envFlagEnabled(env.AUTH_BROKER_DEV_EMULATION, false);
    if (!devEmulationEnabled) {
      return {
        ok: false,
        started: false,
        status: "unreachable",
        error: "Auth broker is not reachable. In launcher mode, start the launcher-managed auth broker. For local development only, set AUTH_BROKER_DEV_EMULATION=true."
      };
    }

    if (!envFlagEnabled(env.AUTH_BROKER_AUTOSTART, true)) {
      return {
        ok: false,
        started: false,
        status: "autostart-disabled",
        error: "Auth broker is not reachable and dev emulation autostart is disabled."
      };
    }

    if (!launchPromise) {
      launchPromise = (async () => {
        const port = parsePortFromBaseUrl(config.baseUrl);
        const emulationHost = String(env.AUTH_BROKER_DEV_EMULATION_HOST || "native").toLowerCase();
        const child = emulationHost === "node"
          ? spawnImpl(execPath, [path.join(projectRoot, "auth-broker", "src", "server.js")], {
              cwd: projectRoot,
              detached: true,
              stdio: "ignore",
              env: {
                ...env,
                AUTH_BROKER_PORT: String(port),
                AUTH_BROKER_HOST_TYPE: "launcher_managed_dev_host",
                AUTH_BROKER_HOST_MODE: "launcher_http"
              }
            })
          : spawnImpl("cargo", ["run", "--quiet"], {
              cwd: path.join(projectRoot, "launcher", "src-tauri"),
              detached: true,
              stdio: "ignore",
              env: {
                ...env,
                AUTH_BROKER_BIND: `127.0.0.1:${port}`
              }
            });

        if (typeof child.unref === "function") {
          child.unref();
        }

        for (let attempt = 0; attempt < 20; attempt += 1) {
          await sleep(250);
          if (await isReachable(config.baseUrl)) {
            return { ok: true, started: true, status: "started" };
          }
        }

        return {
          ok: false,
          started: true,
          status: "start-timeout",
          error: "Timed out waiting for auth broker host to start."
        };
      })().finally(() => {
        launchPromise = null;
      });
    }

    return launchPromise;
  }

  return {
    ensureAvailable
  };
}

const defaultHostManager = createAuthBrokerHostManager();

export async function ensureAuthBrokerHostAvailable(config) {
  return defaultHostManager.ensureAvailable(config);
}
