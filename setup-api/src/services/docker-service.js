import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { envFilePath, projectRoot } from "../paths.js";

const IMAGE_NAME = "jira-workflow-automation";
const CONTAINER_NAME = "jira-automation";
const CODEX_VOLUME = "codex-state:/data/codex";
const CLAUDE_VOLUME = "claude-state:/data/claude";

export function createDockerService({
  execFileImpl = execFile,
  envPath = envFilePath,
  rootPath = projectRoot,
  platform = process.platform
} = {}) {
  const execFileAsync = promisify(execFileImpl);

  async function runDocker(args) {
    return execFileAsync("docker", args, {
      cwd: rootPath,
      maxBuffer: 1024 * 1024 * 10
    });
  }

  async function runCommand(file, args) {
    return execFileAsync(file, args, {
      cwd: rootPath,
      maxBuffer: 1024 * 1024 * 10
    });
  }

  async function commandAvailable(command) {
    try {
      await runCommand("which", [command]);
      return true;
    } catch {
      return false;
    }
  }

  async function maybeRunCommand(file, args) {
    try {
      const result = await runCommand(file, args);
      return { ok: true, stdout: (result.stdout || "").trim(), stderr: (result.stderr || "").trim() };
    } catch (error) {
      return {
        ok: false,
        stdout: "",
        stderr: (error.stderr || error.message || "").trim()
      };
    }
  }

  function isColimaRunning(statusText) {
    const normalized = (statusText || "").trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    if (normalized.includes("not running") || normalized.includes("stopped") || normalized.includes("broken")) {
      return false;
    }
    return normalized.includes("running");
  }

  function classifyDockerIssue({ dockerInstalled, dockerOutput, context, colimaInstalled, colimaStatus, colimaList }) {
    const output = (dockerOutput || "").toLowerCase();
    const normalizedContext = (context || "").trim();
    const usesColima = normalizedContext.includes("colima") || output.includes(".colima") || output.includes("colima");
    const normalizedColimaStatus = (colimaStatus || "").trim();
    const normalizedColimaList = (colimaList || "").trim();
    const colimaBroken = /broken/i.test(normalizedColimaStatus) || /broken/i.test(normalizedColimaList);

    if (!dockerInstalled || output.includes("docker: command not found") || output.includes("enoent")) {
      return {
        code: "docker_not_installed",
        title: "Docker CLI not found",
        message: "Docker is not installed yet. Install Docker Desktop or another supported Docker runtime, then rerun the system check.",
        platform,
        runtime: "missing",
        context: normalizedContext || undefined
      };
    }

    if (usesColima && !colimaInstalled) {
      return {
        code: "colima_not_installed",
        title: "Colima context selected, but Colima is missing",
        message: "This machine is pointing Docker at a Colima context, but the Colima CLI is not installed. Install Colima or switch Docker to another runtime.",
        platform,
        runtime: "colima",
        context: normalizedContext || "colima"
      };
    }

    if (usesColima && colimaBroken) {
      return {
        code: "colima_broken",
        title: "Colima profile is broken",
        message: "Docker is using Colima, but the Colima profile is in a broken state. Repair or recreate the Colima profile, or switch Docker to a different context.",
        platform,
        runtime: "colima",
        context: normalizedContext || "colima"
      };
    }

    if (usesColima && colimaInstalled && !isColimaRunning(colimaStatus)) {
      return {
        code: "colima_stopped",
        title: "Colima is installed but not running",
        message: "Docker is using Colima, but the Colima VM is stopped. Start Colima, then rerun the system check.",
        platform,
        runtime: "colima",
        context: normalizedContext || "colima"
      };
    }

    if (usesColima && output.includes("no such file or directory")) {
      return {
        code: "colima_socket_missing",
        title: "Colima socket is unavailable",
        message: "Docker is using a Colima socket that is not available right now. Start Colima or switch Docker to a working context.",
        platform,
        runtime: "colima",
        context: normalizedContext || "colima"
      };
    }

    if (output.includes("permission denied")) {
      return {
        code: "docker_permission_denied",
        title: "Docker permission issue",
        message: "Docker is installed, but this user cannot access the Docker socket. Fix the local Docker permissions, then rerun the check.",
        platform,
        runtime: usesColima ? "colima" : "docker",
        context: normalizedContext || undefined
      };
    }

    if (output.includes("cannot connect") || output.includes("is the docker daemon running")) {
      return {
        code: "docker_runtime_not_running",
        title: "Docker runtime is not running",
        message: "Docker is installed, but the selected runtime is not running yet. Start Docker Desktop or your local Docker runtime and retry.",
        platform,
        runtime: usesColima ? "colima" : "docker",
        context: normalizedContext || undefined
      };
    }

    if (normalizedContext) {
      return {
        code: "docker_context_misconfigured",
        title: "Docker context may be misconfigured",
        message: `Docker is using the "${normalizedContext}" context, but it is not responding correctly. Switch Docker to a working context or restart that runtime.`,
        platform,
        runtime: usesColima ? "colima" : "docker",
        context: normalizedContext
      };
    }

    return {
      code: "docker_unknown_error",
      title: "Docker check failed",
      message: "Docker did not respond as expected. Review the command output and verify the local Docker runtime before retrying.",
      platform,
      runtime: usesColima ? "colima" : "docker",
      context: normalizedContext || undefined
    };
  }

  return {
    async dockerAvailable() {
      try {
        await runDocker(["version", "--format", "{{.Server.Version}}"]);
        return true;
      } catch (error) {
        return false;
      }
    },

    async runDockerReadinessCheck() {
      const checks = [];
      let dockerVersionOk = false;
      const dockerInstalled = await commandAvailable("docker");
      const colimaInstalled = await commandAvailable("colima");
      const contextResult = dockerInstalled ? await maybeRunCommand("docker", ["context", "show"]) : { ok: false, stdout: "", stderr: "" };
      const context = contextResult.ok ? contextResult.stdout : "";
      const colimaStatusResult = colimaInstalled ? await maybeRunCommand("colima", ["status"]) : { ok: false, stdout: "", stderr: "" };
      const colimaStatus = colimaStatusResult.ok ? colimaStatusResult.stdout : colimaStatusResult.stderr;
      const colimaListResult = colimaInstalled ? await maybeRunCommand("colima", ["list"]) : { ok: false, stdout: "", stderr: "" };
      const colimaList = colimaListResult.ok ? colimaListResult.stdout : colimaListResult.stderr;

      try {
        const { stdout } = await runDocker(["version"]);
        dockerVersionOk = true;
        checks.push({
          command: "docker version",
          ok: true,
          output: stdout.trim()
        });
      } catch (error) {
        checks.push({
          command: "docker version",
          ok: false,
          output: error.stderr?.trim() || error.message
        });
      }

      try {
        const { stdout } = await runDocker(["desktop", "status"]);
        checks.push({
          command: "docker desktop status",
          ok: true,
          output: stdout.trim()
        });
      } catch (error) {
        const output = error.stderr?.trim() || error.message;
        const isUnsupported = output.includes("unknown command: docker desktop");
        checks.push({
          command: "docker desktop status",
          ok: isUnsupported,
          output: isUnsupported
            ? "Skipped: docker desktop status is not available in this Docker environment."
            : output
        });
      }

      if (contextResult.ok) {
        checks.push({
          command: "docker context",
          ok: true,
          output: context
        });
      }

      if (context.includes("colima")) {
        checks.push({
          command: "colima status",
          ok: colimaInstalled && isColimaRunning(colimaStatus),
          output: colimaInstalled
            ? colimaStatus || colimaList || "Colima installed, but status is unknown."
            : "Colima context selected, but the colima CLI is not installed."
        });
        if (colimaList) {
          checks.push({
            command: "colima profiles",
            ok: !/broken/i.test(colimaList),
            output: colimaList
          });
        }
      }

      if (dockerVersionOk && context.includes("colima")) {
        for (const check of checks) {
          if ((check.command === "colima status" || check.command === "colima profiles") && !check.ok) {
            check.ok = true;
            check.output = `${check.output}\nDocker is responding through the active Colima context, so this status probe is informational only.`;
          }
        }
      }

      const colimaFailure = checks.find((check) => (check.command === "colima status" || check.command === "colima profiles") && !check.ok);
      const firstFailure = checks.find((check) => !check.ok);
      const failureForDiagnosis = colimaFailure || firstFailure;
      const diagnosis = failureForDiagnosis
        ? classifyDockerIssue({
            dockerInstalled,
            dockerOutput: failureForDiagnosis.output,
            context,
            colimaInstalled,
            colimaStatus,
            colimaList
          })
        : {
            code: "docker_ready",
            title: "Docker is ready",
            message: "Docker is installed and the selected runtime is responding.",
            platform,
            runtime: context.includes("colima") ? "colima" : "docker",
            context: context || undefined
          };

      return {
        ok: dockerVersionOk && checks.every((check) => check.ok),
        checks,
        diagnosis
      };
    },

    async getDockerStatus() {
      const available = await this.dockerAvailable();
      if (!available) {
        return {
          available: false,
          imageExists: false,
          container: {
            exists: false,
            running: false,
            status: "docker-unavailable",
            name: CONTAINER_NAME
          }
        };
      }

      const [imageExists, container] = await Promise.all([this.getImageExists(), this.getContainerStatus()]);
      return {
        available: true,
        imageExists,
        container
      };
    },

    async getImageExists() {
      try {
        const { stdout } = await runDocker(["image", "inspect", IMAGE_NAME]);
        return Boolean(stdout);
      } catch (error) {
        return false;
      }
    },

    async getContainerStatus() {
      try {
        const { stdout } = await runDocker([
          "ps",
          "-a",
          "--filter",
          `name=^${CONTAINER_NAME}$`,
          "--format",
          "{{.Status}}"
        ]);
        const status = stdout.trim();
        if (!status) {
          return {
            exists: false,
            running: false,
            status: "not-created",
            name: CONTAINER_NAME
          };
        }

        return {
          exists: true,
          running: status.startsWith("Up"),
          status,
          name: CONTAINER_NAME
        };
      } catch (error) {
        return {
          exists: false,
          running: false,
          status: "unknown",
          name: CONTAINER_NAME
        };
      }
    },

    async buildImage() {
      const { stdout, stderr } = await runDocker(["build", "-t", IMAGE_NAME, "."]);
      return {
        ok: true,
        output: [stdout, stderr].filter(Boolean).join("\n").trim()
      };
    },

    async stopContainer() {
      const container = await this.getContainerStatus();
      if (!container.exists) {
        return {
          ok: true,
          output: "Container does not exist."
        };
      }

      const { stdout, stderr } = await runDocker(["rm", "-f", CONTAINER_NAME]);
      return {
        ok: true,
        output: [stdout, stderr].filter(Boolean).join("\n").trim()
      };
    },

    async runContainer() {
      const { stdout, stderr } = await runDocker([
        "run",
        "--env-file",
        envPath,
        "-p",
        "3000:3000",
        "-v",
        CODEX_VOLUME,
        "-v",
        CLAUDE_VOLUME,
        "--name",
        CONTAINER_NAME,
        "-d",
        IMAGE_NAME
      ]);

      return {
        ok: true,
        output: [stdout, stderr].filter(Boolean).join("\n").trim()
      };
    },

    async getContainerLogs(tail = 200) {
      try {
        const { stdout, stderr } = await runDocker(["logs", "--tail", String(tail), CONTAINER_NAME]);
        return {
          ok: true,
          logs: [stdout, stderr].filter(Boolean).join("\n").trim()
        };
      } catch (error) {
        return {
          ok: false,
          logs: error.stderr?.trim() || error.message
        };
      }
    },

    async startColima() {
      const { stdout, stderr } = await runCommand("colima", ["start", "--runtime", "docker"]);
      return {
        ok: true,
        output: [stdout, stderr].filter(Boolean).join("\n").trim() || "Colima started."
      };
    },

    async openDockerDesktop() {
      if (platform !== "darwin") {
        return {
          ok: false,
          output: "Open Docker Desktop is currently supported only on macOS."
        };
      }

      const { stdout, stderr } = await runCommand("open", ["-a", "Docker"]);
      return {
        ok: true,
        output: [stdout, stderr].filter(Boolean).join("\n").trim() || "Docker Desktop launched."
      };
    },

    async listDockerContexts() {
      if (!(await commandAvailable("docker"))) {
        return {
          ok: false,
          contexts: [],
          output: "Docker CLI is not installed."
        };
      }

      const { stdout } = await runDocker(["context", "ls", "--format", "{{.Name}}|{{if .Current}}true{{else}}false{{end}}"]);
      const contexts = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [name, current] = line.split("|");
          return {
            name,
            current: current === "true" || current === "*"
          };
        });

      return {
        ok: true,
        contexts
      };
    },

    async switchDockerContext(name) {
      const { stdout, stderr } = await runDocker(["context", "use", name]);
      return {
        ok: true,
        output: [stdout, stderr].filter(Boolean).join("\n").trim() || `Switched Docker context to ${name}.`
      };
    }
  };
}

const defaultService = createDockerService();

export const dockerAvailable = defaultService.dockerAvailable.bind(defaultService);
export const runDockerReadinessCheck = defaultService.runDockerReadinessCheck.bind(defaultService);
export const getDockerStatus = defaultService.getDockerStatus.bind(defaultService);
export const getImageExists = defaultService.getImageExists.bind(defaultService);
export const getContainerStatus = defaultService.getContainerStatus.bind(defaultService);
export const buildImage = defaultService.buildImage.bind(defaultService);
export const stopContainer = defaultService.stopContainer.bind(defaultService);
export const runContainer = defaultService.runContainer.bind(defaultService);
export const getContainerLogs = defaultService.getContainerLogs.bind(defaultService);
export const startColima = defaultService.startColima.bind(defaultService);
export const openDockerDesktop = defaultService.openDockerDesktop.bind(defaultService);
export const listDockerContexts = defaultService.listDockerContexts.bind(defaultService);
export const switchDockerContext = defaultService.switchDockerContext.bind(defaultService);
