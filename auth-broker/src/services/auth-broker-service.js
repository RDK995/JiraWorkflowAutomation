import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as nodePty from "node-pty";
import { createClaudeAdapter, createCodexAdapter, listProviders } from "./provider-adapters.js";

const CONTAINER_NAME = "jira-automation";
const CLAUDE_STATE_DIR = "/data/claude";
const CODEX_STATE_DIR = "/data/codex";
const CLAUDE_AUTH_STATUS_COMMAND = "status_command='claude auth status'; if claude auth status >/tmp/pronto-claude-auth 2>&1; then status_rc=0; elif claude login status >/tmp/pronto-claude-auth 2>&1; then status_command='claude login status'; status_rc=0; elif claude whoami >/tmp/pronto-claude-auth 2>&1; then status_command='claude whoami'; status_rc=0; else status_rc=$?; fi; printf '__PRONTO_CLAUDE_STATUS_COMMAND__:%s\\n' \"$status_command\"; printf '__PRONTO_CLAUDE_STATUS_RC__:%s\\n' \"$status_rc\"; cat /tmp/pronto-claude-auth; exit 0";
const TERMINAL_SESSION_STATES = new Set(["authenticated", "failed", "cancelled"]);

function authError(code, message, remediation, severity = "fail") {
  return { code, message, remediation, severity };
}

function makeCheck(name, ok, summary, severity = ok ? "pass" : "fail", code = ok ? "ok" : "failed", remediation = "") {
  return { name, ok, severity, code, summary, remediation };
}

function stripAnsi(text = "") {
  return String(text).replace(/\u001b\[[0-9;]*m/g, "");
}

function slugProvider(provider) {
  return provider === "claude" ? "claude" : "codex";
}

function createSessionResponse(session) {
  return {
    ok: session.state !== "failed",
    session: {
      id: session.id,
      provider: session.provider,
      state: session.state,
      output: session.output.trim(),
      browserUrl: session.browserUrl,
      code: session.code,
      requiresCode: session.requiresCode,
      persistenceVerified: session.persistenceVerified,
      error: session.error,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    }
  };
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

function extractClaudeDeviceLogin(text = "") {
  const cleaned = stripAnsi(text);
  const urlMatch = cleaned.match(/https:\/\/[^\s)]+/i);
  const codeMatch =
    cleaned.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,}\b/) ||
    cleaned.match(/\b[A-Z0-9]{6,}\b/);

  if (!urlMatch) {
    return null;
  }

  return {
    url: urlMatch[0],
    code: codeMatch?.[0] || ""
  };
}

function extractCodexDeviceLogin(text = "") {
  const cleaned = stripAnsi(text);
  const urlMatch = cleaned.match(/https:\/\/auth\.openai\.com\/codex\/device/i);
  const codeMatch = cleaned.match(/\b[A-Z0-9]{4}-[A-Z0-9]{5}\b/);
  if (!urlMatch || !codeMatch) {
    return null;
  }
  return {
    url: urlMatch[0],
    code: codeMatch[0]
  };
}

export function createAuthBrokerService({
  execFileImpl = execFile,
  ptyImpl = nodePty,
  nodeVersion = process.versions.node,
  platform = process.platform
} = {}) {
  const execFileAsync = promisify(execFileImpl);
  const sessions = new Map();
  let dockerBinaryPath = null;

  async function runCommand(file, args, options = {}) {
    return execFileAsync(file, args, {
      maxBuffer: 1024 * 1024 * 10,
      ...options
    });
  }

  async function maybeRunCommand(file, args, options = {}) {
    try {
      const result = await runCommand(file, args, options);
      return { ok: true, stdout: (result.stdout || "").trim(), stderr: (result.stderr || "").trim() };
    } catch (error) {
      return { ok: false, stdout: "", stderr: (error.stderr || error.message || "").trim() };
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

  async function dockerAvailable() {
    const dockerBinary = await getDockerBinaryPath();
    const result = await maybeRunCommand(dockerBinary, ["version"]);
    return result.ok;
  }

  async function getContainerStatus() {
    const dockerBinary = await getDockerBinaryPath();
    const result = await maybeRunCommand(dockerBinary, ["ps", "-a", "--filter", `name=${CONTAINER_NAME}`, "--format", "{{.Status}}"]);
    if (!result.ok || !result.stdout.trim()) {
      return { exists: false, running: false, status: "not-created" };
    }
    const status = result.stdout.trim().split(/\r?\n/)[0];
    return { exists: true, running: /^up\b/i.test(status), status };
  }

  async function verifyVolumeWritable(volumePath) {
    const dockerBinary = await getDockerBinaryPath();
    const result = await maybeRunCommand(dockerBinary, ["exec", CONTAINER_NAME, "sh", "-lc", `test -w ${volumePath} && echo writable`]);
    return result.ok && result.stdout.includes("writable");
  }

  async function verifyStatePersisted(volumePath) {
    const dockerBinary = await getDockerBinaryPath();
    const result = await maybeRunCommand(
      dockerBinary,
      ["exec", CONTAINER_NAME, "sh", "-lc", `if [ -d ${volumePath} ] && find ${volumePath} -mindepth 1 -maxdepth 3 -print -quit | grep -q .; then echo persisted; fi`]
    );
    return result.ok && result.stdout.includes("persisted");
  }

  async function getClaudeAuthStatus() {
    const dockerBinary = await getDockerBinaryPath();
    const result = await maybeRunCommand(dockerBinary, ["exec", CONTAINER_NAME, "sh", "-lc", CLAUDE_AUTH_STATUS_COMMAND], { timeout: 4000 });
    const parsed = parseClaudeAuthStatusOutput([result.stdout, result.stderr].filter(Boolean).join("\n"));
    return {
      ok: result.ok && parsed.loggedIn,
      output: parsed.output || `Claude Code is not logged in yet (${parsed.command} exited ${parsed.rc}).`
    };
  }

  async function getCodexAuthStatus() {
    const dockerBinary = await getDockerBinaryPath();
    const result = await maybeRunCommand(dockerBinary, ["exec", CONTAINER_NAME, "sh", "-lc", "codex login status"], { timeout: 4000 });
    return {
      ok: result.ok,
      output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || (result.ok ? "Codex login is active in the container." : "Codex is not logged in yet.")
    };
  }

  async function verifyProviderPersistence(provider) {
    const volumePath = provider === "claude" ? CLAUDE_STATE_DIR : CODEX_STATE_DIR;
    const status = provider === "claude"
      ? await getClaudeAuthStatus()
      : await getCodexAuthStatus();
    if (!status.ok) {
      return false;
    }
    return verifyStatePersisted(volumePath);
  }

  function newSession(provider) {
    const session = {
      id: crypto.randomUUID(),
      provider,
      state: "idle",
      output: "",
      browserUrl: "",
      code: "",
      requiresCode: false,
      persistenceVerified: false,
      error: null,
      process: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    sessions.set(session.id, session);
    return session;
  }

  function updateSession(session, patch) {
    Object.assign(session, patch, { updatedAt: new Date().toISOString() });
    return session;
  }

  function failSession(session, code, message, remediation) {
    return updateSession(session, {
      state: "failed",
      error: authError(code, message, remediation),
      process: null
    });
  }

  async function runPreflight(providerInput, context = {}) {
    const provider = slugProvider(providerInput);
    const providerLabel = provider === "claude" ? "Claude Code" : "Codex";
    const checks = [];

    checks.push(makeCheck("auth-broker", true, "Auth broker is reachable."));

    const dockerReady = await dockerAvailable();
    checks.push(makeCheck("docker", dockerReady, dockerReady ? "Docker is reachable." : "Docker is not reachable.", dockerReady ? "pass" : "fail", dockerReady ? "ok" : "docker_unavailable", dockerReady ? "" : "Start Docker before authenticating the provider."));

    const container = await getContainerStatus();
    checks.push(makeCheck(
      "pronto-container",
      container.running,
      container.running ? "PRonto container is running." : "PRonto container is not running yet.",
      container.running ? "pass" : "warning",
      container.running ? "ok" : "container_not_running",
      container.running ? "" : "Launch PRonto before starting interactive provider authentication."
    ));

    if (container.running) {
      const dockerBinary = await getDockerBinaryPath();
      const cliCheck = await maybeRunCommand(dockerBinary, ["exec", CONTAINER_NAME, "sh", "-lc", provider === "claude" ? "claude --version" : "codex --version"]);
      checks.push(makeCheck(
        `${provider}-cli`,
        cliCheck.ok,
        cliCheck.ok ? `${providerLabel} CLI is available.` : `${providerLabel} CLI is not available in the running container.`,
        cliCheck.ok ? "pass" : "fail",
        cliCheck.ok ? "ok" : "provider_cli_missing",
        cliCheck.ok ? "" : "Rebuild and relaunch PRonto so the selected provider CLI is installed inside the container."
      ));

      const volumePath = provider === "claude" ? CLAUDE_STATE_DIR : CODEX_STATE_DIR;
      const writable = await verifyVolumeWritable(volumePath);
      checks.push(makeCheck(
        `${provider}-volume`,
        writable,
        writable ? `${providerLabel} auth volume is writable.` : `${providerLabel} auth volume is not writable.`,
        writable ? "pass" : "fail",
        writable ? "ok" : "provider_state_unwritable",
        writable ? "" : `Ensure ${volumePath} is mounted and writable before authenticating ${providerLabel}.`
      ));
    }

    if (provider === "claude") {
      const major = Number.parseInt(String(nodeVersion).split(".")[0] || "0", 10);
      const runtimeOk = major >= 20 && major <= 22;
      checks.push(makeCheck(
        "runtime",
        runtimeOk,
        runtimeOk ? `Auth broker runtime Node ${nodeVersion} supports Claude interactive login.` : `Claude interactive login is validated on Node 20 or 22. Current runtime: Node ${nodeVersion}.`,
        runtimeOk ? "pass" : "warning",
        runtimeOk ? "ok" : "unsupported_runtime",
        runtimeOk ? "" : "For the most reliable Claude auth flow, run auth-broker on Node 20 or 22, or use launcher-managed native auth hosting."
      ));
    }

    return {
      ok: checks.every((check) => check.severity !== "fail"),
      provider,
      checks,
      state: "preflight"
    };
  }

  const adapters = {
    claude: createClaudeAdapter({
      runPreflight,
      getClaudeAuthStatus,
      verifyProviderPersistence,
      getDockerBinaryPath,
      updateSession,
      failSession,
      createSessionResponse,
      ptyImpl,
      extractClaudeDeviceLogin,
      stripAnsi,
      processCwd: process.cwd(),
      processEnv: process.env,
      containerName: CONTAINER_NAME,
      verifyAuthSession: async (sessionId) => verifyAuthSession(sessionId)
    }),
    codex: createCodexAdapter({
      runPreflight,
      getCodexAuthStatus,
      verifyProviderPersistence,
      getDockerBinaryPath,
      updateSession,
      failSession,
      createSessionResponse,
      extractCodexDeviceLogin,
      ptyImpl,
      stripAnsi,
      processCwd: process.cwd(),
      processEnv: process.env,
      containerName: CONTAINER_NAME
    })
  };

  async function startAuthSession(providerInput, context = {}) {
    const provider = slugProvider(providerInput);
    const session = newSession(provider);
    updateSession(session, { state: "preflight" });
    return adapters[provider].start(session, context);
  }

  async function getAuthSessionStatus(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        ok: false,
        session: null,
        error: authError("session_not_found", "Auth session not found.", "Start a new auth session from the wizard.")
      };
    }

    return adapters[session.provider].refresh(session);
  }

  async function submitAuthCode(sessionId, codeInput = "") {
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        ok: false,
        session: null,
        error: authError("session_not_found", "Auth session not found.", "Start a new auth session from the wizard.")
      };
    }

    if (session.provider !== "claude") {
      const label = session.provider === "claude" ? "Claude Code" : "Codex";
      return createSessionResponse(failSession(session, "provider_code_submission_unsupported", `${label} does not require pasted code submission in this flow.`, "Return to the browser sign-in flow and finish the provider login."));
    }
    return adapters.claude.submitCode(session, codeInput);
  }

  async function runAuthSessionLogin(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        ok: false,
        session: null,
        error: authError("session_not_found", "Auth session not found.", "Start a new auth session from the wizard.")
      };
    }

    if (session.provider !== "claude") {
      return createSessionResponse(failSession(session, "provider_login_command_unsupported", "Manual /login is only supported for Claude in this flow.", "Use the provider-specific browser flow and retry."));
    }

    if (TERMINAL_SESSION_STATES.has(session.state)) {
      return createSessionResponse(session);
    }

    if (!session.process || typeof session.process.write !== "function") {
      return createSessionResponse(failSession(session, "interactive_session_missing", "Interactive Claude session is not active.", "Restart Claude Code login from the wizard."));
    }

    session.process.write("/login\r");
    updateSession(session, { state: "waiting_for_browser" });
    return createSessionResponse(session);
  }

  async function verifyAuthSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        ok: false,
        session: null,
        error: authError("session_not_found", "Auth session not found.", "Start a new auth session from the wizard.")
      };
    }

    updateSession(session, { state: "verifying" });
    const authStatus = session.provider === "claude"
      ? await getClaudeAuthStatus()
      : await getCodexAuthStatus();

    if (!authStatus.ok) {
      return createSessionResponse(failSession(session, "browser_authorization_not_accepted", authStatus.output, "Complete the browser authorization flow and retry verification."));
    }

    updateSession(session, { state: "persisting" });
    const persistenceVerified = await verifyProviderPersistence(session.provider);
    const label = session.provider === "claude" ? "Claude Code" : "Codex";
    updateSession(session, {
      state: "authenticated",
      output: [session.output, authStatus.output].filter(Boolean).join("\n").trim(),
      persistenceVerified,
      error: persistenceVerified ? null : authError("auth_persistence_not_verified", `${label} authenticated, but persisted auth state could not be verified.`, "Confirm the shared auth volume is mounted and contains persisted provider auth state.")
    });
    return createSessionResponse(session);
  }

  async function cancelAuthSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        ok: false,
        session: null,
        error: authError("session_not_found", "Auth session not found.", "Start a new auth session from the wizard.")
      };
    }

    if (session.process?.kill) {
      session.process.kill();
    }
    updateSession(session, {
      state: "cancelled",
      process: null,
      error: null
    });
    return createSessionResponse(session);
  }

  return {
    listProviders,
    runPreflight,
    startAuthSession,
    getAuthSessionStatus,
    submitAuthCode,
    runAuthSessionLogin,
    verifyAuthSession,
    cancelAuthSession
  };
}
