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

export type ClaudeLoginSessionResponse = {
  ok: boolean;
  running?: boolean;
  alreadyRunning?: boolean;
  error?: string;
  session: {
    state: "idle" | "running" | "waiting_for_browser" | "verifying" | "success" | "failed" | "cancelled";
    nextAction: "start_sign_in" | "open_sign_in" | "wait_for_verification" | "test_access" | "retry_sign_in";
    startedAt: string | null;
    finishedAt: string | null;
    authUrl: string;
    error: string;
    logs: string[];
  };
};

export type CodexLoginSessionResponse = ClaudeLoginSessionResponse;

export type ClaudeLoginSubmitCodeResponse = {
  ok: boolean;
  error?: string;
  session: ClaudeLoginSessionResponse["session"];
};
