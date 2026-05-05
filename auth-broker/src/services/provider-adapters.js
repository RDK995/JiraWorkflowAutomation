function displayName(provider) {
  return provider === "claude" ? "Claude Code" : "Codex";
}

export function listProviders() {
  return [
    { id: "claude", label: "Claude Code" },
    { id: "codex", label: "Codex" }
  ];
}

export function createClaudeAdapter(helpers) {
  const {
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
    processCwd,
    processEnv,
    containerName,
    displayNameImpl = displayName
  } = helpers;

  return {
    async start(session) {
      const preflight = await runPreflight("claude");
      if (!preflight.ok) {
        const failure = preflight.checks.find((check) => check.severity === "fail");
        return createSessionResponse(failSession(session, failure?.code || "preflight_failed", failure?.summary || "Claude preflight failed.", failure?.remediation || ""));
      }

      const authStatus = await getClaudeAuthStatus();
      if (authStatus.ok) {
        updateSession(session, {
          state: "authenticated",
          output: authStatus.output,
          persistenceVerified: await verifyProviderPersistence("claude")
        });
        return createSessionResponse(session);
      }

      const dockerBinary = await getDockerBinaryPath();
      let child;
      try {
        child = ptyImpl.spawn(dockerBinary, ["exec", "-it", containerName, "sh", "-lc", "claude auth login || claude login"], {
          name: "xterm-color",
          cols: 120,
          rows: 30,
          cwd: processCwd,
          env: processEnv
        });
      } catch (error) {
        return createSessionResponse(failSession(session, "interactive_session_start_failed", error instanceof Error ? error.message : String(error), "Ensure the local auth broker runtime supports interactive PTY sessions."));
      }

      updateSession(session, {
        state: "starting",
        process: child,
        output: ""
      });

      if (typeof child.onData === "function") {
        child.onData((data) => {
          session.output += data;
          const login = extractClaudeDeviceLogin(session.output);
          if (login) {
            updateSession(session, {
              browserUrl: login.url,
              code: login.code,
              requiresCode: Boolean(login.code),
              state: login.code ? "waiting_for_code" : "waiting_for_browser"
            });
          }
          const lowered = stripAnsi(session.output).toLowerCase();
          if (lowered.includes("paste") || lowered.includes("authorization code")) {
            updateSession(session, { requiresCode: true, state: "waiting_for_code" });
          }
        });
      }

      if (typeof child.onExit === "function") {
        child.onExit(({ exitCode }) => {
          if (session.state !== "authenticated" && session.state !== "cancelled") {
            failSession(session, "interactive_session_ended", `Interactive ${displayNameImpl(session.provider)} session exited with status ${exitCode}.`, "Restart the auth session from the wizard.");
          }
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 600));
      if (!session.browserUrl && session.state === "starting") {
        updateSession(session, { state: "starting" });
      }

      return createSessionResponse(session);
    },

    async refresh(session) {
      const authStatus = await getClaudeAuthStatus();
      if (authStatus.ok) {
        updateSession(session, {
          state: "authenticated",
          output: [session.output, authStatus.output].filter(Boolean).join("\n").trim(),
          persistenceVerified: await verifyProviderPersistence("claude"),
          process: null
        });
      }
      return createSessionResponse(session);
    },

    async submitCode(session, codeInput) {
      const code = String(codeInput || "").trim();
      if (!code) {
        return createSessionResponse(failSession(session, "browser_authorization_code_missing", "Paste the authorization code before submitting it.", "Copy the returned code from the browser flow and retry."));
      }

      if (!session.process || typeof session.process.write !== "function") {
        return createSessionResponse(failSession(session, "interactive_session_missing", "Interactive Claude session is not active.", "Restart Claude Code login from the wizard."));
      }

      updateSession(session, { state: "verifying" });
      session.process.write(`${code}\r`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      return helpers.verifyAuthSession(session.id);
    }
  };
}

export function createCodexAdapter(helpers) {
  const {
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
    processCwd,
    processEnv,
    containerName,
    displayNameImpl = displayName
  } = helpers;

  return {
    async start(session) {
      const preflight = await runPreflight("codex");
      if (!preflight.ok) {
        const failure = preflight.checks.find((check) => check.severity === "fail");
        return createSessionResponse(failSession(session, failure?.code || "preflight_failed", failure?.summary || "Codex preflight failed.", failure?.remediation || ""));
      }

      const authStatus = await getCodexAuthStatus();
      if (authStatus.ok) {
        updateSession(session, {
          state: "authenticated",
          output: authStatus.output,
          persistenceVerified: await verifyProviderPersistence("codex")
        });
        return createSessionResponse(session);
      }

      const dockerBinary = await getDockerBinaryPath();
      let child;
      try {
        child = ptyImpl.spawn(dockerBinary, ["exec", "-it", containerName, "sh", "-lc", "codex login"], {
          name: "xterm-color",
          cols: 120,
          rows: 30,
          cwd: processCwd,
          env: processEnv
        });
      } catch (error) {
        return createSessionResponse(failSession(session, "interactive_session_start_failed", error instanceof Error ? error.message : String(error), "Ensure the local auth broker runtime supports interactive PTY sessions."));
      }

      updateSession(session, {
        state: "starting",
        process: child,
        requiresCode: false,
        output: ""
      });

      if (typeof child.onData === "function") {
        child.onData((data) => {
          session.output += data;
          const login = extractCodexDeviceLogin(session.output);
          if (login) {
            updateSession(session, {
              browserUrl: login.url,
              code: login.code,
              state: "waiting_for_browser"
            });
          }
        });
      }

      if (typeof child.onExit === "function") {
        child.onExit(({ exitCode }) => {
          if (session.state !== "authenticated" && session.state !== "cancelled") {
            failSession(session, "interactive_session_ended", `Interactive ${displayNameImpl(session.provider)} session exited with status ${exitCode}.`, "Restart the auth session from the wizard.");
          }
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 600));
      if (!session.browserUrl && session.state === "starting") {
        const cleanedOutput = stripAnsi(session.output).toLowerCase();
        if (cleanedOutput.includes("device")) {
          updateSession(session, { state: "waiting_for_browser" });
        }
      }

      return createSessionResponse(session);
    },

    async refresh(session) {
      if (session.state === "authenticated") {
        return createSessionResponse(session);
      }

      const authStatus = await getCodexAuthStatus();
      if (authStatus.ok) {
        updateSession(session, {
          state: "authenticated",
          output: authStatus.output,
          persistenceVerified: await verifyProviderPersistence("codex"),
          process: null
        });
      }
      return createSessionResponse(session);
    }
  };
}
