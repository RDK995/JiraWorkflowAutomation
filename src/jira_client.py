import base64
from typing import Any

import requests


class JiraClient:
    def __init__(self, base_url: str, user_email: str, api_token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.auth_header = "Basic " + base64.b64encode(f"{user_email}:{api_token}".encode("utf-8")).decode("utf-8")

    def add_issue_comment(self, issue_key: str, comment_body: str) -> None:
        payload = {
            "body": {
                "type": "doc",
                "version": 1,
                "content": [{"type": "paragraph", "content": [{"type": "text", "text": comment_body}]}],
            }
        }
        response = requests.post(
            f"{self.base_url}/rest/api/3/issue/{issue_key}/comment",
            headers={
                "Authorization": self.auth_header,
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=30,
        )
        if not response.ok:
            raise RuntimeError(f"Jira comment creation failed ({response.status_code}): {response.text}")

    def transition_issue_to_status(self, issue_key: str, target_status: str) -> None:
        transitions_resp = requests.get(
            f"{self.base_url}/rest/api/3/issue/{issue_key}/transitions",
            headers={
                "Authorization": self.auth_header,
                "Accept": "application/json",
            },
            timeout=30,
        )
        if not transitions_resp.ok:
            raise RuntimeError(
                f"Jira transitions fetch failed ({transitions_resp.status_code}): {transitions_resp.text}"
            )

        transitions = (transitions_resp.json() or {}).get("transitions", [])
        target = _find_transition(transitions, target_status)
        if not target:
            available = ", ".join(sorted({((t.get("to") or {}).get("name") or "UNKNOWN") for t in transitions}))
            raise RuntimeError(
                f"Transition to '{target_status}' not available for {issue_key}. Available: {available or 'none'}"
            )

        apply_resp = requests.post(
            f"{self.base_url}/rest/api/3/issue/{issue_key}/transitions",
            headers={
                "Authorization": self.auth_header,
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json={"transition": {"id": target.get("id")}},
            timeout=30,
        )
        if not apply_resp.ok:
            raise RuntimeError(
                f"Jira transition apply failed ({apply_resp.status_code}): {apply_resp.text}"
            )


def _find_transition(transitions: list[dict[str, Any]], target_status: str) -> dict[str, Any] | None:
    return next((transition for transition in transitions if (transition.get("to") or {}).get("name") == target_status), None)
