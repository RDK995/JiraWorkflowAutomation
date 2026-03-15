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
