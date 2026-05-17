from src.workflow_output import extract_pr_url, humanize_workflow_line


def test_extract_pr_url_returns_first_github_pull_request_url():
    text = "Created https://github.com/org/repo/pull/45 and then https://github.com/org/repo/pull/46"

    assert extract_pr_url(text) == "https://github.com/org/repo/pull/45"


def test_extract_pr_url_returns_empty_string_when_missing():
    assert extract_pr_url("no pull request here") == ""


def test_humanize_workflow_line_keeps_high_signal_progress():
    assert humanize_workflow_line("Step 4 of 6: Preparing branch jira/KAN-8 from main.") is not None
    assert humanize_workflow_line("GitHub branch push completed.") == "GitHub branch push completed."
    assert humanize_workflow_line("https://github.com/org/repo/pull/45") == (
        "Pull request created successfully: https://github.com/org/repo/pull/45"
    )


def test_humanize_workflow_line_filters_low_signal_output():
    assert humanize_workflow_line("Warning: 1 uncommitted change") is None
    assert humanize_workflow_line("19876") is None
