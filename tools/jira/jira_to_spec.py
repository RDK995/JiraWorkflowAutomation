#!/usr/bin/env python3
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        print(f"Missing required env var: {name}", file=sys.stderr)
        sys.exit(1)
    return value


def require_env_any(names: list[str]) -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    print(f"Missing required env var: one of {', '.join(names)}", file=sys.stderr)
    sys.exit(1)


def flatten_adf(node) -> str:
    # Best-effort ADF flattening so specs remain readable in markdown output.
    if node is None:
        return ""

    if isinstance(node, str):
        return node

    if isinstance(node, list):
        parts = [flatten_adf(item) for item in node]
        return "".join(part for part in parts if part is not None)

    if not isinstance(node, dict):
        return ""

    node_type = node.get("type")
    content = node.get("content", [])

    if node_type == "text":
        return node.get("text", "")

    if node_type in {"paragraph", "heading"}:
        text = flatten_adf(content).strip()
        return f"{text}\n\n" if text else ""

    if node_type in {"bulletList", "orderedList"}:
        lines = []
        for i, item in enumerate(content, start=1):
            item_text = flatten_adf(item).strip().replace("\n", " ")
            if not item_text:
                continue
            prefix = f"{i}. " if node_type == "orderedList" else "- "
            lines.append(f"{prefix}{item_text}")
        return ("\n".join(lines) + "\n\n") if lines else ""

    if node_type == "listItem":
        return flatten_adf(content)

    if node_type in {"hardBreak"}:
        return "\n"

    if node_type in {"codeBlock"}:
        text = flatten_adf(content).strip()
        return f"```\n{text}\n```\n\n" if text else ""

    if node_type in {"doc", "blockquote", "panel", "expand"}:
        return flatten_adf(content)

    return flatten_adf(content)


def extract_description_text(description_field) -> str:
    if description_field is None:
        return ""
    if isinstance(description_field, str):
        return description_field.strip()
    if isinstance(description_field, dict):
        return flatten_adf(description_field).strip()
    return str(description_field).strip()


def extract_acceptance_criteria(description_text: str) -> str:
    if not description_text:
        return "No Jira description provided. Infer acceptance criteria from summary and issue context."

    pattern = re.compile(
        r"(?:^|\n)\s*(?:#{1,6}\s*)?(acceptance criteria|ac)\s*:?\s*\n(.+?)(?=\n\s*(?:#{1,6}\s*)?[A-Za-z][^\n]{0,80}:?\s*\n|$)",
        re.IGNORECASE | re.DOTALL,
    )
    match = pattern.search(description_text)
    if match:
        return match.group(2).strip()

    return "Acceptance criteria section not explicitly found in Jira description. Infer from requirements above."


def normalize_repo_slug(raw: str) -> str:
    value = raw.strip()
    if not value:
        return ""

    https_match = re.match(r"^https://github\.com/([^/]+/[^/]+)\.git/?$", value, re.IGNORECASE)
    if https_match:
        return https_match.group(1)

    https_match = re.match(r"^https://github\.com/([^/]+/[^/]+)/?$", value, re.IGNORECASE)
    if https_match:
        return https_match.group(1)

    ssh_match = re.match(r"^git@github\.com:([^/]+/[^/]+)\.git$", value, re.IGNORECASE)
    if ssh_match:
        return ssh_match.group(1)

    ssh_match = re.match(r"^git@github\.com:([^/]+/[^/]+)$", value, re.IGNORECASE)
    if ssh_match:
        return ssh_match.group(1)

    slug_match = re.match(r"^([^/\s]+/[^/\s]+)$", value)
    if slug_match:
        return slug_match.group(1)

    return ""


def extract_target_repository(fields: dict, description_text: str) -> str:
    # Prefer explicit structured fields when present.
    for key, value in fields.items():
        if "repo" not in key.lower():
            continue
        if isinstance(value, str):
            slug = normalize_repo_slug(value)
            if slug:
                return slug
        if isinstance(value, dict):
            for nested_key in ("value", "name", "url"):
                nested = value.get(nested_key)
                if isinstance(nested, str):
                    slug = normalize_repo_slug(nested)
                    if slug:
                        return slug

    # Fallback to Jira description conventions.
    for line in description_text.splitlines():
        line_match = re.match(r"^\s*(?:github\s*repo(?:sitory)?|repo(?:sitory)?)\s*:\s*(.+?)\s*$", line, re.IGNORECASE)
        if line_match:
            slug = normalize_repo_slug(line_match.group(1))
            if slug:
                return slug

    generic_match = re.search(r"(https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?)", description_text)
    if generic_match:
        return normalize_repo_slug(generic_match.group(1))

    return ""


def get_issue(jira_base: str, jira_email: str, jira_token: str, issue_key: str) -> dict:
    url = f"{jira_base.rstrip('/')}/rest/api/3/issue/{issue_key}"
    auth = base64.b64encode(f"{jira_email}:{jira_token}".encode("utf-8")).decode("utf-8")
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Basic {auth}",
            "Accept": "application/json",
        },
        method="GET",
    )

    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"Jira API error ({e.code}): {body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Jira connection error: {e.reason}", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: jira_to_spec.py <ISSUE_KEY>", file=sys.stderr)
        sys.exit(1)

    issue_key = sys.argv[1].strip()
    jira_base = require_env_any(["JIRA_BASE", "JIRA_BASE_URL"])
    jira_email = require_env_any(["JIRA_EMAIL", "JIRA_USER_EMAIL"])
    jira_token = require_env_any(["JIRA_TOKEN", "JIRA_API_TOKEN"])

    issue = get_issue(jira_base, jira_email, jira_token, issue_key)
    fields = issue.get("fields", {})
    key = issue.get("key", issue_key)
    summary = (fields.get("summary") or "Untitled issue").strip()
    description_text = extract_description_text(fields.get("description"))
    acceptance = extract_acceptance_criteria(description_text)
    target_repo = extract_target_repository(fields, description_text)

    issue_type = (fields.get("issuetype") or {}).get("name")
    priority = (fields.get("priority") or {}).get("name")
    optional_meta = []
    if issue_type:
        optional_meta.append(f"Issue type: {issue_type}")
    if priority:
        optional_meta.append(f"Priority: {priority}")

    browse_link = f"{jira_base.rstrip('/')}/browse/{key}"

    lines = [
        f"# {key}: {summary}",
        "",
        f"## Context (include link to browse: {browse_link})",
        f"- Jira issue: {browse_link}",
    ]
    lines.extend([f"- {meta}" for meta in optional_meta])
    lines.extend(
        [
            "",
            "## Requirements (from Jira) (rendered description text)",
            description_text if description_text else "No description provided in Jira.",
            "",
            "## Acceptance Criteria (heuristic: find “Acceptance Criteria” section if present, else say infer)",
            acceptance,
            "",
            "## Target Repository",
            target_repo if target_repo else "MISSING_REPOSITORY (add `GitHub Repo: owner/repo` to the Jira ticket)",
            "",
            "## Implementation instructions",
            f"- Reference issue key `{key}` in branch names, commits, and PR descriptions.",
            "- Keep Python style and existing environment variable names consistent with this repo.",
            "- Preserve current Flask webhook behavior and endpoint contracts.",
            "- Add or update tests/checks where possible and keep changes minimal and reviewable.",
        ]
    )

    print("\n".join(lines))


if __name__ == "__main__":
    main()
