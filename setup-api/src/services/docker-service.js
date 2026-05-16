import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { normalizeConfig } from "../config.js";
import { envFilePath, projectRoot } from "../paths.js";

const IMAGE_NAME = "jira-workflow-automation";
const CONTAINER_NAME = "jira-automation";
const CODEX_VOLUME = "codex-state:/data/codex";
const CLAUDE_VOLUME = "claude-state:/data/claude";
const CLAUDE_AUTH_STATUS_COMMAND = "status_command='claude auth status'; if claude auth status >/tmp/pronto-claude-auth 2>&1; then status_rc=0; elif claude login status >/tmp/pronto-claude-auth 2>&1; then status_command='claude login status'; status_rc=0; elif claude whoami >/tmp/pronto-claude-auth 2>&1; then status_command='claude whoami'; status_rc=0; else status_rc=$?; fi; printf '__PRONTO_CLAUDE_STATUS_COMMAND__:%s\\n' \"$status_command\"; printf '__PRONTO_CLAUDE_STATUS_RC__:%s\\n' \"$status_rc\"; cat /tmp/pronto-claude-auth; exit 0";

function stripAnsi(text = "") {
  return String(text).replace(/\u001b\[[0-9;]*m/g, "");
}

function parseClaudeAuthStatusOutput(text = "") {
  const cleaned = stripAnsi(text);
  const commandMatch = cleaned.match(/__PRONTO_CLAUDE_STATUS_COMMAND__:(.+)/);
  const rcMatch = cleaned.match(/__PRONTO_CLAUDE_STATUS_RC__:(\d+)/);
  const body = cleaned
    .replace(/__PRONTO_CLAUDE_STATUS_COMMAND__:.+\n?/, "")
    .replace(/__PRONTO_CLAUDE_STATUS_RC__:\d+\n?/, "")
    .trim();

  let loggedIn = false;
  const rc = Number.parseInt(rcMatch?.[1] || "1", 10);

  if (body.startsWith("{")) {
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.loggedIn === "boolean") {
        loggedIn = parsed.loggedIn;
      }
    } catch {
      loggedIn = false;
    }
  }

  if (!loggedIn) {
    const lowered = body.toLowerCase();
    if (
      rc === 0 &&
      lowered &&
      !lowered.includes("not logged in") &&
      !lowered.includes("please run /login") &&
      !lowered.includes("\"loggedin\": false") &&
      !lowered.includes("\"authmethod\": \"none\"")
    ) {
      loggedIn = true;
    }
  }

  return {
    loggedIn,
    command: commandMatch?.[1]?.trim() || "claude auth status",
    rc,
    output: body
  };
}

export function createDockerService({
  execFileImpl = execFile,
  envPath = envFilePath,
  rootPath = projectRoot,
  platform = process.platform
} = {}) {
  const execFileAsync = promisify(execFileImpl);
  let dockerBinaryPath = null;

  async function runDocker(args, { timeoutMs } = {}) {
    return execFileAsync("docker", args, {
      cwd: rootPath,
      maxBuffer: 1024 * 1024 * 10,
      timeout: timeoutMs
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

  async function getDockerBinaryPath() {
    if (dockerBinaryPath) {
      return dockerBinaryPath;
    }

    const whichDocker = await maybeRunCommand("which", ["docker"]);
    if (whichDocker.ok && whichDocker.stdout) {
      dockerBinaryPath = whichDocker.stdout.split(/\r?\n/)[0].trim();
      return dockerBinaryPath;
    }

    if (platform === "darwin") {
      dockerBinaryPath = "/Applications/Docker.app/Contents/Resources/bin/docker";
      return dockerBinaryPath;
    }

    dockerBinaryPath = "docker";
    return dockerBinaryPath;
  }

  async function getClaudeAuthStatusCheck() {
    try {
      const { stdout, stderr } = await runDocker([
        "exec",
        CONTAINER_NAME,
        "sh",
        "-lc",
        CLAUDE_AUTH_STATUS_COMMAND
      ], { timeoutMs: 4000 });

      const parsed = parseClaudeAuthStatusOutput([stdout, stderr].filter(Boolean).join("\n"));

      return {
        ok: parsed.loggedIn,
        check: {
          command: "claude login",
          ok: parsed.loggedIn,
          output: parsed.loggedIn
            ? parsed.output || "Claude Code login is active in the container."
            : parsed.output || `Claude Code is not logged in yet (${parsed.command} exited ${parsed.rc}).`
        }
      };
    } catch (error) {
      return {
        ok: false,
        check: {
          command: "claude login",
          ok: false,
          output: error.killed
            ? "Claude Code login status timed out after 4s. The Claude CLI appears to be blocked inside the container."
            : error.stderr?.trim() || error.message || "Claude Code is not logged in yet."
        }
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

  function classifyColimaStartIssue(output) {
    const normalized = (output || "").trim();
    const lowered = normalized.toLowerCase();

    if (!normalized || lowered.includes("already running")) {
      return {
        ok: true,
        output: normalized || "Colima is already running."
      };
    }

    if (lowered.includes("command not found") || lowered.includes("enoent")) {
      return {
        ok: false,
        output: "Colima is not installed on this machine. Install Colima or switch Docker to Docker Desktop from the setup UI.",
        diagnosis: {
          code: "colima_not_installed",
          title: "Colima is not installed",
          message: "Docker is pointing at Colima, but the Colima CLI is not installed yet. Install Colima or switch Docker to another runtime.",
          platform,
          runtime: "colima",
          context: "colima"
        }
      };
    }

    if (lowered.includes("broken")) {
      return {
        ok: false,
        output: "The Colima profile looks broken. Recreate it or switch Docker to another context before continuing.",
        diagnosis: {
          code: "colima_broken",
          title: "Colima profile is broken",
          message: "The Colima profile looks broken. Recreate it or switch Docker to a different context before continuing.",
          platform,
          runtime: "colima",
          context: "colima"
        }
      };
    }

    if (lowered.includes("vz") || lowered.includes("virtualization") || lowered.includes("vmnet")) {
      return {
        ok: false,
        output: "Colima could not initialize its VM. If this keeps happening, use Docker Desktop or repair the local Colima VM setup and retry.",
        diagnosis: {
          code: "colima_vm_config_error",
          title: "Colima could not start its VM",
          message: "Colima could not initialize its local VM. This usually means macOS virtualization support or Colima's VM configuration needs attention.",
          platform,
          runtime: "colima",
          context: "colima"
        }
      };
    }

    return {
      ok: false,
      output: "Colima failed to start. Retry from this screen, or switch Docker to another runtime if Colima remains unavailable.",
      diagnosis: {
        code: "colima_start_failed",
        title: "Colima did not start",
        message: "Colima failed to start. Review the command output below, then retry or switch Docker to another context.",
        platform,
        runtime: "colima",
        context: "colima"
      }
    };
  }

  function classifyDockerDesktopOpenIssue(output) {
    const normalized = (output || "").trim();
    const lowered = normalized.toLowerCase();

    if (!normalized) {
      return {
        ok: false,
        output: "Docker Desktop could not be opened from PRonto. Launch it manually or reinstall it, then retry.",
        diagnosis: {
          code: "docker_desktop_open_failed",
          title: "Docker Desktop did not open",
          message: "PRonto could not open Docker Desktop automatically. Launch it manually or reinstall it, then retry.",
          platform,
          runtime: "docker"
        }
      };
    }

    if (lowered.includes("unable to find application named") || lowered.includes("application isn’t running") || lowered.includes("does not exist")) {
      return {
        ok: false,
        output: "Docker Desktop does not appear to be installed in Applications. Install Docker Desktop from the setup UI, then retry.",
        diagnosis: {
          code: "docker_desktop_not_installed",
          title: "Docker Desktop is not installed",
          message: "Docker Desktop could not be found on this Mac. Install Docker Desktop, open it once, then rerun the system check.",
          platform,
          runtime: "docker"
        }
      };
    }

    return {
      ok: false,
      output: normalized,
      diagnosis: {
        code: "docker_desktop_open_failed",
        title: "Docker Desktop did not open",
        message: "PRonto could not open Docker Desktop automatically. Review the output below, then open Docker Desktop manually or reinstall it.",
        platform,
        runtime: "docker"
      }
    };
  }

  function classifyDockerBuildIssue(output, context = "") {
    const normalized = (output || "").trim();
    const lowered = normalized.toLowerCase();
    const normalizedContext = (context || "").trim();
    const usesColima = normalizedContext.includes("colima") || lowered.includes("colima") || lowered.includes(".colima");

    if (lowered.includes("command not found") || lowered.includes("enoent")) {
      return {
        ok: false,
        output: "Docker is not installed or is not available in PATH. Install Docker, then rerun the system check.",
        diagnosis: {
          code: "docker_not_installed",
          title: "Docker CLI not found",
          message: "Docker is not installed yet. Install Docker Desktop or another supported Docker runtime, then rerun the system check.",
          platform,
          runtime: "missing",
          context: normalizedContext || undefined
        }
      };
    }

    if (lowered.includes("cannot connect") || lowered.includes("is the docker daemon running")) {
      return {
        ok: false,
        output: "Docker is installed, but the selected runtime is not running. Start Docker Desktop or Colima, then retry the launch preparation.",
        diagnosis: {
          code: "docker_runtime_not_running",
          title: "Docker runtime is not running",
          message: "Docker is installed, but the selected runtime is not running yet. Start Docker Desktop or your local Docker runtime and retry.",
          platform,
          runtime: usesColima ? "colima" : "docker",
          context: normalizedContext || undefined
        }
      };
    }

    if (lowered.includes("apk add") || lowered.includes("pip install") || lowered.includes("npm i -g") || lowered.includes("temporary error") || lowered.includes("network")) {
      return {
        ok: false,
        output: "Docker started building the PRonto image, but dependency installation failed. Check Docker's network access and try the build again.",
        diagnosis: {
          code: "docker_build_dependency_error",
          title: "Image build dependencies failed",
          message: "The Docker image build could not finish because package installation failed inside the build. Verify network access from Docker, then retry.",
          platform,
          runtime: usesColima ? "colima" : "docker",
          context: normalizedContext || undefined
        }
      };
    }

    return {
      ok: false,
      output: "Docker could not build the PRonto image. Review the latest Docker output and retry the launch preparation.",
      diagnosis: {
        code: "docker_build_failed",
        title: "Docker image build failed",
        message: "Docker could not build the PRonto image. Review the latest Docker output and resolve the build issue before launch.",
        platform,
        runtime: usesColima ? "colima" : "docker",
        context: normalizedContext || undefined
      }
    };
  }

  async function getDockerContextName() {
    const contextResult = await maybeRunCommand("docker", ["context", "show"]);
    return contextResult.ok ? contextResult.stdout : "";
  }

  async function runRegistryProbe(image, label, url) {
    try {
      const { stdout, stderr } = await runDocker([
        "run",
        "--rm",
        image,
        "wget",
        "-q",
        "-S",
        "--spider",
        url
      ]);
      return {
        command: label,
        ok: true,
        output: [stdout, stderr].filter(Boolean).join("\n").trim() || `Reachable: ${url}`
      };
    } catch (error) {
      const output = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n").trim();
      return {
        command: label,
        ok: false,
        output: output || `Could not reach ${url}`
      };
    }
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
      const context = await getDockerContextName();
      try {
        const { stdout, stderr } = await runDocker(["build", "-t", IMAGE_NAME, "."]);
        return {
          ok: true,
          output: [stdout, stderr].filter(Boolean).join("\n").trim()
        };
      } catch (error) {
        return classifyDockerBuildIssue([error.stdout, error.stderr, error.message].filter(Boolean).join("\n").trim(), context);
      }
    },

    async runDockerNetworkCheck() {
      const context = await getDockerContextName();
      const dockerVersion = await maybeRunCommand("docker", ["version"]);
      if (!dockerVersion.ok) {
        return {
          ok: false,
          checks: [
            {
              command: "docker runtime",
              ok: false,
              output: dockerVersion.stderr || "Docker is not responding."
            }
          ],
          diagnosis: classifyDockerIssue({
            dockerInstalled: await commandAvailable("docker"),
            dockerOutput: dockerVersion.stderr,
            context,
            colimaInstalled: await commandAvailable("colima"),
            colimaStatus: "",
            colimaList: ""
          })
        };
      }

      const checks = await Promise.all([
        runRegistryProbe("alpine:3.20", "alpine packages", "https://dl-cdn.alpinelinux.org/alpine/"),
        runRegistryProbe("alpine:3.20", "python packages", "https://pypi.org/simple/pip/"),
        runRegistryProbe("alpine:3.20", "npm registry", "https://registry.npmjs.org/@openai%2Fcodex")
      ]);

      const firstFailure = checks.find((check) => !check.ok);
      return {
        ok: checks.every((check) => check.ok),
        checks,
        diagnosis: firstFailure
          ? {
              code: "docker_network_check_failed",
              title: "Docker cannot reach required package sources",
              message: "At least one package source is unreachable from Docker. Repair Docker networking or switch runtimes before retrying the image build.",
              platform,
              runtime: context.includes("colima") ? "colima" : "docker",
              context: context || undefined
            }
          : {
              code: "docker_network_ready",
              title: "Docker network looks healthy",
              message: "Docker can reach the package sources needed for the PRonto image build.",
              platform,
              runtime: context.includes("colima") ? "colima" : "docker",
              context: context || undefined
            }
      };
    },

    async resetDockerBuilderCache() {
      const context = await getDockerContextName();
      try {
        const { stdout, stderr } = await runDocker(["builder", "prune", "-af"]);
        return {
          ok: true,
          output: [stdout, stderr].filter(Boolean).join("\n").trim() || "Docker builder cache was cleared."
        };
      } catch (error) {
        const output = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n").trim();
        return {
          ok: false,
          output: "Docker could not clear the builder cache. Verify the Docker runtime is healthy, then retry.",
          diagnosis: classifyDockerIssue({
            dockerInstalled: await commandAvailable("docker"),
            dockerOutput: output,
            context,
            colimaInstalled: await commandAvailable("colima"),
            colimaStatus: "",
            colimaList: ""
          })
        };
      }
    },

    async getAiContainerAuthStatus(configInput = {}) {
      const config = normalizeConfig(configInput);
      const aiAgent = config.AI_AGENT === "claude" ? "claude" : "codex";
      const integrationLabel = aiAgent === "claude" ? "Claude Code" : "Codex";
      const container = await this.getContainerStatus();
      if (!container.exists || !container.running) {
        return {
          ok: false,
          checks: [
            {
              command: "pronto container",
              ok: false,
              output: `PRonto is not running yet. Launch the service before testing ${integrationLabel} login.`
            }
          ]
        };
      }

      const checks = [];

      if (aiAgent === "claude") {
        try {
          const { stdout } = await runDocker(["exec", CONTAINER_NAME, "sh", "-lc", "claude --version"], { timeoutMs: 4000 });
          checks.push({
            command: "claude cli",
            ok: true,
            output: stdout.trim() || "Claude Code CLI is installed."
          });
        } catch (error) {
          checks.push({
            command: "claude cli",
            ok: false,
            output: error.stderr?.trim() || error.message
          });
          return { ok: false, checks };
        }

        const authStatus = await getClaudeAuthStatusCheck();
        checks.push(authStatus.check);
      } else {
        try {
          const { stdout } = await runDocker(["exec", CONTAINER_NAME, "sh", "-lc", "codex --version"], { timeoutMs: 4000 });
          checks.push({
            command: "codex cli",
            ok: true,
            output: stdout.trim() || "Codex CLI is installed."
          });
        } catch (error) {
          checks.push({
            command: "codex cli",
            ok: false,
            output: error.stderr?.trim() || error.message
          });
          return { ok: false, checks };
        }

        try {
          const { stdout, stderr } = await runDocker(["exec", CONTAINER_NAME, "sh", "-lc", "codex login status"], { timeoutMs: 4000 });
          checks.push({
            command: "codex login",
            ok: true,
            output: [stdout, stderr].filter(Boolean).join("\n").trim() || "Codex login is active in the container."
          });
        } catch (error) {
          checks.push({
            command: "codex login",
            ok: false,
            output: error.killed
              ? "Codex login status timed out after 4s. The Codex CLI appears to be blocked inside the container."
              : error.stderr?.trim() || error.message || "Codex is not logged in yet."
          });
        }
      }

      return {
        ok: checks.every((check) => check.ok),
        checks
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
      if (!(await commandAvailable("colima"))) {
        return classifyColimaStartIssue("colima: command not found");
      }

      try {
        const { stdout, stderr } = await runCommand("colima", ["start", "--runtime", "docker"]);
        return {
          ok: true,
          output: [stdout, stderr].filter(Boolean).join("\n").trim() || "Colima started."
        };
      } catch (error) {
        return classifyColimaStartIssue([error.stdout, error.stderr, error.message].filter(Boolean).join("\n").trim());
      }
    },

    async openDockerDesktop() {
      if (platform !== "darwin") {
        return {
          ok: false,
          output: "Open Docker Desktop is currently supported only on macOS."
        };
      }

      try {
        const { stdout, stderr } = await runCommand("open", ["-a", "Docker"]);
        return {
          ok: true,
          output: [stdout, stderr].filter(Boolean).join("\n").trim() || "Docker Desktop launched."
        };
      } catch (error) {
        return classifyDockerDesktopOpenIssue([error.stdout, error.stderr, error.message].filter(Boolean).join("\n").trim());
      }
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
export const runDockerNetworkCheck = defaultService.runDockerNetworkCheck.bind(defaultService);
export const resetDockerBuilderCache = defaultService.resetDockerBuilderCache.bind(defaultService);
export const getAiContainerAuthStatus = defaultService.getAiContainerAuthStatus.bind(defaultService);
export const getCodexContainerAuthStatus = defaultService.getAiContainerAuthStatus.bind(defaultService);
export const stopContainer = defaultService.stopContainer.bind(defaultService);
export const runContainer = defaultService.runContainer.bind(defaultService);
export const getContainerLogs = defaultService.getContainerLogs.bind(defaultService);
export const startColima = defaultService.startColima.bind(defaultService);
export const openDockerDesktop = defaultService.openDockerDesktop.bind(defaultService);
export const listDockerContexts = defaultService.listDockerContexts.bind(defaultService);
export const switchDockerContext = defaultService.switchDockerContext.bind(defaultService);
