#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 3 ]]; then
  echo "Usage: ./jira_ticket_to_pr.sh <JIRA_KEY> [base-branch] [github-repo-override]"
  echo "Example repo formats: owner/repo | https://github.com/owner/repo.git | git@github.com:owner/repo.git"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JIRA_KEY="$1"
BASE_BRANCH="${2:-main}"
TARGET_REPO_INPUT="${3:-${TARGET_GITHUB_REPO:-}}"
AI_AGENT="${AI_AGENT:-codex}"
SPEC_DIR=".codex"
SPEC_FILE="${SPEC_DIR}/${JIRA_KEY}.md"
BRANCH_NAME="jira/${JIRA_KEY}"
TARGET_DIR="${SCRIPT_DIR}"
TARGET_REPO_SLUG=""
TARGET_REPO_CLONE_URL=""
CONTAINER_SAFE_CODEX_EXEC_ARGS="--dangerously-bypass-approvals-and-sandbox"
CONTAINER_SAFE_CLAUDE_EXEC_ARGS="--permission-mode auto --allowedTools Bash,Read,Edit,Write"
CODEX_EXEC_ARGS="${CODEX_EXEC_ARGS:-${CONTAINER_SAFE_CODEX_EXEC_ARGS}}"
CLAUDE_EXEC_ARGS="${CLAUDE_EXEC_ARGS:-${CONTAINER_SAFE_CLAUDE_EXEC_ARGS}}"

strip_wrapping_quotes() {
  local value="$1"
  if [[ "${#value}" -ge 2 ]]; then
    local first="${value:0:1}"
    local last="${value: -1}"
    if [[ "${first}" == "${last}" && ( "${first}" == "'" || "${first}" == '"' ) ]]; then
      value="${value:1:${#value}-2}"
    fi
  fi
  echo "${value}"
}

CLAUDE_EXEC_ARGS="$(strip_wrapping_quotes "${CLAUDE_EXEC_ARGS}")"
if [[ "${CLAUDE_EXEC_ARGS}" == "--allowedTools Bash,Edit,Write,Read" || "${CLAUDE_EXEC_ARGS}" == "--permission-mode bypassPermissions" ]]; then
  echo "Replacing legacy Claude exec args with Docker-safe auto permission mode."
  CLAUDE_EXEC_ARGS="${CONTAINER_SAFE_CLAUDE_EXEC_ARGS}"
fi
if [[ "${AI_AGENT}" == "claude" ]]; then
  AI_AGENT_LABEL="Claude Code"
else
  AI_AGENT_LABEL="Codex CLI"
fi

if [[ "${AI_AGENT}" == "codex" && "${CODEX_EXEC_ARGS}" == *"--full-auto"* && "${CODEX_EXEC_ARGS}" != *"--dangerously-bypass-approvals-and-sandbox"* ]]; then
  echo "CODEX_EXEC_ARGS includes --full-auto, which is not compatible with Codex running inside the PRonto Docker container."
  echo "Replacing --full-auto with --dangerously-bypass-approvals-and-sandbox so the workflow can run inside the container sandbox."
  CODEX_EXEC_ARGS="${CODEX_EXEC_ARGS//--full-auto/--dangerously-bypass-approvals-and-sandbox}"
fi

extract_repo_from_spec() {
  local spec_path="$1"
  local in_section=0
  local line=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "${line}" == "## Target Repository" ]]; then
      in_section=1
      continue
    fi
    if [[ "${in_section}" -eq 1 ]]; then
      if [[ "${line}" =~ ^##[[:space:]] ]]; then
        break
      fi
      if [[ -n "${line// }" ]]; then
        echo "${line}"
        return 0
      fi
    fi
  done < "${spec_path}"
  echo ""
}

resolve_target_repo() {
  local input="$1"
  if [[ -z "${input}" ]]; then
    return 0
  fi

  if [[ "${input}" =~ ^https://github\.com/([^/]+/[^/]+)\.git$ ]]; then
    TARGET_REPO_SLUG="${BASH_REMATCH[1]}"
    TARGET_REPO_CLONE_URL="${input}"
    return 0
  fi

  if [[ "${input}" =~ ^https://github\.com/([^/]+/[^/]+)$ ]]; then
    TARGET_REPO_SLUG="${BASH_REMATCH[1]}"
    TARGET_REPO_CLONE_URL="${input}"
    return 0
  fi

  if [[ "${input}" =~ ^git@github\.com:([^/]+/[^/]+)\.git$ ]]; then
    TARGET_REPO_SLUG="${BASH_REMATCH[1]}"
    TARGET_REPO_CLONE_URL="${input}"
    return 0
  fi

  if [[ "${input}" =~ ^git@github\.com:([^/]+/[^/]+)$ ]]; then
    TARGET_REPO_SLUG="${BASH_REMATCH[1]}"
    TARGET_REPO_CLONE_URL="${input}"
    return 0
  fi

  if [[ "${input}" =~ ^[^/[:space:]]+/[^/[:space:]]+$ ]]; then
    TARGET_REPO_SLUG="${input}"
    TARGET_REPO_CLONE_URL="https://github.com/${TARGET_REPO_SLUG}.git"
    return 0
  fi

  echo "Invalid github-repo value: ${input}" >&2
  exit 1
}

prepare_target_repo() {
  if [[ -z "${TARGET_REPO_CLONE_URL}" ]]; then
    return 0
  fi

  local local_repo_dir="${SCRIPT_DIR}/.codex/repos/${TARGET_REPO_SLUG//\//-}"
  mkdir -p "${SCRIPT_DIR}/.codex/repos"

  if [[ -d "${local_repo_dir}/.git" ]]; then
    echo "Step 2 of 6: Opening the target GitHub repository from the existing local clone."
    git -C "${local_repo_dir}" fetch origin
  else
    echo "Step 2 of 6: Cloning the target GitHub repository for the first time."
    git clone "${TARGET_REPO_CLONE_URL}" "${local_repo_dir}"
  fi

  TARGET_DIR="${local_repo_dir}"
}

run_with_progress_updates() {
  local label="$1"
  local workdir="$2"
  shift 2

  (
    cd "${workdir}"
    "$@"
  ) &
  local command_pid=$!

  while kill -0 "${command_pid}" 2>/dev/null; do
    sleep 20
    if kill -0 "${command_pid}" 2>/dev/null; then
      echo "${label} is still running. PRonto is waiting for the AI tool to finish its work..."
    fi
  done

  wait "${command_pid}"
}

ensure_branch_has_commits() {
  if git -C "${TARGET_DIR}" diff --quiet && git -C "${TARGET_DIR}" diff --cached --quiet; then
    :
  else
    echo "${AI_AGENT_LABEL} left uncommitted changes. Committing them before push."
    git -C "${TARGET_DIR}" add -A
    git -C "${TARGET_DIR}" commit -m "${JIRA_KEY}: implement requested changes"
  fi

  if git -C "${TARGET_DIR}" diff --quiet "origin/${BASE_BRANCH}...HEAD"; then
    echo "${AI_AGENT_LABEL} did not produce any commits different from ${BASE_BRANCH}; refusing to push or create an empty pull request." >&2
    echo "Check the ${AI_AGENT_LABEL} output above for permission prompts, skipped edits, or test failures, then retry the Jira transition." >&2
    exit 1
  fi
}

resolve_target_repo "${TARGET_REPO_INPUT}"

if ! gh auth status -h github.com >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Set GITHUB_TOKEN/GH_TOKEN or run: gh auth login" >&2
  exit 1
fi

echo "Step 1 of 6: Generating the Jira implementation brief from ${JIRA_KEY}."
mkdir -p "${SCRIPT_DIR}/${SPEC_DIR}"
python3 "${SCRIPT_DIR}/tools/jira/jira_to_spec.py" "${JIRA_KEY}" > "${SCRIPT_DIR}/${SPEC_FILE}"

if [[ -z "${TARGET_REPO_INPUT}" ]]; then
  TARGET_REPO_INPUT="$(extract_repo_from_spec "${SCRIPT_DIR}/${SPEC_FILE}")"
  if [[ -z "${TARGET_REPO_INPUT}" || "${TARGET_REPO_INPUT}" == MISSING_REPOSITORY* ]]; then
    echo "Could not determine target repo from Jira ticket." >&2
    echo "Add 'GitHub Repo: owner/repo' to the Jira ticket description template." >&2
    exit 1
  fi
  resolve_target_repo "${TARGET_REPO_INPUT}"
fi

prepare_target_repo

echo "Step 3 of 6: Copying the Jira brief into the target repository."
mkdir -p "${TARGET_DIR}/${SPEC_DIR}"
cp "${SCRIPT_DIR}/${SPEC_FILE}" "${TARGET_DIR}/${SPEC_FILE}"

echo "Step 4 of 6: Preparing branch ${BRANCH_NAME} from ${BASE_BRANCH}."
git -C "${TARGET_DIR}" fetch origin "${BASE_BRANCH}"
git -C "${TARGET_DIR}" checkout -B "${BRANCH_NAME}" "origin/${BASE_BRANCH}"

AI_PROMPT=$(cat <<EOF
Read the Jira spec at ${SPEC_FILE}.

Implement all required changes in this repository for ${JIRA_KEY}.
Run tests/checks, fix any failures, and ensure the project is in a good state.
Commit your changes with a commit message that includes "${JIRA_KEY}".
EOF
)

if [[ "${AI_AGENT}" == "claude" ]]; then
  read -r -a claude_exec_args <<< "${CLAUDE_EXEC_ARGS}"
  echo "Step 5 of 6: Handing the ticket to Claude Code."
  echo "Claude Code is reading the Jira brief, editing files, and running checks. This can take a few minutes."
  run_with_progress_updates "Claude Code implementation workflow" "${TARGET_DIR}" claude -p "${AI_PROMPT}" "${claude_exec_args[@]}" --output-format text
elif [[ "${AI_AGENT}" == "codex" ]]; then
  read -r -a codex_exec_args <<< "${CODEX_EXEC_ARGS}"
  echo "Step 5 of 6: Handing the ticket to Codex."
  echo "Codex is reading the Jira brief, editing files, and running checks. This can take a few minutes."
  run_with_progress_updates "Codex implementation workflow" "${TARGET_DIR}" codex exec "${codex_exec_args[@]}" "${AI_PROMPT}"
else
  echo "Unknown AI_AGENT: ${AI_AGENT}. Supported values: codex, claude" >&2
  exit 1
fi

ensure_branch_has_commits

echo "Step 6 of 6: Pushing the working branch to GitHub."
if ! git -C "${TARGET_DIR}" push -u origin "${BRANCH_NAME}"; then
  echo "GitHub rejected the first push because the remote branch moved. Retrying safely with force-with-lease."
  git -C "${TARGET_DIR}" fetch origin "${BRANCH_NAME}" || true
  git -C "${TARGET_DIR}" push --force-with-lease -u origin "${BRANCH_NAME}"
fi
echo "GitHub branch push completed."

ISSUE_SUMMARY_LINE="$(head -n 1 "${TARGET_DIR}/${SPEC_FILE}")"
PR_SUMMARY="${ISSUE_SUMMARY_LINE#\# ${JIRA_KEY}: }"
PR_TITLE="${JIRA_KEY}: ${PR_SUMMARY}"
PR_BODY_FILE="$(mktemp "/tmp/${JIRA_KEY}-pr-body.XXXXXX")"

cat "${TARGET_DIR}/${SPEC_FILE}" > "${PR_BODY_FILE}"

# Normalize legacy implementation-instruction wording so PR text matches the selected agent.
if [[ "${AI_AGENT}" == "claude" ]]; then
  sed -i.bak \
    -e 's/## Implementation instructions for Codex.*/## Implementation instructions for Claude Code (repo conventions + reference KEY)./g' \
    -e 's/## Implementation instructions$/## Implementation instructions for Claude Code (repo conventions + reference KEY)./g' \
    -e 's/for Codex/for Claude Code/g' \
    "${PR_BODY_FILE}" || true
else
  sed -i.bak \
    -e 's/## Implementation instructions for Claude Code.*/## Implementation instructions for Codex (repo conventions + reference KEY)./g' \
    -e 's/## Implementation instructions$/## Implementation instructions for Codex (repo conventions + reference KEY)./g' \
    -e 's/for Claude Code/for Codex/g' \
    "${PR_BODY_FILE}" || true
fi
rm -f "${PR_BODY_FILE}.bak"

cat >> "${PR_BODY_FILE}" <<EOF

---

## Automation Metadata
- AI Agent: ${AI_AGENT_LABEL}
- Issue Key: ${JIRA_KEY}
- Base Branch: ${BASE_BRANCH}
EOF

echo "Creating the pull request against ${BASE_BRANCH}."
PR_CREATE_OUTPUT=""
if [[ -n "${TARGET_REPO_SLUG}" ]]; then
  if ! PR_CREATE_OUTPUT="$(cd "${TARGET_DIR}" && gh pr create \
    --repo "${TARGET_REPO_SLUG}" \
    --title "${PR_TITLE}" \
    --body-file "${PR_BODY_FILE}" \
    --base "${BASE_BRANCH}" 2>&1)"; then
    if [[ "${PR_CREATE_OUTPUT}" == *"already exists"* ]]; then
      echo "A pull request already exists for ${BRANCH_NAME}. Updating it and reusing the existing PR."
      (cd "${TARGET_DIR}" && gh pr edit "${BRANCH_NAME}" \
        --repo "${TARGET_REPO_SLUG}" \
        --title "${PR_TITLE}" \
        --body-file "${PR_BODY_FILE}" >/dev/null 2>&1 || true)
      EXISTING_PR_URL="$(cd "${TARGET_DIR}" && gh pr view "${BRANCH_NAME}" --repo "${TARGET_REPO_SLUG}" --json url --jq .url 2>/dev/null || true)"
      if [[ -z "${EXISTING_PR_URL}" ]]; then
        echo "${PR_CREATE_OUTPUT}" >&2
        exit 1
      fi
      echo "${EXISTING_PR_URL}"
    else
      echo "${PR_CREATE_OUTPUT}" >&2
      exit 1
    fi
  else
    echo "${PR_CREATE_OUTPUT}"
  fi
else
  if ! PR_CREATE_OUTPUT="$(cd "${TARGET_DIR}" && gh pr create \
    --title "${PR_TITLE}" \
    --body-file "${PR_BODY_FILE}" \
    --base "${BASE_BRANCH}" 2>&1)"; then
    if [[ "${PR_CREATE_OUTPUT}" == *"already exists"* ]]; then
      echo "A pull request already exists for ${BRANCH_NAME}. Updating it and reusing the existing PR."
      (cd "${TARGET_DIR}" && gh pr edit "${BRANCH_NAME}" \
        --title "${PR_TITLE}" \
        --body-file "${PR_BODY_FILE}" >/dev/null 2>&1 || true)
      EXISTING_PR_URL="$(cd "${TARGET_DIR}" && gh pr view "${BRANCH_NAME}" --json url --jq .url 2>/dev/null || true)"
      if [[ -z "${EXISTING_PR_URL}" ]]; then
        echo "${PR_CREATE_OUTPUT}" >&2
        exit 1
      fi
      echo "${EXISTING_PR_URL}"
    else
      echo "${PR_CREATE_OUTPUT}" >&2
      exit 1
    fi
  else
    echo "${PR_CREATE_OUTPUT}"
  fi
fi

echo "Pull request creation step finished."

echo "Done."
