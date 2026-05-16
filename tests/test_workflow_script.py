from pathlib import Path


def test_claude_legacy_args_are_migrated_before_invocation():
    script = Path("jira_ticket_to_pr.sh").read_text()

    assert 'CLAUDE_EXEC_ARGS="$(strip_wrapping_quotes "${CLAUDE_EXEC_ARGS}")"' in script
    assert 'if [[ "${CLAUDE_EXEC_ARGS}" == "--allowedTools Bash,Edit,Write,Read" || "${CLAUDE_EXEC_ARGS}" == "--permission-mode bypassPermissions" ]]; then' in script
    assert 'CLAUDE_EXEC_ARGS="${CONTAINER_SAFE_CLAUDE_EXEC_ARGS}"' in script
    assert 'CONTAINER_SAFE_CLAUDE_EXEC_ARGS="--permission-mode auto --allowedTools Bash,Read,Edit,Write"' in script


def test_generated_jira_brief_is_excluded_from_empty_pr_guard():
    script = Path("jira_ticket_to_pr.sh").read_text()

    assert 'git -C "${TARGET_DIR}" add -A -- . ":(exclude)${SPEC_FILE}"' in script
    assert 'git -C "${TARGET_DIR}" reset -q -- "${SPEC_FILE}"' in script
    assert 'git -C "${TARGET_DIR}" diff --quiet "origin/${BASE_BRANCH}...HEAD" -- . ":(exclude)${SPEC_FILE}"' in script
