import importlib
import io
import os
import unittest
import subprocess
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

    def test_run_ai_workflow_missing_script(self):
        with patch.object(self.app_module, "WORKFLOW_SCRIPT", "./does-not-exist.sh"):
            with self.assertRaises(RuntimeError):
                self.app_module.run_ai_workflow("KAN-123")

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

        with patch("src.jira_client.requests.get", return_value=get_resp) as mock_get, patch(
            "src.jira_client.requests.post", return_value=post_resp
        ) as mock_post:
            self.app_module.transition_issue_to_status("KAN-123", "In Review")

        self.assertTrue(mock_get.called)
        self.assertTrue(mock_post.called)

    def test_transition_issue_to_status_missing_target(self):
        get_resp = Mock()
        get_resp.ok = True
        get_resp.json.return_value = {"transitions": [{"id": "41", "to": {"name": "Done"}}]}

        with patch("src.jira_client.requests.get", return_value=get_resp):
            with self.assertRaises(RuntimeError):
                self.app_module.transition_issue_to_status("KAN-123", "In Review")

    def test_add_issue_comment_raises_on_failed_request(self):
        response = Mock()
        response.ok = False
        response.status_code = 403
        response.text = "forbidden"

        with patch("src.jira_client.requests.post", return_value=response):
            with self.assertRaises(RuntimeError):
                self.app_module.add_issue_comment("KAN-123", "Hello")

    def test_run_automation_transitions_when_pr_present(self):
        with patch.object(
            self.app_module, "run_ai_workflow", return_value="https://github.com/org/repo/pull/12"
        ), patch.object(self.app_module, "add_issue_comment") as comment_mock, patch.object(
            self.app_module, "transition_issue_to_status"
        ) as transition_mock:
            self.app_module.run_automation_for_issue("KAN-123")

        self.assertTrue(comment_mock.called)
        transition_mock.assert_called_once_with("KAN-123", self.app_module.IN_REVIEW_STATUS)

    def test_run_automation_transitions_when_comments_disabled(self):
        with patch.object(
            self.app_module, "run_ai_workflow", return_value="https://github.com/org/repo/pull/12"
        ), patch.object(self.app_module, "POST_WORKFLOW_RESULT_TO_JIRA", False), patch.object(
            self.app_module, "add_issue_comment"
        ) as comment_mock, patch.object(self.app_module, "transition_issue_to_status") as transition_mock:
            self.app_module.run_automation_for_issue("KAN-123")

        comment_mock.assert_not_called()
        transition_mock.assert_called_once_with("KAN-123", self.app_module.IN_REVIEW_STATUS)

    def test_run_automation_comments_error_on_failure(self):
        with patch.object(
            self.app_module, "run_ai_workflow", side_effect=RuntimeError("boom")
        ), patch.object(self.app_module, "add_issue_comment") as comment_mock:
            self.app_module.run_automation_for_issue("KAN-123")

        self.assertTrue(comment_mock.called)
        self.assertIn("failed", comment_mock.call_args.args[1].lower())

    def test_ai_agent_label_codex(self):
        self.assertIn("Codex", self.app_module.AI_AGENT_LABEL)

    def test_run_ai_workflow_passes_agent_env(self):
        """Verify run_ai_workflow injects AI_AGENT into subprocess env."""
        process = Mock()
        process.stdout = io.StringIO("ok\n")
        process.wait.return_value = 0
        with patch("src.workflow_runner.subprocess.Popen", return_value=process) as mock_popen:
            with patch.object(self.app_module, "WORKFLOW_SCRIPT", "./jira_ticket_to_pr.sh"):
                self.app_module.run_ai_workflow("KAN-123")
            call_kwargs = mock_popen.call_args
            env = call_kwargs.kwargs.get("env") or call_kwargs[1].get("env", {})
            self.assertEqual(env.get("AI_AGENT"), self.app_module.AI_AGENT)

    def test_run_ai_workflow_reports_container_sandbox_guidance_for_bwrap_failure(self):
        process = Mock()
        process.stdout = io.StringIO("Blocked on environment access.\nbwrap: No permissions to create a new namespace\n")
        process.wait.return_value = 1
        with patch("src.workflow_runner.subprocess.Popen", return_value=process):
            with patch.object(self.app_module, "WORKFLOW_SCRIPT", "./jira_ticket_to_pr.sh"):
                with self.assertRaises(RuntimeError) as ctx:
                    self.app_module.run_ai_workflow("KAN-123")

        self.assertIn("--dangerously-bypass-approvals-and-sandbox", str(ctx.exception))

    def test_run_ai_workflow_streams_subprocess_output_into_logs(self):
        process = Mock()
        process.stdout = io.StringIO(
            "Step 1 of 6: Generating the Jira implementation brief from KAN-123.\n"
            "Codex is reading the Jira brief, editing files, and running checks. This can take a few minutes.\n"
            "https://github.com/org/repo/pull/45\n"
            "+ noisy diff line that should not be logged\n"
        )
        process.wait.return_value = 0

        with patch("src.workflow_runner.subprocess.Popen", return_value=process):
            with patch.object(self.app_module.app.logger, "info") as log_mock:
                with patch.object(self.app_module, "WORKFLOW_SCRIPT", "./jira_ticket_to_pr.sh"):
                    output = self.app_module.run_ai_workflow("KAN-123")

        self.assertIn("Step 1 of 6", output)
        logged_messages = " ".join(str(call.args) for call in log_mock.call_args_list)
        self.assertIn("workflow[%s]: %s", logged_messages)
        self.assertIn("KAN-123", logged_messages)
        self.assertIn("Pull request created successfully", logged_messages)
        self.assertNotIn("noisy diff line", logged_messages)

    def test_run_ai_workflow_logs_plain_english_git_progress_but_filters_low_signal_output(self):
        process = Mock()
        process.stdout = io.StringIO(
            "GitHub rejected the first push because the remote branch moved. Retrying safely with force-with-lease.\n"
            "GitHub branch push completed.\n"
            "Creating the pull request against main.\n"
            "Warning: 1 uncommitted change\n"
            "tokens used\n"
            "19876\n"
        )
        process.wait.return_value = 0

        with patch("src.workflow_runner.subprocess.Popen", return_value=process):
            with patch.object(self.app_module.app.logger, "info") as log_mock:
                with patch.object(self.app_module, "WORKFLOW_SCRIPT", "./jira_ticket_to_pr.sh"):
                    self.app_module.run_ai_workflow("KAN-123")

        logged_messages = " ".join(str(call.args) for call in log_mock.call_args_list)
        self.assertIn("GitHub rejected the first push", logged_messages)
        self.assertIn("GitHub branch push completed.", logged_messages)
        self.assertIn("Creating the pull request against main.", logged_messages)
        self.assertNotIn("Warning: 1 uncommitted change", logged_messages)
        self.assertNotIn("tokens used", logged_messages)

    def test_run_ai_workflow_times_out_and_kills_subprocess(self):
        process = Mock()
        process.stdout = io.StringIO("")
        process.wait.side_effect = subprocess.TimeoutExpired(cmd="jira_ticket_to_pr.sh", timeout=10)

        with patch("src.workflow_runner.subprocess.Popen", return_value=process):
            with patch.object(self.app_module, "WORKFLOW_SCRIPT", "./jira_ticket_to_pr.sh"), patch.object(
                self.app_module, "WORKFLOW_TIMEOUT_SECONDS", 10
            ):
                with self.assertRaises(RuntimeError) as ctx:
                    self.app_module.run_ai_workflow("KAN-123")

        process.kill.assert_called_once()
        self.assertIn("timed out after 10 seconds", str(ctx.exception))


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

    def test_webhook_test_request_returns_success_without_queueing(self):
        payload = {
            "issue": {"key": "PRONTO-TEST"},
            "changelog": {"items": [{"field": "status", "fromString": "Ready", "toString": "In Progress"}]},
        }
        with patch.object(self.app_module, "enqueue_automation") as enqueue_mock:
            response = self.client.post(
                "/webhooks/jira-transition",
                json=payload,
                headers={"x-pronto-webhook-test": "true"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["tested"])
        enqueue_mock.assert_not_called()

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
