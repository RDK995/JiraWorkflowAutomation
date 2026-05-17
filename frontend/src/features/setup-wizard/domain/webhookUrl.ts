export function getConfiguredWebhookUrl(isNgrokEnabled: boolean, ngrokDomain: string): string {
  if (!isNgrokEnabled || !ngrokDomain) {
    return "";
  }

  const baseUrl = `https://${ngrokDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return `${baseUrl}/webhooks/jira-transition`;
}
