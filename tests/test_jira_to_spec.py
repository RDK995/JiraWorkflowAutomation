import unittest
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
