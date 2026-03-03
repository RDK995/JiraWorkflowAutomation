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
SPEC_DIR=".codex"
SPEC_FILE="${SPEC_DIR}/${JIRA_KEY}.md"
BRANCH_NAME="jira/${JIRA_KEY}"
TARGET_DIR="${SCRIPT_DIR}"
TARGET_REPO_SLUG=""
TARGET_REPO_CLONE_URL=""
CODEX_EXEC_ARGS="${CODEX_EXEC_ARGS:---full-auto}"

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

  if [[ "${input}" =~ ^https://github\.com/([^/]+/[^/.]+)(\.git)?$ ]]; then
    TARGET_REPO_SLUG="${BASH_REMATCH[1]}"
    TARGET_REPO_CLONE_URL="${input}"
    return 0
  fi

  if [[ "${input}" =~ ^git@github\.com:([^/]+/[^/.]+)(\.git)?$ ]]; then
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
    echo "Using existing local clone: ${local_repo_dir}"
    git -C "${local_repo_dir}" fetch origin
  else
    echo "Cloning ${TARGET_REPO_SLUG} into ${local_repo_dir}"
    git clone "${TARGET_REPO_CLONE_URL}" "${local_repo_dir}"
  fi

  TARGET_DIR="${local_repo_dir}"
}

resolve_target_repo "${TARGET_REPO_INPUT}"

if ! gh auth status -h github.com >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Set GITHUB_TOKEN/GH_TOKEN or run: gh auth login" >&2
  exit 1
fi

echo "Generating Jira spec: ${SPEC_FILE}"
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

mkdir -p "${TARGET_DIR}/${SPEC_DIR}"
cp "${SCRIPT_DIR}/${SPEC_FILE}" "${TARGET_DIR}/${SPEC_FILE}"

echo "Preparing branch: ${BRANCH_NAME} from origin/${BASE_BRANCH}"
git -C "${TARGET_DIR}" fetch origin "${BASE_BRANCH}"
git -C "${TARGET_DIR}" checkout -B "${BRANCH_NAME}" "origin/${BASE_BRANCH}"

echo "Running Codex implementation workflow"
CODEX_PROMPT=$(cat <<EOF
Read the Jira spec at ${TARGET_DIR}/${SPEC_FILE}.

Implement all required changes in this repository for ${JIRA_KEY}.
Run tests/checks, fix any failures, and ensure the project is in a good state.
Commit your changes with a commit message that includes "${JIRA_KEY}".
EOF
)

(cd "${TARGET_DIR}" && codex exec ${CODEX_EXEC_ARGS} "${CODEX_PROMPT}")

echo "Pushing branch to origin"
git -C "${TARGET_DIR}" push -u origin "${BRANCH_NAME}"

ISSUE_SUMMARY_LINE="$(head -n 1 "${TARGET_DIR}/${SPEC_FILE}")"
PR_SUMMARY="${ISSUE_SUMMARY_LINE#\# ${JIRA_KEY}: }"
PR_TITLE="${JIRA_KEY}: ${PR_SUMMARY}"

echo "Creating PR against ${BASE_BRANCH}"
if [[ -n "${TARGET_REPO_SLUG}" ]]; then
  (cd "${TARGET_DIR}" && gh pr create \
    --repo "${TARGET_REPO_SLUG}" \
    --title "${PR_TITLE}" \
    --body-file "${SPEC_FILE}" \
    --base "${BASE_BRANCH}")
else
  (cd "${TARGET_DIR}" && gh pr create \
    --title "${PR_TITLE}" \
    --body-file "${SPEC_FILE}" \
    --base "${BASE_BRANCH}")
fi

echo "Done."
