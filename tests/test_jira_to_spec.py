import unittest
from unittest.mock import Mock, patch

from tools.jira import jira_to_spec


class JiraToSpecTests(unittest.TestCase):
    def test_extract_description_text_from_string(self):
        self.assertEqual(jira_to_spec.extract_description_text("  hello  "), "hello")

    def test_extract_description_text_from_adf(self):
        adf = {
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "Line one"}]},
                {"type": "paragraph", "content": [{"type": "text", "text": "Line two"}]},
            ],
        }
        text = jira_to_spec.extract_description_text(adf)
        self.assertIn("Line one", text)
        self.assertIn("Line two", text)

    def test_extract_acceptance_criteria_section(self):
        description = """
Requirements:
Do A and B.

Acceptance Criteria:
- Works for input X
- Handles failure Y

Out of scope:
Z
"""
        ac = jira_to_spec.extract_acceptance_criteria(description)
        self.assertIn("Works for input X", ac)
        self.assertIn("Handles failure Y", ac)

    def test_extract_acceptance_criteria_fallback(self):
        ac = jira_to_spec.extract_acceptance_criteria("No AC heading here")
        self.assertIn("not explicitly found", ac)

    def test_flatten_adf_list_formatting(self):
        adf = {
            "type": "doc",
            "content": [
                {
                    "type": "bulletList",
                    "content": [
                        {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "A"}]}]},
                        {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "B"}]}]},
                    ],
                }
            ],
        }
        text = jira_to_spec.flatten_adf(adf)
        self.assertIn("- A", text)
        self.assertIn("- B", text)

    def test_require_env_any_prefers_first_present(self):
        with patch.dict("os.environ", {"JIRA_BASE_URL": "https://example.atlassian.net"}, clear=True):
            value = jira_to_spec.require_env_any(["JIRA_BASE", "JIRA_BASE_URL"])
        self.assertEqual(value, "https://example.atlassian.net")

    def test_require_env_any_uses_alias_when_present(self):
        with patch.dict("os.environ", {"JIRA_BASE": "https://alias.atlassian.net"}, clear=True):
            value = jira_to_spec.require_env_any(["JIRA_BASE", "JIRA_BASE_URL"])
        self.assertEqual(value, "https://alias.atlassian.net")

    def test_normalize_repo_slug_allows_dotted_name_https(self):
        slug = jira_to_spec.normalize_repo_slug("https://github.com/org/repo.name.git")
        self.assertEqual(slug, "org/repo.name")

    def test_normalize_repo_slug_allows_dotted_name_ssh(self):
        slug = jira_to_spec.normalize_repo_slug("git@github.com:org/repo.name.git")
        self.assertEqual(slug, "org/repo.name")

    def test_extract_target_repository_prefers_structured_field(self):
        fields = {"GitHub Repo": {"value": "org/from-field"}}
        slug = jira_to_spec.extract_target_repository(fields, "GitHub Repo: org/from-description")
        self.assertEqual(slug, "org/from-field")

    def test_extract_target_repository_falls_back_to_description(self):
        slug = jira_to_spec.extract_target_repository({}, "GitHub Repo: org/from-description")
        self.assertEqual(slug, "org/from-description")

    def test_extract_target_repository_falls_back_to_github_url(self):
        slug = jira_to_spec.extract_target_repository({}, "See https://github.com/org/from-url.git for details")
        self.assertEqual(slug, "org/from-url")

    def test_get_issue_returns_json_payload(self):
        response = Mock()
        response.read.return_value = b'{"key":"KAN-123"}'
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=None)

        with patch("urllib.request.urlopen", return_value=response):
            issue = jira_to_spec.get_issue("https://example.atlassian.net", "user@example.com", "token", "KAN-123")

        self.assertEqual(issue["key"], "KAN-123")

    def test_extract_description_text_handles_none(self):
        self.assertEqual(jira_to_spec.extract_description_text(None), "")


if __name__ == "__main__":
    unittest.main()
