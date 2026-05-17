export type AiAgent = "codex" | "claude";

export type DeviceLoginPrompt = {
  url: string;
  code: string;
  expiryText: string;
};

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

export function extractDeviceLogin(text: string, agent: AiAgent): DeviceLoginPrompt | null {
  const cleaned = stripAnsi(text || "");
  if (agent === "codex") {
    const urlMatch = cleaned.match(/https:\/\/auth\.openai\.com\/codex\/device/i);
    const codeMatch = cleaned.match(/\b[A-Z0-9]{4}-[A-Z0-9]{5}\b/);
    const expiryMatch = cleaned.match(/expires in\s+([^) \n]+)/i);

    if (!urlMatch || !codeMatch) {
      return null;
    }

    return {
      url: urlMatch[0],
      code: codeMatch[0],
      expiryText: expiryMatch ? `Code expires in ${expiryMatch[1]}.` : ""
    };
  }

  const marker = "Starting interactive Claude Code device auth...";
  const markerIndex = cleaned.lastIndexOf(marker);
  const searchArea = markerIndex >= 0 ? cleaned.slice(markerIndex) : cleaned;
  const urlMatch = searchArea.match(/https:\/\/[^\s)]+/i);
  const codeMatch =
    searchArea.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,}\b/) ||
    searchArea.match(/\b[A-Z0-9]{6,}\b/);

  if (!urlMatch) {
    return null;
  }

  return {
    url: urlMatch[0],
    code: codeMatch?.[0] || "",
    expiryText: ""
  };
}
