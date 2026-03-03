#!/usr/bin/env python3
import base64
import os
import subprocess
import sys

import requests
from dotenv import load_dotenv

load_dotenv()

JIRA_BASE_URL = os.getenv("JIRA_BASE_URL", "").rstrip("/")
JIRA_USER_EMAIL = os.getenv("JIRA_USER_EMAIL", "")
JIRA_API_TOKEN = os.getenv("JIRA_API_TOKEN", "")


def require_env(names: list[str]) -> None:
    missing = [name for name in names if not os.getenv(name)]
    if missing:
        raise RuntimeError(f"Missing required env vars: {', '.join(missing)}")


def test_jira() -> dict:
    auth = base64.b64encode(f"{JIRA_USER_EMAIL}:{JIRA_API_TOKEN}".encode("utf-8")).decode("utf-8")
    response = requests.get(
        f"{JIRA_BASE_URL}/rest/api/3/myself",
        headers={"Authorization": f"Basic {auth}", "Accept": "application/json"},
        timeout=30,
    )
    if not response.ok:
        raise RuntimeError(f"Jira test failed ({response.status_code}): {response.text}")
    data = response.json()
    return {
        "accountId": data.get("accountId"),
        "emailAddress": data.get("emailAddress"),
        "displayName": data.get("displayName"),
    }


def test_codex_cli() -> dict:
    version_proc = subprocess.run(["codex", "--version"], capture_output=True, text=True, timeout=15)
    if version_proc.returncode != 0:
        raise RuntimeError(f"Codex CLI not available: {version_proc.stderr.strip()}")

    status_proc = subprocess.run(["codex", "login", "status"], capture_output=True, text=True, timeout=20)
    if status_proc.returncode != 0:
        raise RuntimeError(f"Codex CLI login check failed: {status_proc.stderr.strip()}")

    return {"version": version_proc.stdout.strip(), "login_status": status_proc.stdout.strip()}


def main() -> None:
    require_env(["JIRA_BASE_URL", "JIRA_USER_EMAIL", "JIRA_API_TOKEN"])

    print("Testing Jira integration...")
    jira_result = test_jira()
    print("Jira OK:", jira_result)

    print("Testing Codex CLI integration...")
    codex_result = test_codex_cli()
    print("Codex CLI OK:", codex_result)

    print("All integration checks passed.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
