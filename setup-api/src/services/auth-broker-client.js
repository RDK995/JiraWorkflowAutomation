const DEFAULT_TRANSPORT = "launcher_http";

function normalizeTransport(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "launcher_http" || normalized === "standalone_http") {
    return normalized;
  }
  return DEFAULT_TRANSPORT;
}

function resolveBaseUrl(transport, explicitBaseUrl) {
  const baseUrl = String(explicitBaseUrl || "").trim();
  if (baseUrl) {
    return baseUrl.replace(/\/+$/, "");
  }

  if (transport === "launcher_http") {
    return "http://127.0.0.1:3020";
  }

  return "http://127.0.0.1:3020";
}

export function getAuthBrokerClientConfig(env = process.env) {
  const transport = normalizeTransport(env.AUTH_BROKER_TRANSPORT);
  const baseUrl = resolveBaseUrl(transport, env.AUTH_BROKER_BASE_URL);
  const targetLabel = transport === "launcher_http"
    ? "launcher-managed auth broker"
    : "standalone auth broker";

  return {
    transport,
    baseUrl,
    targetLabel
  };
}

export function createAuthBrokerClient({
  fetchImpl = fetch,
  env = process.env,
  ensureAvailableImpl = ensureAuthBrokerHostAvailable
} = {}) {
  const config = getAuthBrokerClientConfig(env);

  async function request(path, options = {}) {
    const availability = await ensureAvailableImpl(config);
    if (!availability.ok) {
      throw new Error(availability.error || `Could not reach ${config.targetLabel}.`);
    }

    const response = await fetchImpl(`${config.baseUrl}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : { ok: response.ok, error: await response.text() };

    if (!response.ok) {
      const message = typeof payload?.error === "string" && payload.error
        ? payload.error
        : `Auth broker request failed (${response.status})`;
      throw new Error(message);
    }

    return payload;
  }

  return {
    getConfig() {
      return config;
    },

    async getHealth() {
      const payload = await request("/api/auth/health");
      return {
        ...payload,
        transport: config.transport,
        baseUrl: config.baseUrl,
        targetLabel: config.targetLabel
      };
    },

    async runPreflight(provider, context = {}) {
      return request("/api/auth/preflight", {
        method: "POST",
        body: JSON.stringify({ provider, context })
      });
    },

    async startSession(provider, context = {}) {
      return request("/api/auth/sessions/start", {
        method: "POST",
        body: JSON.stringify({ provider, context })
      });
    },

    async getSessionStatus(sessionId) {
      return request(`/api/auth/sessions/${encodeURIComponent(sessionId)}`);
    },

    async submitCode(sessionId, code) {
      return request(`/api/auth/sessions/${encodeURIComponent(sessionId)}/code`, {
        method: "POST",
        body: JSON.stringify({ code })
      });
    },

    async runLogin(sessionId) {
      return request(`/api/auth/sessions/${encodeURIComponent(sessionId)}/login`, {
        method: "POST"
      });
    },

    async verifySession(sessionId) {
      return request(`/api/auth/sessions/${encodeURIComponent(sessionId)}/verify`, {
        method: "POST"
      });
    },

    async cancelSession(sessionId) {
      return request(`/api/auth/sessions/${encodeURIComponent(sessionId)}/cancel`, {
        method: "POST"
      });
    }
  };
}

const defaultClient = createAuthBrokerClient();

export function getAuthBrokerBaseUrl() {
  return defaultClient.getConfig().baseUrl;
}

export function getAuthBrokerTransportInfo() {
  return defaultClient.getConfig();
}

export async function getAuthBrokerHealth() {
  return defaultClient.getHealth();
}

export async function runAuthBrokerPreflight(provider, context = {}) {
  return defaultClient.runPreflight(provider, context);
}

export async function startAuthBrokerSession(provider, context = {}) {
  return defaultClient.startSession(provider, context);
}

export async function getAuthBrokerSessionStatus(sessionId) {
  return defaultClient.getSessionStatus(sessionId);
}

export async function submitAuthBrokerCode(sessionId, code) {
  return defaultClient.submitCode(sessionId, code);
}

export async function runAuthBrokerLogin(sessionId) {
  return defaultClient.runLogin(sessionId);
}

export async function verifyAuthBrokerSession(sessionId) {
  return defaultClient.verifySession(sessionId);
}

export async function cancelAuthBrokerSession(sessionId) {
  return defaultClient.cancelSession(sessionId);
}
import { ensureAuthBrokerHostAvailable } from "./auth-broker-host.js";
