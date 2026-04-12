#!/usr/bin/env python3
import base64
import io
import logging
import os
import re
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any, Optional

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request

load_dotenv()

def env_clean(name: str, default: str = "") -> str:
    value = os.getenv(name, default)
    if value is None:
        return default
    cleaned = value.strip()
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {"'", '"'}:
        return cleaned[1:-1]
    return cleaned


PORT = int(env_clean("PORT", "3000"))
JIRA_BASE_URL = env_clean("JIRA_BASE_URL", "").rstrip("/")
JIRA_USER_EMAIL = env_clean("JIRA_USER_EMAIL", "")
JIRA_API_TOKEN = env_clean("JIRA_API_TOKEN", "")
JIRA_WEBHOOK_SECRET = env_clean("JIRA_WEBHOOK_SECRET", "")
READY_STATUS = env_clean("READY_STATUS", "To Do")
IN_PROGRESS_STATUS = env_clean("IN_PROGRESS_STATUS", "In Progress")
IN_REVIEW_STATUS = env_clean("IN_REVIEW_STATUS", "In Review")
AI_AGENT = env_clean("AI_AGENT", "codex")
WORKFLOW_SCRIPT = env_clean("WORKFLOW_SCRIPT", "./jira_ticket_to_pr.sh")
WORKFLOW_BASE_BRANCH = env_clean("WORKFLOW_BASE_BRANCH", "main")
WORKFLOW_TIMEOUT_SECONDS = int(env_clean("WORKFLOW_TIMEOUT_SECONDS", "5400"))
POST_WORKFLOW_RESULT_TO_JIRA = env_clean("POST_WORKFLOW_RESULT_TO_JIRA", "true").lower() == "true"
REPO_ROOT = Path(__file__).resolve().parents[1]

AI_AGENT_LABEL = {"codex": "Codex CLI", "claude": "Claude Code"}.get(AI_AGENT, AI_AGENT)

REQUIRED_ENV = ["JIRA_BASE_URL", "JIRA_USER_EMAIL", "JIRA_API_TOKEN"]
missing = [name for name in REQUIRED_ENV if not os.getenv(name)]
if missing:
    raise RuntimeError(f"Missing required env vars: {', '.join(missing)}")

app = Flask(__name__)

gunicorn_error_logger = logging.getLogger("gunicorn.error")
if gunicorn_error_logger.handlers:
    app.logger.handlers = gunicorn_error_logger.handlers
    app.logger.propagate = False
else:
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s in %(module)s: %(message)s"))
    app.logger.handlers = [stream_handler]
    app.logger.propagate = False

app.logger.setLevel(logging.INFO)

jira_auth_header = "Basic " + base64.b64encode(f"{JIRA_USER_EMAIL}:{JIRA_API_TOKEN}".encode("utf-8")).decode("utf-8")


def has_valid_secret(req: Any) -> bool:
    if not JIRA_WEBHOOK_SECRET:
        return True
    return req.headers.get("x-jira-webhook-secret") == JIRA_WEBHOOK_SECRET


def add_issue_comment(issue_key: str, comment_body: str) -> None:
    # Jira Cloud comments use ADF payloads even for plain-text messages.
    payload = {
        "body": {
            "type": "doc",
            "version": 1,
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": comment_body}]}],
        }
    }
    response = requests.post(
        f"{JIRA_BASE_URL}/rest/api/3/issue/{issue_key}/comment",
        headers={
            "Authorization": jira_auth_header,
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    if not response.ok:
        raise RuntimeError(f"Jira comment creation failed ({response.status_code}): {response.text}")


def transition_issue_to_status(issue_key: str, target_status: str) -> None:
    transitions_resp = requests.get(
        f"{JIRA_BASE_URL}/rest/api/3/issue/{issue_key}/transitions",
        headers={
            "Authorization": jira_auth_header,
            "Accept": "application/json",
        },
        timeout=30,
    )
    if not transitions_resp.ok:
        raise RuntimeError(
            f"Jira transitions fetch failed ({transitions_resp.status_code}): {transitions_resp.text}"
        )

    transitions = (transitions_resp.json() or {}).get("transitions", [])
    target = next((t for t in transitions if (t.get("to") or {}).get("name") == target_status), None)
    if not target:
        available = ", ".join(sorted({((t.get("to") or {}).get("name") or "UNKNOWN") for t in transitions}))
        raise RuntimeError(
            f"Transition to '{target_status}' not available for {issue_key}. Available: {available or 'none'}"
        )

    transition_id = target.get("id")
    apply_resp = requests.post(
        f"{JIRA_BASE_URL}/rest/api/3/issue/{issue_key}/transitions",
        headers={
            "Authorization": jira_auth_header,
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        json={"transition": {"id": transition_id}},
        timeout=30,
    )
    if not apply_resp.ok:
        raise RuntimeError(
            f"Jira transition apply failed ({apply_resp.status_code}): {apply_resp.text}"
        )


def run_ai_workflow(issue_key: str) -> str:
    """Run the AI-powered workflow script (supports both Codex and Claude Code)."""
    script_path = (REPO_ROOT / WORKFLOW_SCRIPT).resolve()
    if not script_path.exists():
        raise RuntimeError(f"Workflow script not found: {script_path}")

    command = [str(script_path), issue_key, WORKFLOW_BASE_BRANCH]
    env = os.environ.copy()
    env["AI_AGENT"] = AI_AGENT
    app.logger.info("Executing workflow script (agent=%s): %s", AI_AGENT, " ".join(command))
    proc = subprocess.Popen(
        command,
        cwd=str(REPO_ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    output_lines: list[str] = []

    def humanize_workflow_line(line: str) -> Optional[str]:
        normalized = line.strip()
        lowered = normalized.lower()

        pr_match = re.search(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/\d+", normalized)
        if pr_match:
            return f"Pull request created successfully: {pr_match.group(0)}"

        if normalized.startswith("Step "):
            return normalized

        if normalized.startswith("Codex is reading the Jira brief") or normalized.startswith("Claude Code is reading the Jira brief"):
            return normalized

        if normalized.endswith("is still running. PRonto is waiting for the AI tool to finish its work..."):
            return normalized

        if normalized.startswith("GitHub rejected the first push"):
            return normalized

        if normalized.startswith("Creating the pull request against"):
            return normalized

        if normalized == "GitHub branch push completed.":
            return normalized

        if normalized == "Pull request creation step finished.":
            return normalized

        if (
            normalized.startswith("Could not determine target repo")
            or normalized.startswith("GitHub CLI is not authenticated")
            or normalized.startswith("Unknown AI_AGENT")
            or normalized.startswith("Invalid github-repo value")
            or normalized.startswith("error:")
        ):
            return normalized

        if "failed" in lowered and "workflow failed" not in lowered:
            return normalized

        return None

    def consume_output(stream: Optional[io.TextIOBase]) -> None:
        if stream is None:
            return
        try:
            for raw_line in iter(stream.readline, ""):
                line = raw_line.rstrip()
                if not line:
                    continue
                output_lines.append(line)
                friendly_line = humanize_workflow_line(line)
                if friendly_line:
                    app.logger.info("workflow[%s]: %s", issue_key, friendly_line)
        finally:
            stream.close()

    output_thread = threading.Thread(target=consume_output, args=(proc.stdout,), daemon=True)
    output_thread.start()

    try:
        return_code = proc.wait(timeout=WORKFLOW_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as exc:
        proc.kill()
        output_thread.join(timeout=2)
        combined = "\n".join(output_lines)
        tail = "\n".join(combined.strip().splitlines()[-30:])
        raise RuntimeError(
            f"{AI_AGENT_LABEL} workflow timed out after {WORKFLOW_TIMEOUT_SECONDS} seconds.\n{tail}"
        ) from exc

    output_thread.join(timeout=2)
    combined = "\n".join(output_lines)
    if return_code != 0:
        tail = "\n".join(combined.strip().splitlines()[-30:])
        if "Blocked on environment access." in combined or "bwrap: No permissions to create a new namespace" in combined:
            raise RuntimeError(
                f"{AI_AGENT_LABEL} could not start inside the PRonto container because sandboxed exec mode is enabled.\n"
                "Use CODEX_EXEC_ARGS=--dangerously-bypass-approvals-and-sandbox for Codex in Docker, then relaunch PRonto.\n"
                f"{tail}"
            )
        raise RuntimeError(f"{AI_AGENT_LABEL} workflow failed (exit {return_code}).\n{tail}")
    return combined.strip()


def extract_pr_url(text: str) -> str:
    match = re.search(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/\d+", text or "")
    return match.group(0) if match else ""


def run_automation_for_issue(issue_key: str) -> None:
    try:
        app.logger.info("Automation started: issue=%s agent=%s", issue_key, AI_AGENT)
        output = run_ai_workflow(issue_key)
        app.logger.info("Automation completed: issue=%s agent=%s", issue_key, AI_AGENT)
        pr_url = extract_pr_url(output)
        if pr_url:
            transition_issue_to_status(issue_key, IN_REVIEW_STATUS)
            app.logger.info("Issue transitioned: issue=%s target_status=%s", issue_key, IN_REVIEW_STATUS)

        if POST_WORKFLOW_RESULT_TO_JIRA:
            if pr_url:
                add_issue_comment(
                    issue_key,
                    f"{AI_AGENT_LABEL} automation completed successfully.\n\n"
                    f"Pull Request: {pr_url}\n"
                    f"Base branch: {WORKFLOW_BASE_BRANCH}",
                )
            else:
                excerpt = "\n".join(output.splitlines()[-20:])[:2800]
                add_issue_comment(
                    issue_key,
                    f"{AI_AGENT_LABEL} automation completed successfully.\n\n"
                    f"Base branch: {WORKFLOW_BASE_BRANCH}\n"
                    f"Workflow output (tail):\n{excerpt}",
                )
    except Exception as exc:
        app.logger.exception("Automation error: issue=%s agent=%s", issue_key, AI_AGENT)
        if POST_WORKFLOW_RESULT_TO_JIRA:
            error_text = str(exc)
            if len(error_text) > 2800:
                error_text = error_text[:2800]
            add_issue_comment(issue_key, f"{AI_AGENT_LABEL} automation failed.\n\nError:\n{error_text}")


def enqueue_automation(issue_key: str) -> None:
    thread = threading.Thread(target=run_automation_for_issue, args=(issue_key,), daemon=True)
    thread.start()


def was_transitioned_to_in_progress(webhook_event: dict[str, Any]) -> bool:
    # We only trigger automation on the explicit Ready -> In Progress transition.
    items = webhook_event.get("changelog", {}).get("items", [])
    status_item = next((item for item in items if item.get("field") == "status"), None)
    if not status_item:
        return False
    return status_item.get("fromString") == READY_STATUS and status_item.get("toString") == IN_PROGRESS_STATUS


@app.get("/health")
def health() -> Any:
    return jsonify({"status": "ok"}), 200


@app.post("/webhooks/jira-transition")
def jira_transition() -> Any:
    body = request.get_json(silent=True) or {}
    issue_key = body.get("issue", {}).get("key")
    status_item = next((item for item in body.get("changelog", {}).get("items", []) if item.get("field") == "status"), {})
    from_status = status_item.get("fromString")
    to_status = status_item.get("toString")
    is_test_request = request.headers.get("x-pronto-webhook-test", "").lower() == "true"
    app.logger.info(
        "Webhook received: issue=%s from=%s to=%s secret_header_present=%s test_request=%s",
        issue_key,
        from_status,
        to_status,
        "x-jira-webhook-secret" in request.headers,
        is_test_request,
    )

    if not has_valid_secret(request):
        app.logger.warning("Webhook rejected: invalid secret (issue=%s)", issue_key)
        return jsonify({"error": "Invalid webhook secret"}), 401

    if is_test_request:
        app.logger.info("Webhook test succeeded: issue=%s from=%s to=%s", issue_key, from_status, to_status)
        return (
            jsonify(
                {
                    "tested": True,
                    "issueKey": issue_key,
                    "fromStatus": from_status,
                    "toStatus": to_status,
                }
            ),
            200,
        )

    if not was_transitioned_to_in_progress(body):
        app.logger.info(
            "Webhook skipped: transition mismatch issue=%s expected=%s->%s got=%s->%s",
            issue_key,
            READY_STATUS,
            IN_PROGRESS_STATUS,
            from_status,
            to_status,
        )
        return (
            jsonify(
                {
                    "skipped": True,
                    "reason": f"Status transition did not match {READY_STATUS} -> {IN_PROGRESS_STATUS}",
                }
            ),
            200,
        )

    if not issue_key:
        app.logger.warning("Webhook rejected: missing issue key")
        return jsonify({"error": "Missing issue key in webhook payload"}), 400

    try:
        enqueue_automation(issue_key)
        return jsonify({"queued": True, "issueKey": issue_key}), 202
    except Exception as exc:
        app.logger.exception("Automation error: issue=%s", issue_key)
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
