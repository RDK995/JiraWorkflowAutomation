import type { ReadinessCheckResponse } from "../types/api";

export type DockerGuidance = {
  canOpenDockerDesktop: boolean;
  canStartColima: boolean;
  colimaInstallLink: string;
  dockerErrorHelp: string;
  dockerFailureOutput: string;
  dockerInstallLabel: string;
  dockerInstallLink: string;
  dockerPlatform: string;
  dockerPlatformHelp: string;
  shouldOfferColimaInstall: boolean;
  shouldOfferContextSwitch: boolean;
};

export function getDockerGuidance(dockerCheck: ReadinessCheckResponse | null): DockerGuidance {
  const diagnosis = dockerCheck?.diagnosis;
  const diagnosisCode = diagnosis?.code || "";
  const dockerPlatform = diagnosis?.platform || "";
  const dockerFailureOutput = dockerCheck?.checks?.find((check) => !check.ok)?.output?.toLowerCase() || "";
  const dockerLooksLikeColima =
    diagnosis?.runtime === "colima" || dockerFailureOutput.includes(".colima") || dockerFailureOutput.includes("colima");

  return {
    canOpenDockerDesktop:
      dockerPlatform === "darwin" &&
      (diagnosisCode === "docker_runtime_not_running" ||
        diagnosisCode === "colima_not_installed" ||
        diagnosisCode === "colima_start_failed" ||
        diagnosisCode === "colima_vm_config_error" ||
        diagnosisCode === "docker_context_misconfigured" ||
        !diagnosis),
    canStartColima:
      diagnosisCode !== "colima_broken" &&
      (diagnosisCode === "colima_stopped" ||
        diagnosisCode === "colima_socket_missing" ||
        diagnosisCode === "colima_start_failed" ||
        dockerLooksLikeColima),
    colimaInstallLink: "https://github.com/abiosoft/colima",
    dockerErrorHelp: getDockerErrorHelp(dockerCheck),
    dockerFailureOutput,
    dockerInstallLabel: dockerPlatform === "linux" ? "Open Docker Engine install guide" : "Open Docker Desktop install guide",
    dockerInstallLink: dockerPlatform === "linux" ? "https://docs.docker.com/engine/install/" : "https://www.docker.com/products/docker-desktop/",
    dockerPlatform,
    dockerPlatformHelp: getDockerPlatformHelp(dockerPlatform),
    shouldOfferColimaInstall: diagnosisCode === "colima_not_installed",
    shouldOfferContextSwitch:
      diagnosisCode === "colima_broken" ||
      diagnosisCode === "docker_context_misconfigured" ||
      diagnosisCode === "colima_socket_missing" ||
      diagnosisCode === "docker_runtime_not_running"
  };
}

export function getDockerBuildElapsedLabel(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function getDockerBuildProgressLabel(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 10) {
    return "Starting build...";
  }
  if (totalSeconds < 45) {
    return "Installing system packages...";
  }
  if (totalSeconds < 120) {
    return "Installing Python and npm tools...";
  }
  return "Finalizing image...";
}

function getDockerErrorHelp(dockerCheck: ReadinessCheckResponse | null): string {
  const diagnosisCode = dockerCheck?.diagnosis?.code || "";
  const output = dockerCheck?.checks?.[0]?.output?.toLowerCase() || "";
  if ((!output && !diagnosisCode) || dockerCheck?.ok) {
    return "";
  }
  if (diagnosisCode === "docker_not_installed") {
    return "Docker is not installed yet. Install Docker Desktop or another supported Docker runtime before continuing.";
  }
  if (diagnosisCode === "colima_not_installed") {
    return "Docker is pointed at a Colima context, but Colima is not installed. Install Colima or switch Docker to a different runtime.";
  }
  if (diagnosisCode === "colima_broken") {
    return "The active Colima profile looks broken. Switch Docker to another context, or repair and recreate the Colima profile before retrying.";
  }
  if (diagnosisCode === "colima_start_failed") {
    return "Colima did not start successfully. Review the error output below, then retry or switch Docker to another runtime from this screen.";
  }
  if (diagnosisCode === "colima_vm_config_error") {
    return "Colima could not initialize its VM. Use Docker Desktop from this screen, or repair the local Colima VM setup before retrying.";
  }
  if (diagnosisCode === "colima_stopped" || diagnosisCode === "colima_socket_missing") {
    return "Docker is using Colima, but the Colima runtime is not available. Start Colima from the UI, then rerun the check.";
  }
  if (diagnosisCode === "docker_context_misconfigured") {
    return "Docker is installed, but the active Docker context does not look healthy. Switch to a working context or restart the selected runtime.";
  }
  if (diagnosisCode === "docker_permission_denied") {
    return "Docker is installed, but this user cannot access the Docker socket. Fix local Docker permissions, then retry.";
  }
  if (diagnosisCode === "docker_runtime_not_running") {
    return "Docker is installed but the selected runtime is not running. Start Docker Desktop or Colima, then retry.";
  }
  if (diagnosisCode === "docker_desktop_not_installed") {
    return "Docker Desktop is not installed on this Mac yet. Install it from the link below, open it once, then rerun the system check.";
  }
  if (diagnosisCode === "docker_desktop_open_failed") {
    return "PRonto could not open Docker Desktop automatically. Try opening it yourself, or reinstall Docker Desktop if it is missing or damaged.";
  }
  if (output.includes("failed to fetch") || output.includes("fetch failed") || output.includes("networkerror")) {
    return "PRonto could not reach the local Setup API. This is usually not a Docker problem. Start the Setup API and verify the API URL is reachable from your browser.";
  }
  if (output.includes("request failed: 5")) {
    return "The Setup API is reachable but returned a server error. Restart the Setup API and run the check again.";
  }
  if (output.includes("docker: command not found")) {
    return "Docker CLI is not installed or not in PATH. Install Docker Desktop and reopen your terminal.";
  }
  if (output.includes("cannot connect") || output.includes("is the docker daemon running")) {
    return "Docker is installed but the engine is not running. Open Docker Desktop (or start Colima) and retry.";
  }
  return "The system check failed. Use the options below to verify Setup API connectivity and Docker runtime.";
}

function getDockerPlatformHelp(platform: string): string {
  if (platform === "win32") {
    return "On Windows, start Docker Desktop and wait for the engine to finish initializing.";
  }
  if (platform === "linux") {
    return "On Linux, start your Docker daemon or service, then rerun the system check.";
  }
  return "On macOS, start Docker Desktop or Colima, then rerun the system check.";
}
