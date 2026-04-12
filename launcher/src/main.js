import { invoke } from "@tauri-apps/api/core";
import "./styles.css";

const repoStatus = document.querySelector("#repo-status");
const nodeStatus = document.querySelector("#node-status");
const frontendStatus = document.querySelector("#frontend-status");
const apiStatus = document.querySelector("#api-status");
const messageTitle = document.querySelector("#message-title");
const messageText = document.querySelector("#message-text");
const setupUrl = document.querySelector("#setup-url");
const repoRoot = document.querySelector("#repo-root");
const startButton = document.querySelector("#start-button");
const openButton = document.querySelector("#open-button");
const refreshButton = document.querySelector("#refresh-button");

function setStatus(id, ok, text) {
  const pill = document.querySelector(`[data-status="${id}"]`);
  if (pill) {
    pill.dataset.ok = ok ? "true" : "false";
  }
  const targetMap = {
    repo: repoStatus,
    node: nodeStatus,
    frontend: frontendStatus,
    api: apiStatus
  };
  const target = targetMap[id];
  if (target) {
    target.textContent = text;
  }
}

function renderStatus(status) {
  setStatus("repo", Boolean(status.repo_root), status.repo_root ? "Found" : "Missing");
  setStatus("node", status.node_available, status.node_available ? "Available" : "Missing");
  setStatus("frontend", status.frontend_bundle_ready, status.frontend_bundle_ready ? "Ready" : "Missing");
  setStatus("api", status.setup_api_running, status.setup_api_running ? "Running" : "Stopped");

  setupUrl.textContent = status.setup_url;
  repoRoot.textContent = status.repo_root ? `Workspace: ${status.repo_root}` : "Workspace not found yet.";
  openButton.disabled = !status.setup_api_running;
}

function renderMessage(title, text) {
  messageTitle.textContent = title;
  messageText.textContent = text;
}

async function refreshStatus() {
  startButton.disabled = true;
  refreshButton.disabled = true;
  try {
    const status = await invoke("get_launcher_status");
    renderStatus(status);
    renderMessage(
      "Launcher status",
      status.setup_api_running
        ? "The setup API is already running. You can open the setup flow now."
        : "The launcher is ready to start the local setup flow."
    );
  } catch (error) {
    renderMessage("Launcher error", error?.toString?.() || "Could not determine launcher status.");
  } finally {
    startButton.disabled = false;
    refreshButton.disabled = false;
  }
}

async function startSetupFlow() {
  startButton.disabled = true;
  openButton.disabled = true;
  renderMessage("Starting PRonto setup", "Launching the local setup API and waiting for the setup flow to become available.");
  try {
    const status = await invoke("start_setup_flow");
    renderStatus(status);
    renderMessage("Setup is ready", "PRonto opened the setup flow in your browser. If it did not open automatically, use the button below.");
  } catch (error) {
    renderMessage("Could not start setup", error?.toString?.() || "Launcher failed to start the setup flow.");
  } finally {
    startButton.disabled = false;
  }
}

async function openSetupInBrowser() {
  openButton.disabled = true;
  try {
    await invoke("open_setup_in_browser");
  } catch (error) {
    renderMessage("Could not open browser", error?.toString?.() || "Open the setup URL manually.");
  } finally {
    openButton.disabled = false;
  }
}

startButton?.addEventListener("click", () => void startSetupFlow());
openButton?.addEventListener("click", () => void openSetupInBrowser());
refreshButton?.addEventListener("click", () => void refreshStatus());

void refreshStatus();
