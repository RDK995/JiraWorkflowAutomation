import re
from typing import Optional

PR_URL_PATTERN = re.compile(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/\d+")


def extract_pr_url(text: str) -> str:
    match = PR_URL_PATTERN.search(text or "")
    return match.group(0) if match else ""


def humanize_workflow_line(line: str) -> Optional[str]:
    normalized = line.strip()
    lowered = normalized.lower()

    pr_url = extract_pr_url(normalized)
    if pr_url:
        return f"Pull request created successfully: {pr_url}"

    if normalized.startswith("Step "):
        return normalized

    if normalized.startswith(("Codex is reading the Jira brief", "Claude Code is reading the Jira brief")):
        return normalized

    if normalized.endswith("is still running. PRonto is waiting for the AI tool to finish its work..."):
        return normalized

    if normalized.startswith("GitHub rejected the first push"):
        return normalized

    if normalized.startswith("Creating the pull request against"):
        return normalized

    if normalized in {"GitHub branch push completed.", "Pull request creation step finished."}:
        return normalized

    if normalized.startswith(
        (
            "Could not determine target repo",
            "GitHub CLI is not authenticated",
            "Unknown AI_AGENT",
            "Invalid github-repo value",
            "error:",
        )
    ):
        return normalized

    if "failed" in lowered and "workflow failed" not in lowered:
        return normalized

    return None
