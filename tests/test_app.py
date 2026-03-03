import importlib
import os
import unittest
from unittest.mock import patch


def load_app_module():
    os.environ["JIRA_BASE_URL"] = "https://example.atlassian.net"
    os.environ["JIRA_USER_EMAIL"] = "user@example.com"
    os.environ["JIRA_API_TOKEN"] = "token"
    os.environ["CODEX_API_KEY"] = "sk-test"
    os.environ["READY_STATUS"] = "To Do"
    os.environ["IN_PROGRESS_STATUS"] = "In Progress"
    os.environ["JIRA_WEBHOOK_SECRET"] = ""
    module = importlib.import_module("src.app")
    return importlib.reload(module)


class AppLogicTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app_module = load_app_module()

    def test_transition_match(self):
        payload = {
            "changelog": {
                "items": [{"field": "status", "fromString": "To Do", "toString": "In Progress"}]
            }
        }
        self.assertTrue(self.app_module.was_transitioned_to_in_progress(payload))

    def test_transition_non_match(self):
        payload = {
            "changelog": {
                "items": [{"field": "status", "fromString": "Backlog", "toString": "In Progress"}]
            }
        }
        self.assertFalse(self.app_module.was_transitioned_to_in_progress(payload))

    def test_build_prompt_contains_key_and_url(self):
        self.assertTrue(self.app_module.WORKFLOW_SCRIPT.endswith("jira_ticket_to_pr.sh"))

    def test_run_codex_cli_workflow_missing_script(self):
        with patch.object(self.app_module, "WORKFLOW_SCRIPT", "./does-not-exist.sh"):
            with self.assertRaises(RuntimeError):
                self.app_module.run_codex_cli_workflow("KAN-123")


class AppRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app_module = load_app_module()

    def setUp(self):
        self.client = self.app_module.app.test_client()

    def test_health_route(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["status"], "ok")

    def test_webhook_skips_non_target_transition(self):
        payload = {"changelog": {"items": [{"field": "status", "fromString": "Backlog", "toString": "Ready"}]}}
        response = self.client.post("/webhooks/jira-transition", json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["skipped"])

    def test_webhook_missing_issue_key(self):
        payload = {"changelog": {"items": [{"field": "status", "fromString": "To Do", "toString": "In Progress"}]}}
        response = self.client.post("/webhooks/jira-transition", json=payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("Missing issue key", response.json["error"])

    def test_webhook_happy_path(self):
        payload = {
            "issue": {"key": "KAN-123"},
            "changelog": {"items": [{"field": "status", "fromString": "To Do", "toString": "In Progress"}]},
        }
        with patch.object(self.app_module, "enqueue_automation", return_value=None):
            response = self.client.post("/webhooks/jira-transition", json=payload)
        self.assertEqual(response.status_code, 202)
        self.assertTrue(response.json["queued"])


if __name__ == "__main__":
    unittest.main()
