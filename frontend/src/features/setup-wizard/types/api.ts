import type { Config } from "./config";

export type ValidationResponse = {
  config: Config;
  errors: Record<string, string>;
  isValid: boolean;
};

export type StatusResponse = {
  config: {
    exists: boolean;
    values: Config;
  };
  docker: {
    available: boolean;
    imageExists: boolean;
    container: {
      exists: boolean;
      running: boolean;
      status: string;
      name: string;
    };
  };
  health: {
    reachable: boolean;
    statusCode?: number;
    error?: string;
    payload?: Record<string, string>;
  };
  logs: string;
  createdPullRequests: string[];
};

export type PrereqResponse = {
  dockerInstalled: boolean;
  envFilePresent: boolean;
  recommendedPorts: {
    setupApi: number;
    automationApp: number;
  };
};

export type ReadinessCheckResponse = {
  ok: boolean;
  checks: Array<{
    command: string;
    ok: boolean;
    output: string;
  }>;
  diagnosis?: {
    code: string;
    title: string;
    message: string;
    platform?: string;
    runtime?: string;
    context?: string;
  };
};

export type DockerContextResponse = {
  ok: boolean;
  contexts: Array<{
    name: string;
    current: boolean;
  }>;
  output?: string;
};

export type DockerRecoveryResponse = {
  ok: boolean;
  output: string;
  diagnosis?: ReadinessCheckResponse["diagnosis"];
};

export type DockerNetworkCheckResponse = ReadinessCheckResponse;

export type DeviceLoginPromptResponse = {
  ok: boolean;
  checks: Array<{
    command: string;
    ok: boolean;
    output: string;
  }>;
  session: {
    active: boolean;
    state: string;
    url: string;
    code: string;
    expiryText: string;
    output: string;
  };
};

export type AuthProvider = "claude" | "codex";

export type AuthBrokerProvider = {
  id: AuthProvider;
  label: string;
};

export type AuthPreflightCheck = {
  name: string;
  ok: boolean;
  severity: "pass" | "warning" | "fail";
  code: string;
  summary: string;
  remediation?: string;
};

export type AuthPreflightResponse = {
  ok: boolean;
  provider: AuthProvider;
  checks: AuthPreflightCheck[];
  state: "preflight";
};

export type AuthSessionState =
  | "idle"
  | "preflight"
  | "starting"
  | "waiting_for_browser"
  | "waiting_for_code"
  | "verifying"
  | "persisting"
  | "authenticated"
  | "failed"
  | "cancelled";

export type AuthSessionError = {
  code: string;
  message: string;
  remediation?: string;
  severity?: "warning" | "fail";
};

export type AuthSession = {
  id: string;
  provider: AuthProvider;
  state: AuthSessionState;
  output: string;
  browserUrl: string;
  code: string;
  requiresCode: boolean;
  persistenceVerified: boolean;
  error: AuthSessionError | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthSessionResponse = {
  ok: boolean;
  session: AuthSession | null;
  error?: AuthSessionError;
};

export type AuthBrokerHealthResponse = {
  ok: boolean;
  service: string;
  nodeVersion: string;
  providers: AuthBrokerProvider[];
};
