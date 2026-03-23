import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { envFilePath, projectRoot } from "../paths.js";

const IMAGE_NAME = "jira-workflow-automation";
const CONTAINER_NAME = "jira-automation";
const CODEX_VOLUME = "codex-state:/data/codex";
const CLAUDE_VOLUME = "claude-state:/data/claude";
const VERBOSE_LOGIN_LOGS = process.env.SETUP_API_VERBOSE_LOGIN_LOGS !== "false";

export function createDockerService({
  execFileImpl = execFile,
  envPath = envFilePath,
  rootPath = projectRoot,
  platform = process.platform
} = {}) {
  const execFileAsync = promisify(execFileImpl);
  let claudeLoginSession = {
    state: "idle",
    startedAt: null,
    finishedAt: null,
    authUrl: "",
    logs: [],
    error: ""
  };
  let claudeLoginProcess = null;
  let claudeStreamBuffer = "";
  let claudeVerificationTimer = null;
  let claudeVerificationInFlight = false;
  let codexLoginSession = {
    state: "idle",
    startedAt: null,
    finishedAt: null,
    authUrl: "",
    logs: [],
    error: ""
  };
  let codexLoginProcess = null;

  function logClaudeDebug(message, details = {}) {
    if (!VERBOSE_LOGIN_LOGS) {
      return;
    }
    const payload = Object.entries(details)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(" ");
    console.info(`[setup-api][claude-login] ${message}${payload ? ` ${payload}` : ""}`);
  }

  function setClaudeSessionState(nextState, reason = "", extra = {}) {
    const prevState = claudeLoginSession.state;
    claudeLoginSession.state = nextState;
    if (prevState !== nextState) {
      logClaudeDebug("state-transition", { from: prevState, to: nextState, reason, ...extra });
    }
  }

  function getClaudeNextAction() {
    switch (claudeLoginSession.state) {
      case "idle":
        return "start_sign_in";
      case "running":
      case "waiting_for_browser":
        return "open_sign_in";
      case "verifying":
        return "wait_for_verification";
      case "success":
        return "test_access";
      case "failed":
      case "cancelled":
        return "retry_sign_in";
      default:
        return "start_sign_in";
    }
  }

  function getCodexNextAction() {
    switch (codexLoginSession.state) {
      case "idle":
        return "start_sign_in";
      case "running":
      case "waiting_for_browser":
        return "open_sign_in";
      case "verifying":
        return "wait_for_verification";
      case "success":
        return "test_access";
      case "failed":
      case "cancelled":
        return "retry_sign_in";
      default:
        return "start_sign_in";
    }
  }

  async function runDocker(args) {
    return execFileAsync("docker", args, {
      cwd: rootPath,
      maxBuffer: 1024 * 1024 * 10
    });
  }

  async function runDockerWithTimeout(args, timeoutMs) {
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

  function clearClaudeVerificationTimer() {
    if (claudeVerificationTimer) {
      clearTimeout(claudeVerificationTimer);
      claudeVerificationTimer = null;
    }
  }

  function stripAnsi(text) {
    return String(text || "").replace(/\u001B\[[0-9;]*[A-Za-z]/g, "");
  }

  function extractClaudeAuthUrl(text) {
    const normalized = stripAnsi(text);
    const direct = normalized.match(/https:\/\/claude\.ai\/oauth\/authorize\S+/);
    if (direct?.[0]) {
      return direct[0];
    }
    const start = normalized.indexOf("https://claude.ai/oauth/authorize");
    if (start === -1) {
      return "";
    }
    const tail = normalized.slice(start, start + 6000);
    const wrapped = tail.match(/^https:\/\/claude\.ai\/oauth\/authorize[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%\s]+/);
    if (!wrapped?.[0]) {
      return "";
    }
    return wrapped[0].replace(/\s+/g, "").replace(/[)>.,;]+$/g, "");
  }

  function pushClaudeLog(line) {
    const raw = stripAnsi(line);
    if (!raw.trim()) {
      return;
    }
    for (const entry of raw.split(/\r?\n/)) {
      const trimmed = entry.trim();
      if (!trimmed) {
        continue;
      }
      claudeLoginSession.logs.push(trimmed);
    }
    if (claudeLoginSession.logs.length > 160) {
      claudeLoginSession.logs = claudeLoginSession.logs.slice(-120);
    }

    claudeStreamBuffer = `${claudeStreamBuffer}${raw}`.slice(-12000);
    const maybeUrl = extractClaudeAuthUrl(raw) || extractClaudeAuthUrl(claudeStreamBuffer);
    const lineLower = raw.toLowerCase();
    if (
      lineLower.includes("opening browser") ||
      lineLower.includes("if the browser didn't open") ||
      lineLower.includes("authentication code") ||
      lineLower.includes("not logged in")
    ) {
      logClaudeDebug("runtime-log", { sample: raw.replace(/\s+/g, " ").slice(0, 220) });
    }
    if (maybeUrl && !claudeLoginSession.authUrl) {
      claudeLoginSession.authUrl = maybeUrl;
      logClaudeDebug("auth-url-detected", { authUrlSample: maybeUrl.slice(0, 120), authUrlLength: maybeUrl.length });
      if (claudeLoginSession.state === "running") {
        setClaudeSessionState("waiting_for_browser", "auth-url-detected");
      }
    }
  }

  function snapshotClaudeLoginSession() {
    return {
      state: claudeLoginSession.state,
      nextAction: getClaudeNextAction(),
      startedAt: claudeLoginSession.startedAt,
      finishedAt: claudeLoginSession.finishedAt,
      authUrl: claudeLoginSession.authUrl,
      error: claudeLoginSession.error,
      logs: claudeLoginSession.logs.slice(-20)
    };
  }

  async function verifyClaudeLoginInBackground(service, traceId = "") {
    clearClaudeVerificationTimer();
    claudeVerificationInFlight = false;
    setClaudeSessionState("verifying", "submit-code");
    const startedAt = Date.now();
    const deadlineMs = 150_000;
    const pollDelayMs = 1500;
    let attempt = 0;
    logClaudeDebug("verification-started", { traceId: traceId || "none", deadlineMs, pollDelayMs });

    const poll = async () => {
      attempt += 1;
      if (claudeVerificationInFlight) {
        logClaudeDebug("verification-skip-inflight", { traceId: traceId || "none", attempt });
        claudeVerificationTimer = setTimeout(() => {
          void poll();
        }, pollDelayMs);
        return;
      }

      const terminalState = ["success", "failed", "cancelled", "idle"].includes(claudeLoginSession.state);
      if (terminalState) {
        logClaudeDebug("verification-stop-terminal-state", { traceId: traceId || "none", attempt, state: claudeLoginSession.state });
        clearClaudeVerificationTimer();
        return;
      }

      if (Date.now() - startedAt >= deadlineMs) {
        if (claudeLoginSession.state !== "success" && claudeLoginSession.state !== "cancelled") {
          setClaudeSessionState("failed", "verification-timeout", { traceId: traceId || "none", attempt });
          claudeLoginSession.error = "Claude verification timed out. Retry Sign in with Claude.";
          claudeLoginSession.finishedAt = new Date().toISOString();
        }
        clearClaudeVerificationTimer();
        return;
      }

      if (!claudeLoginProcess || claudeLoginProcess.killed) {
        logClaudeDebug("verification-stop-process-not-running", { traceId: traceId || "none", attempt });
        clearClaudeVerificationTimer();
        return;
      }

      claudeVerificationInFlight = true;
      try {
        logClaudeDebug("verification-attempt", {
          traceId: traceId || "none",
          attempt,
          elapsedMs: Date.now() - startedAt
        });
        const check = await service.checkClaudeLoginState(traceId);
        logClaudeDebug("verification-attempt-result", {
          traceId: traceId || "none",
          attempt,
          ok: check.ok,
          outputSample: String(check.output || "").slice(0, 160)
        });
        if (check.ok) {
          setClaudeSessionState("success", "verification-ready", { traceId: traceId || "none", attempt });
          claudeLoginSession.finishedAt = new Date().toISOString();
          if (claudeLoginProcess && !claudeLoginProcess.killed) {
            claudeLoginProcess.kill("SIGTERM");
          }
          clearClaudeVerificationTimer();
          return;
        }
      } catch (error) {
        logClaudeDebug("verification-attempt-error", {
          traceId: traceId || "none",
          attempt,
          error: error?.message || "unknown error"
        });
        pushClaudeLog(`Verification probe failed: ${error?.message || "unknown error"}`);
      } finally {
        claudeVerificationInFlight = false;
      }

      claudeVerificationTimer = setTimeout(() => {
        void poll();
      }, pollDelayMs);
    };

    void poll();
  }

  function pushCodexLog(line) {
    const trimmed = (line || "").trim();
    if (!trimmed) {
      return;
    }
    codexLoginSession.logs.push(trimmed);
    if (codexLoginSession.logs.length > 120) {
      codexLoginSession.logs = codexLoginSession.logs.slice(-120);
    }
    const urlMatch = trimmed.match(/https:\/\/\S+/);
    if (urlMatch && !codexLoginSession.authUrl) {
      codexLoginSession.authUrl = urlMatch[0];
      if (codexLoginSession.state === "running") {
        codexLoginSession.state = "waiting_for_browser";
      }
    }
  }

  function snapshotCodexLoginSession() {
    return {
      state: codexLoginSession.state,
      nextAction: getCodexNextAction(),
      startedAt: codexLoginSession.startedAt,
      finishedAt: codexLoginSession.finishedAt,
      authUrl: codexLoginSession.authUrl,
      error: codexLoginSession.error,
      logs: codexLoginSession.logs.slice(-20)
    };
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

    async startClaudeLoginSession() {
      logClaudeDebug("start-requested");
      if (claudeLoginProcess) {
        logClaudeDebug("start-skipped-already-running", { pid: claudeLoginProcess.pid || "unknown" });
        return {
          ok: true,
          alreadyRunning: true,
          session: snapshotClaudeLoginSession()
        };
      }

      const dockerStatus = await this.getDockerStatus();
      logClaudeDebug("docker-status", {
        available: dockerStatus.available,
        imageExists: dockerStatus.imageExists,
        containerRunning: dockerStatus.container?.running
      });
      if (!dockerStatus.available) {
        return {
          ok: false,
          alreadyRunning: false,
          session: snapshotClaudeLoginSession(),
          error: "Docker is not available. Run the system check first."
        };
      }

      if (!dockerStatus.imageExists) {
        return {
          ok: false,
          alreadyRunning: false,
          session: snapshotClaudeLoginSession(),
          error: "Build the PRonto image before starting Claude login."
        };
      }

      claudeLoginSession = {
        state: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        authUrl: "",
        logs: [],
        error: ""
      };
      claudeStreamBuffer = "";
      clearClaudeVerificationTimer();
      claudeVerificationInFlight = false;
      logClaudeDebug("session-reset", { state: claudeLoginSession.state });

      const args = [
        "run",
        "--rm",
        "-i",
        "--env-file",
        envPath,
        "-v",
        CLAUDE_VOLUME,
        IMAGE_NAME,
        "sh",
        "-lc",
        "ln -sfn /data/claude /root/.claude && claude auth login"
      ];
      logClaudeDebug("spawning-login-process", {
        image: IMAGE_NAME,
        volume: CLAUDE_VOLUME,
        command: "claude auth login"
      });
      claudeLoginProcess = spawn("docker", args, { cwd: rootPath });
      logClaudeDebug("spawned-login-process", { pid: claudeLoginProcess.pid || "unknown" });

      claudeLoginProcess.stdout.on("data", (chunk) => {
        pushClaudeLog(String(chunk));
      });
      claudeLoginProcess.stderr.on("data", (chunk) => {
        pushClaudeLog(String(chunk));
      });
      claudeLoginProcess.on("error", (error) => {
        setClaudeSessionState("failed", "process-error");
        claudeLoginSession.finishedAt = new Date().toISOString();
        claudeLoginSession.error = error.message || "Failed to start Claude login process.";
        logClaudeDebug("process-error", { error: error.message || "unknown" });
        claudeLoginProcess = null;
      });
      claudeLoginProcess.on("close", async (code) => {
        logClaudeDebug("process-close", { code: code ?? "unknown", state: claudeLoginSession.state });
        try {
          if (claudeLoginSession.state === "cancelled" || claudeLoginSession.state === "success") {
            return;
          }
          if (code === 0) {
            setClaudeSessionState("success", "process-close-ready");
          } else {
            setClaudeSessionState("failed", "process-close-nonzero");
            claudeLoginSession.error = `Claude login process exited with code ${code ?? "unknown"}.`;
          }
        } catch (error) {
          setClaudeSessionState("failed", "process-close-exception");
          claudeLoginSession.error = error.message || "Claude login verification failed.";
          logClaudeDebug("process-close-error", { error: error.message || "unknown" });
        } finally {
          clearClaudeVerificationTimer();
          claudeVerificationInFlight = false;
          claudeLoginSession.finishedAt = new Date().toISOString();
          claudeLoginProcess = null;
        }
      });

      return {
        ok: true,
        alreadyRunning: false,
        session: snapshotClaudeLoginSession()
      };
    },

    async getClaudeLoginSessionStatus() {
      return {
        ok: true,
        running: Boolean(claudeLoginProcess),
        session: snapshotClaudeLoginSession()
      };
    },

    async cancelClaudeLoginSession() {
      logClaudeDebug("cancel-requested", {
        pid: claudeLoginProcess?.pid || "none",
        state: claudeLoginSession.state
      });
      clearClaudeVerificationTimer();
      claudeVerificationInFlight = false;
      if (claudeLoginProcess) {
        claudeLoginProcess.kill("SIGTERM");
        claudeLoginProcess = null;
      }
      setClaudeSessionState("cancelled", "user-cancel");
      claudeLoginSession.finishedAt = new Date().toISOString();
      claudeLoginSession.error = "";
      return {
        ok: true,
        session: snapshotClaudeLoginSession()
      };
    },

    async submitClaudeLoginCode(code, traceId = "") {
      const authCodeRaw = String(code || "").trim();
      // If the user pasted the full callback URL, extract the ?code= parameter.
      // Otherwise fall back to stripping whitespace from the raw input so that
      // codes containing +, =, or . are not truncated by a narrower regex.
      const urlCodeMatch = authCodeRaw.match(/[?&]code=([^&\s]+)/);
      const authCode = urlCodeMatch ? decodeURIComponent(urlCodeMatch[1]) : authCodeRaw.replace(/\s+/g, "");
      logClaudeDebug("submit-code-requested", {
        traceId: traceId || "none",
        rawLength: authCodeRaw.length,
        normalizedLength: authCode.length,
        urlExtracted: Boolean(urlCodeMatch),
        state: claudeLoginSession.state
      });
      if (!authCode) {
        return {
          ok: false,
          error: "Authentication code is required.",
          session: snapshotClaudeLoginSession()
        };
      }
      if (!claudeLoginProcess || !claudeLoginProcess.stdin || claudeLoginProcess.killed) {
        return {
          ok: false,
          error: "Claude login session is not running. Start Sign in with Claude again.",
          session: snapshotClaudeLoginSession()
        };
      }
      if (claudeLoginSession.state === "verifying") {
        return {
          ok: false,
          error: "Claude verification is already in progress. Please wait.",
          session: snapshotClaudeLoginSession()
        };
      }

      try {
        claudeLoginSession.error = "";
        setClaudeSessionState("verifying", "submit-code-write", { traceId: traceId || "none" });
        claudeLoginProcess.stdin.write(`${authCode}\n`);
        claudeLoginProcess.stdin.end();
        if (authCode !== authCodeRaw) {
          pushClaudeLog("Authentication code was normalized before submit (whitespace removed).");
        }
        pushClaudeLog("Authentication code submitted from setup UI.");
        await verifyClaudeLoginInBackground(this, traceId);
        logClaudeDebug("submit-code-accepted", {
          traceId: traceId || "none",
          nextAction: snapshotClaudeLoginSession().nextAction
        });

        return {
          ok: true,
          session: snapshotClaudeLoginSession()
        };
      } catch (error) {
        return {
          ok: false,
          error: error.message || "Failed to submit authentication code.",
          session: snapshotClaudeLoginSession()
        };
      }
    },

    async startCodexLoginSession() {
      if (codexLoginProcess) {
        return {
          ok: true,
          alreadyRunning: true,
          session: snapshotCodexLoginSession()
        };
      }

      const dockerStatus = await this.getDockerStatus();
      if (!dockerStatus.available) {
        return {
          ok: false,
          alreadyRunning: false,
          session: snapshotCodexLoginSession(),
          error: "Docker is not available. Run the system check first."
        };
      }

      if (!dockerStatus.imageExists) {
        return {
          ok: false,
          alreadyRunning: false,
          session: snapshotCodexLoginSession(),
          error: "Build the PRonto image before starting Codex login."
        };
      }

      codexLoginSession = {
        state: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        authUrl: "",
        logs: [],
        error: ""
      };

      const args = [
        "run",
        "--rm",
        "-i",
        "--env-file",
        envPath,
        "-v",
        CODEX_VOLUME,
        IMAGE_NAME,
        "sh",
        "-lc",
        "ln -sfn /data/codex /root/.codex && codex login --device-auth"
      ];
      codexLoginProcess = spawn("docker", args, { cwd: rootPath });

      codexLoginProcess.stdout.on("data", (chunk) => {
        pushCodexLog(String(chunk));
      });
      codexLoginProcess.stderr.on("data", (chunk) => {
        pushCodexLog(String(chunk));
      });
      codexLoginProcess.on("error", (error) => {
        codexLoginSession.state = "failed";
        codexLoginSession.finishedAt = new Date().toISOString();
        codexLoginSession.error = error.message || "Failed to start Codex login process.";
        codexLoginProcess = null;
      });
      codexLoginProcess.on("close", async (code) => {
        try {
          if (codexLoginSession.state === "cancelled") {
            return;
          }
          if (code === 0) {
            const check = await this.checkCodexLoginState();
            if (check.ok) {
              codexLoginSession.state = "success";
            } else {
              codexLoginSession.state = "failed";
              codexLoginSession.error = check.output || "Codex login did not persist.";
            }
          } else {
            codexLoginSession.state = "failed";
            codexLoginSession.error = `Codex login process exited with code ${code ?? "unknown"}.`;
          }
        } catch (error) {
          codexLoginSession.state = "failed";
          codexLoginSession.error = error.message || "Codex login verification failed.";
        } finally {
          codexLoginSession.finishedAt = new Date().toISOString();
          codexLoginProcess = null;
        }
      });

      return {
        ok: true,
        alreadyRunning: false,
        session: snapshotCodexLoginSession()
      };
    },

    async getCodexLoginSessionStatus() {
      return {
        ok: true,
        running: Boolean(codexLoginProcess),
        session: snapshotCodexLoginSession()
      };
    },

    async cancelCodexLoginSession() {
      if (codexLoginProcess) {
        codexLoginProcess.kill("SIGTERM");
        codexLoginProcess = null;
      }
      codexLoginSession.state = "cancelled";
      codexLoginSession.finishedAt = new Date().toISOString();
      codexLoginSession.error = "";
      return {
        ok: true,
        session: snapshotCodexLoginSession()
      };
    },

    async getImageName() {
      return IMAGE_NAME;
    },

    async checkClaudeLoginState(traceId = "") {
      logClaudeDebug("readiness-check-start", {
        traceId: traceId || "none",
        state: claudeLoginSession.state,
        pid: claudeLoginProcess?.pid || "none"
      });
      const status = await this.getDockerStatus();
      if (!status.available) {
        return {
          ok: false,
          output: "Docker is not available. Run the system check first."
        };
      }

      if (!status.imageExists) {
        return {
          ok: false,
          output: "Build the PRonto image before testing Claude login readiness."
        };
      }

      const startedAt = Date.now();
      try {
        await runDockerWithTimeout([
          "run",
          "--rm",
          "--env-file",
          envPath,
          "-v",
          CLAUDE_VOLUME,
          IMAGE_NAME,
          "sh",
          "-lc",
          "ln -sfn /data/claude /root/.claude && (claude auth status >/dev/null 2>&1 || claude login status >/dev/null 2>&1 || claude whoami >/dev/null 2>&1)"
        ], 25000);
        console.info(`[setup-api] trace=${traceId || "none"} checkClaudeLoginState ok duration_ms=${Date.now() - startedAt}`);
        return {
          ok: true,
          output: "Claude Code login is persisted and ready."
        };
      } catch (error) {
        const stderrTail = String(error?.stderr || "").trim().slice(-240);
        const stdoutTail = String(error?.stdout || "").trim().slice(-240);
        const signal = error?.signal || "";
        console.warn(`[setup-api] trace=${traceId || "none"} checkClaudeLoginState fail duration_ms=${Date.now() - startedAt} signal=${signal || "none"} error=${error?.message || "unknown"} stderr_tail=${stderrTail || "<empty>"} stdout_tail=${stdoutTail || "<empty>"}`);
        return {
          ok: false,
          output:
            "Claude Code is not logged in yet. In Setup Wizard, use Sign in with Claude, open the sign-in link, paste the authentication code, submit it, then test again."
        };
      }
    },

    async checkCodexLoginState(traceId = "") {
      const status = await this.getDockerStatus();
      if (!status.available) {
        return {
          ok: false,
          output: "Docker is not available. Run the system check first."
        };
      }

      if (!status.imageExists) {
        return {
          ok: false,
          output: "Build the PRonto image before testing Codex login readiness."
        };
      }

      const startedAt = Date.now();
      try {
        await runDockerWithTimeout([
          "run",
          "--rm",
          "--env-file",
          envPath,
          "-v",
          CODEX_VOLUME,
          IMAGE_NAME,
          "sh",
          "-lc",
          "ln -sfn /data/codex /root/.codex && codex login status >/dev/null 2>&1"
        ], 10000);
        console.info(`[setup-api] trace=${traceId || "none"} checkCodexLoginState ok duration_ms=${Date.now() - startedAt}`);
        return {
          ok: true,
          output: "Codex login is persisted and ready."
        };
      } catch (error) {
        console.warn(`[setup-api] trace=${traceId || "none"} checkCodexLoginState fail duration_ms=${Date.now() - startedAt} error=${error?.message || "unknown"}`);
        return {
          ok: false,
          output:
            "Codex is not logged in yet. In Setup Wizard, use Sign in with Codex, open the sign-in link, complete login, then test again."
        };
      }
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
export const getImageName = defaultService.getImageName.bind(defaultService);
export const checkClaudeLoginState = defaultService.checkClaudeLoginState.bind(defaultService);
export const checkCodexLoginState = defaultService.checkCodexLoginState.bind(defaultService);
export const startClaudeLoginSession = defaultService.startClaudeLoginSession.bind(defaultService);
export const getClaudeLoginSessionStatus = defaultService.getClaudeLoginSessionStatus.bind(defaultService);
export const cancelClaudeLoginSession = defaultService.cancelClaudeLoginSession.bind(defaultService);
export const submitClaudeLoginCode = defaultService.submitClaudeLoginCode.bind(defaultService);
export const startCodexLoginSession = defaultService.startCodexLoginSession.bind(defaultService);
export const getCodexLoginSessionStatus = defaultService.getCodexLoginSessionStatus.bind(defaultService);
export const cancelCodexLoginSession = defaultService.cancelCodexLoginSession.bind(defaultService);
export const getContainerLogs = defaultService.getContainerLogs.bind(defaultService);
export const startColima = defaultService.startColima.bind(defaultService);
export const openDockerDesktop = defaultService.openDockerDesktop.bind(defaultService);
export const listDockerContexts = defaultService.listDockerContexts.bind(defaultService);
export const switchDockerContext = defaultService.switchDockerContext.bind(defaultService);
