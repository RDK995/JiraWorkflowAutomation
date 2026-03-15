import importlib
import os
import unittest
from unittest.mock import Mock, patch


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

    def test_extract_pr_url(self):
        text = "Created PR https://github.com/org/repo/pull/45 successfully"
        self.assertEqual(self.app_module.extract_pr_url(text), "https://github.com/org/repo/pull/45")

    def test_extract_pr_url_returns_empty_string_when_missing(self):
        self.assertEqual(self.app_module.extract_pr_url("no pr here"), "")

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

    def test_transition_issue_to_status_success(self):
        get_resp = Mock()
        get_resp.ok = True
        get_resp.json.return_value = {
            "transitions": [
                {"id": "31", "to": {"name": "In Review"}},
                {"id": "41", "to": {"name": "Done"}},
            ]
        }

        post_resp = Mock()
        post_resp.ok = True

        with patch("src.app.requests.get", return_value=get_resp) as mock_get, patch(
            "src.app.requests.post", return_value=post_resp
        ) as mock_post:
            self.app_module.transition_issue_to_status("KAN-123", "In Review")

        self.assertTrue(mock_get.called)
        self.assertTrue(mock_post.called)

    def test_transition_issue_to_status_missing_target(self):
        get_resp = Mock()
        get_resp.ok = True
        get_resp.json.return_value = {"transitions": [{"id": "41", "to": {"name": "Done"}}]}

        with patch("src.app.requests.get", return_value=get_resp):
            with self.assertRaises(RuntimeError):
                self.app_module.transition_issue_to_status("KAN-123", "In Review")

    def test_add_issue_comment_raises_on_failed_request(self):
        response = Mock()
        response.ok = False
        response.status_code = 403
        response.text = "forbidden"

        with patch("src.app.requests.post", return_value=response):
            with self.assertRaises(RuntimeError):
                self.app_module.add_issue_comment("KAN-123", "Hello")

    def test_run_automation_transitions_when_pr_present(self):
        with patch.object(
            self.app_module, "run_codex_cli_workflow", return_value="https://github.com/org/repo/pull/12"
        ), patch.object(self.app_module, "add_issue_comment") as comment_mock, patch.object(
            self.app_module, "transition_issue_to_status"
        ) as transition_mock:
            self.app_module.run_automation_for_issue("KAN-123")

        self.assertTrue(comment_mock.called)
        transition_mock.assert_called_once_with("KAN-123", self.app_module.IN_REVIEW_STATUS)

    def test_run_automation_transitions_when_comments_disabled(self):
        with patch.object(
            self.app_module, "run_codex_cli_workflow", return_value="https://github.com/org/repo/pull/12"
        ), patch.object(self.app_module, "POST_WORKFLOW_RESULT_TO_JIRA", False), patch.object(
            self.app_module, "add_issue_comment"
        ) as comment_mock, patch.object(self.app_module, "transition_issue_to_status") as transition_mock:
            self.app_module.run_automation_for_issue("KAN-123")

        comment_mock.assert_not_called()
        transition_mock.assert_called_once_with("KAN-123", self.app_module.IN_REVIEW_STATUS)

    def test_run_automation_comments_error_on_failure(self):
        with patch.object(
            self.app_module, "run_codex_cli_workflow", side_effect=RuntimeError("boom")
        ), patch.object(self.app_module, "add_issue_comment") as comment_mock:
            self.app_module.run_automation_for_issue("KAN-123")

        self.assertTrue(comment_mock.called)
        self.assertIn("failed", comment_mock.call_args.args[1].lower())


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

    def test_webhook_rejects_invalid_secret(self):
        payload = {
            "issue": {"key": "KAN-123"},
            "changelog": {"items": [{"field": "status", "fromString": "To Do", "toString": "In Progress"}]},
        }
        with patch.object(self.app_module, "JIRA_WEBHOOK_SECRET", "expected-secret"):
            response = self.client.post(
                "/webhooks/jira-transition",
                json=payload,
                headers={"x-jira-webhook-secret": "wrong-secret"},
            )
        self.assertEqual(response.status_code, 401)
        self.assertIn("Invalid webhook secret", response.json["error"])

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

    def test_webhook_returns_500_when_enqueue_fails(self):
        payload = {
            "issue": {"key": "KAN-123"},
            "changelog": {"items": [{"field": "status", "fromString": "To Do", "toString": "In Progress"}]},
        }
        with patch.object(self.app_module, "enqueue_automation", side_effect=RuntimeError("queue failed")):
            response = self.client.post("/webhooks/jira-transition", json=payload)
        self.assertEqual(response.status_code, 500)
        self.assertIn("queue failed", response.json["error"])


if __name__ == "__main__":
    unittest.main()
