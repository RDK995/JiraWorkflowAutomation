import { Buffer } from "node:buffer";

import { normalizeConfig } from "../config.js";
import { readCurrentConfig } from "./env-file.js";
import { dockerAvailable, getContainerLogs, getDockerStatus, runDockerReadinessCheck } from "./docker-service.js";

export function createStatusService({
  readCurrentConfigImpl = readCurrentConfig,
  dockerAvailableImpl = dockerAvailable,
  getContainerLogsImpl = getContainerLogs,
  getDockerStatusImpl = getDockerStatus,
  runDockerReadinessCheckImpl = runDockerReadinessCheck,
  fetchImpl = fetch
} = {}) {
  return {
    async getPrerequisiteChecks() {
      const [configState, dockerReady] = await Promise.all([readCurrentConfigImpl(), dockerAvailableImpl()]);

      return {
        dockerInstalled: dockerReady,
        envFilePresent: configState.exists,
        recommendedPorts: {
          setupApi: 3010,
          automationApp: 3000
        }
      };
    },

    async getDockerReadinessStatus() {
      return runDockerReadinessCheckImpl();
    },

    async getJiraReadinessStatus(configInput = {}) {
      const config = normalizeConfig(configInput);
      const missing = ["JIRA_BASE_URL", "JIRA_USER_EMAIL", "JIRA_API_TOKEN"].filter((field) => !config[field]);
      if (missing.length > 0) {
        return {
          ok: false,
          checks: [
            {
              command: "jira credentials",
              ok: false,
              output: `Missing required fields: ${missing.join(", ")}`
            }
          ]
        };
      }

      const authHeader = Buffer.from(`${config.JIRA_USER_EMAIL}:${config.JIRA_API_TOKEN}`, "utf8").toString("base64");

      try {
        const response = await fetchImpl(`${config.JIRA_BASE_URL.replace(/\/$/, "")}/rest/api/3/myself`, {
          headers: {
            Authorization: `Basic ${authHeader}`,
            Accept: "application/json"
          }
        });

        if (!response.ok) {
          const body = await response.text();
          return {
            ok: false,
            checks: [
              {
                command: "jira connectivity",
                ok: false,
                output: `Jira returned ${response.status}: ${body || response.statusText}`
              }
            ]
          };
        }

        const payload = await response.json();
        return {
          ok: true,
          checks: [
            {
              command: "jira connectivity",
              ok: true,
              output: `Authenticated as ${payload.displayName || payload.emailAddress || config.JIRA_USER_EMAIL}`
            }
          ]
        };
      } catch (error) {
        return {
          ok: false,
          checks: [
            {
              command: "jira connectivity",
              ok: false,
              output: error.message || "Unable to reach Jira"
            }
          ]
        };
      }
    },

    async getGitHubReadinessStatus(configInput = {}) {
      const config = normalizeConfig(configInput);
      const token = config.GITHUB_TOKEN || config.GH_TOKEN;

      if (!token) {
        return {
          ok: false,
          checks: [
            {
              command: "github credentials",
              ok: false,
              output: "Missing required field: GITHUB_TOKEN or GH_TOKEN"
            }
          ]
        };
      }

      try {
        const response = await fetchImpl("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "jira-workflow-automation-setup"
          }
        });

        if (!response.ok) {
          const body = await response.text();
          return {
            ok: false,
            checks: [
              {
                command: "github connectivity",
                ok: false,
                output: `GitHub returned ${response.status}: ${body || response.statusText}`
              }
            ]
          };
        }

        const payload = await response.json();
        return {
          ok: true,
          checks: [
            {
              command: "github connectivity",
              ok: true,
              output: `Authenticated as ${payload.login || "GitHub user"}`
            }
          ]
        };
      } catch (error) {
        return {
          ok: false,
          checks: [
            {
              command: "github connectivity",
              ok: false,
              output: error.message || "Unable to reach GitHub"
            }
          ]
        };
      }
    },

    async getCodexReadinessStatus(configInput = {}) {
      const config = normalizeConfig(configInput);
      const apiKey = config.CODEX_API_KEY || config.OPENAI_API_KEY;
      const bootstrapLogin = config.CODEX_BOOTSTRAP_LOGIN === "true";
      const deviceLogin = config.CODEX_DEVICE_LOGIN_ON_START === "true";

      if (apiKey) {
        try {
          const response = await fetchImpl("https://api.openai.com/v1/models", {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              Accept: "application/json"
            }
          });

          if (!response.ok) {
            const body = await response.text();
            return {
              ok: false,
              checks: [
                {
                  command: "openai api authentication",
                  ok: false,
                  output: `OpenAI returned ${response.status}: ${body || response.statusText}`
                }
              ]
            };
          }

          return {
            ok: true,
            checks: [
              {
                command: "openai api authentication",
                ok: true,
                output: `Authenticated with ${config.CODEX_API_KEY ? "CODEX_API_KEY" : "OPENAI_API_KEY"}`
              }
            ]
          };
        } catch (error) {
          return {
            ok: false,
            checks: [
              {
                command: "openai api authentication",
                ok: false,
                output: error.message || "Unable to reach OpenAI"
              }
            ]
          };
        }
      }

      if (deviceLogin) {
        return {
          ok: true,
          checks: [
            {
              command: "codex login mode",
              ok: true,
              output: "Device login is enabled. Complete login in the running container if prompted."
            }
          ]
        };
      }

      if (!bootstrapLogin) {
        return {
          ok: true,
          checks: [
            {
              command: "codex login mode",
              ok: true,
              output: "Persisted login mode selected. Verify the jira-automation container has an existing Codex session before launch."
            }
          ]
        };
      }

      return {
        ok: false,
        checks: [
          {
            command: "codex credentials",
            ok: false,
            output: "Provide CODEX_API_KEY or OPENAI_API_KEY, or enable device login on start."
          }
        ]
      };
    },

    async getNgrokReadinessStatus(configInput = {}) {
      const config = normalizeConfig(configInput);

      if (config.NGROK_ENABLE !== "true") {
        return {
          ok: true,
          checks: [
            {
              command: "ngrok configuration",
              ok: true,
              output: "ngrok is disabled. Public webhook access will be skipped."
            }
          ]
        };
      }

      if (!config.NGROK_AUTHTOKEN) {
        return {
          ok: false,
          checks: [
            {
              command: "ngrok authtoken",
              ok: false,
              output: "Missing required field: NGROK_AUTHTOKEN"
            }
          ]
        };
      }

      if (!config.NGROK_DOMAIN) {
        return {
          ok: true,
          checks: [
            {
              command: "ngrok authtoken",
              ok: true,
              output: "Authtoken provided. ngrok will create an ephemeral public URL when the container starts."
            }
          ]
        };
      }

      if (!config.NGROK_API_KEY) {
        return {
          ok: false,
          checks: [
            {
              command: "ngrok reserved domain",
              ok: false,
              output: "NGROK_DOMAIN is set, but NGROK_API_KEY is missing. Add an API key to verify or auto-provision the reserved domain."
            }
          ]
        };
      }

      try {
        const response = await fetchImpl("https://api.ngrok.com/reserved_domains", {
          headers: {
            Authorization: `Bearer ${config.NGROK_API_KEY}`,
            Accept: "application/json",
            "ngrok-version": "2"
          }
        });

        if (!response.ok) {
          const body = await response.text();
          return {
            ok: false,
            checks: [
              {
                command: "ngrok api access",
                ok: false,
                output: `ngrok returned ${response.status}: ${body || response.statusText}`
              }
            ]
          };
        }

        const payload = await response.json();
        const domains = Array.isArray(payload.reserved_domains) ? payload.reserved_domains : [];
        const found = domains.some((domain) => domain.domain === config.NGROK_DOMAIN);

        return {
          ok: found,
          checks: [
            {
              command: "ngrok api access",
              ok: true,
              output: "Authenticated with NGROK_API_KEY"
            },
            {
              command: "ngrok reserved domain",
              ok: found,
              output: found
                ? `Reserved domain is available: ${config.NGROK_DOMAIN}`
                : `Reserved domain not found yet: ${config.NGROK_DOMAIN}. The container will try to provision it at startup.`
            }
          ]
        };
      } catch (error) {
        return {
          ok: false,
          checks: [
            {
              command: "ngrok api access",
              ok: false,
              output: error.message || "Unable to reach ngrok"
            }
          ]
        };
      }
    },

    async getHealthStatus() {
      try {
        const response = await fetchImpl("http://127.0.0.1:3000/health");
        if (!response.ok) {
          return {
            reachable: false,
            statusCode: response.status
          };
        }

        const payload = await response.json();
        return {
          reachable: true,
          statusCode: response.status,
          payload
        };
      } catch (error) {
        return {
          reachable: false,
          error: error.message
        };
      }
    },

    async getFullStatus() {
      const [configState, docker, health, logs] = await Promise.all([
        readCurrentConfigImpl(),
        getDockerStatusImpl(),
        this.getHealthStatus(),
        getContainerLogsImpl(80)
      ]);

      return {
        config: {
          exists: configState.exists,
          values: configState.config
        },
        docker,
        health,
        logs: logs.logs
      };
    }
  };
}

const defaultService = createStatusService();

export const getPrerequisiteChecks = defaultService.getPrerequisiteChecks.bind(defaultService);
export const getDockerReadinessStatus = defaultService.getDockerReadinessStatus.bind(defaultService);
export const getJiraReadinessStatus = defaultService.getJiraReadinessStatus.bind(defaultService);
export const getGitHubReadinessStatus = defaultService.getGitHubReadinessStatus.bind(defaultService);
export const getCodexReadinessStatus = defaultService.getCodexReadinessStatus.bind(defaultService);
export const getNgrokReadinessStatus = defaultService.getNgrokReadinessStatus.bind(defaultService);
export const getHealthStatus = defaultService.getHealthStatus.bind(defaultService);
export const getFullStatus = defaultService.getFullStatus.bind(defaultService);
