export function extractPullRequestUrls(text: string): string[] {
  const matches = text.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/g) || [];
  return Array.from(new Set(matches));
}
