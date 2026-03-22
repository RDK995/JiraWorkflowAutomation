#!/usr/bin/env bash
set -euo pipefail

# Persist Codex auth/session across container restarts when mounted as a volume.
CODEX_STATE_DIR="${CODEX_STATE_DIR:-/data/codex}"
mkdir -p "${CODEX_STATE_DIR}"

if [[ -e "/root/.codex" && ! -L "/root/.codex" ]]; then
  cp -R /root/.codex/. "${CODEX_STATE_DIR}/" 2>/dev/null || true
  rm -rf /root/.codex
fi
ln -sfn "${CODEX_STATE_DIR}" /root/.codex

# Persist Claude auth/session across container restarts when mounted as a volume.
CLAUDE_STATE_DIR="${CLAUDE_STATE_DIR:-/data/claude}"
mkdir -p "${CLAUDE_STATE_DIR}"

if [[ -e "/root/.claude" && ! -L "/root/.claude" ]]; then
  cp -R /root/.claude/. "${CLAUDE_STATE_DIR}/" 2>/dev/null || true
  rm -rf /root/.claude
fi
ln -sfn "${CLAUDE_STATE_DIR}" /root/.claude

if [[ -n "${CODEX_API_KEY:-}" && -z "${OPENAI_API_KEY:-}" ]]; then
  # Keep a single source of truth in .env while satisfying tools that expect OPENAI_API_KEY.
  export OPENAI_API_KEY="${CODEX_API_KEY}"
fi

if [[ -n "${JIRA_BASE_URL:-}" && -z "${JIRA_BASE:-}" ]]; then
  # jira_to_spec.py uses the short JIRA_* names.
  export JIRA_BASE="${JIRA_BASE_URL}"
fi

if [[ -n "${JIRA_USER_EMAIL:-}" && -z "${JIRA_EMAIL:-}" ]]; then
  export JIRA_EMAIL="${JIRA_USER_EMAIL}"
fi

if [[ -n "${JIRA_API_TOKEN:-}" && -z "${JIRA_TOKEN:-}" ]]; then
  export JIRA_TOKEN="${JIRA_API_TOKEN}"
fi

if [[ -n "${GH_TOKEN:-}" && -z "${GITHUB_TOKEN:-}" ]]; then
  export GITHUB_TOKEN="${GH_TOKEN}"
fi

if [[ -z "${GIT_AUTHOR_NAME:-}" || "${GIT_AUTHOR_NAME}" == "Codex Bot" || "${GIT_AUTHOR_NAME}" == "Claude Bot" || "${GIT_AUTHOR_NAME}" == "AI Bot" || "${GIT_AUTHOR_NAME}" == "PRonto Bot" ]]; then
  GIT_AUTHOR_NAME="PRonto"
fi

if [[ -n "${GIT_AUTHOR_NAME:-}" ]]; then
  git config --global user.name "${GIT_AUTHOR_NAME}"
fi

if [[ -z "${GIT_AUTHOR_EMAIL:-}" || "${GIT_AUTHOR_EMAIL}" == "codex-bot@example.com" || "${GIT_AUTHOR_EMAIL}" == "claude-bot@example.com" || "${GIT_AUTHOR_EMAIL}" == "ai-bot@example.com" || "${GIT_AUTHOR_EMAIL}" == "pronto-bot@example.com" ]]; then
  GIT_AUTHOR_EMAIL="pronto-bot@example.com"
fi

if [[ -n "${GIT_AUTHOR_EMAIL:-}" ]]; then
  git config --global user.email "${GIT_AUTHOR_EMAIL}"
fi

if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  # Non-interactive auth for containerized git/PR workflows.
  if ! gh auth status -h github.com >/dev/null 2>&1; then
    printf '%s' "${GITHUB_TOKEN}" | gh auth login -h github.com --with-token >/dev/null
  fi
  gh auth setup-git -h github.com >/dev/null
elif [[ "${REQUIRE_GITHUB_AUTH:-false}" == "true" ]]; then
  echo "REQUIRE_GITHUB_AUTH=true but GITHUB_TOKEN/GH_TOKEN is not set." >&2
  exit 1
fi

claude_is_logged_in() {
  if claude auth status >/dev/null 2>&1; then
    return 0
  fi
  if claude login status >/dev/null 2>&1; then
    return 0
  fi
  if claude whoami >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

claude_start_device_login() {
  if claude auth login; then
    return 0
  fi
  if claude login; then
    return 0
  fi
  return 1
}

if [[ "${AI_AGENT:-codex}" == "claude" ]]; then
  if [[ "${CLAUDE_BOOTSTRAP_LOGIN:-false}" == "true" ]]; then
    if claude_is_logged_in; then
      echo "Claude Code login already available."
    elif [[ "${CLAUDE_DEVICE_LOGIN_ON_START:-false}" == "true" ]]; then
      echo "Starting interactive Claude Code device auth..."
      if ! claude_start_device_login; then
        echo "Claude Code login failed. Complete login manually in the container, or set CLAUDE_BOOTSTRAP_LOGIN=false to use persisted login only." >&2
        exit 1
      fi
    else
      echo "Claude Code is not logged in. Set CLAUDE_DEVICE_LOGIN_ON_START=true or set CLAUDE_BOOTSTRAP_LOGIN=false for persisted login mode." >&2
      exit 1
    fi
  else
    echo "Claude Code bootstrap login disabled; expecting persisted session."
  fi
fi

if [[ "${CODEX_BOOTSTRAP_LOGIN:-false}" == "true" ]]; then
  if ! codex login status >/dev/null 2>&1; then
    if [[ -z "${OPENAI_API_KEY:-}" ]]; then
      if [[ "${CODEX_DEVICE_LOGIN_ON_START:-false}" == "true" ]]; then
        echo "Starting interactive Codex device auth..."
        codex login --device-auth
      else
        echo "CODEX not logged in. Provide OPENAI_API_KEY/CODEX_API_KEY or set CODEX_DEVICE_LOGIN_ON_START=true for device login." >&2
        exit 1
      fi
    else
      printf '%s' "${OPENAI_API_KEY}" | codex login --with-api-key >/dev/null
    fi
  fi
fi

if [[ "${NGROK_ENABLE:-false}" == "true" ]]; then
  if [[ -z "${NGROK_AUTHTOKEN:-}" ]]; then
    echo "NGROK_ENABLE=true but NGROK_AUTHTOKEN is not set." >&2
    exit 1
  fi

  ngrok config add-authtoken "${NGROK_AUTHTOKEN}" >/dev/null

  ensure_reserved_domain() {
    if [[ -z "${NGROK_DOMAIN:-}" || -z "${NGROK_API_KEY:-}" ]]; then
      return 0
    fi

    if ! command -v curl >/dev/null 2>&1; then
      echo "curl is required to provision reserved ngrok domains." >&2
      return 1
    fi

    local list_resp
    list_resp=$(curl -sS \
      -H "Authorization: Bearer ${NGROK_API_KEY}" \
      -H "ngrok-version: 2" \
      "https://api.ngrok.com/reserved_domains")

    if LIST_RESP="${list_resp}" python3 - "${NGROK_DOMAIN}" <<'PY'
import json
import os
import sys
target = sys.argv[1]
payload = json.loads(os.environ.get("LIST_RESP", "{}"))
domains = payload.get("reserved_domains", [])
sys.exit(0 if any(d.get("domain") == target for d in domains) else 1)
PY
    then
      echo "Reserved ngrok domain already exists: ${NGROK_DOMAIN}"
      return 0
    fi

    local create_payload
    create_payload=$(printf '{"domain":"%s","description":"jira-workflow-automation webhook"}' "${NGROK_DOMAIN}")

    local http_code
    http_code=$(curl -sS -o /tmp/ngrok_reserved_domain_create.json -w "%{http_code}" \
      -X POST \
      -H "Authorization: Bearer ${NGROK_API_KEY}" \
      -H "ngrok-version: 2" \
      -H "Content-Type: application/json" \
      -d "${create_payload}" \
      "https://api.ngrok.com/reserved_domains")

    if [[ "${http_code}" == "200" || "${http_code}" == "201" ]]; then
      echo "Provisioned reserved ngrok domain: ${NGROK_DOMAIN}"
      return 0
    fi

    echo "Failed to provision reserved ngrok domain (${http_code})." >&2
    cat /tmp/ngrok_reserved_domain_create.json >&2 || true
    return 1
  }

  tunnel_port="${NGROK_PORT:-${PORT:-3000}}"
  if [[ -n "${NGROK_DOMAIN:-}" ]]; then
    if ! ensure_reserved_domain; then
      echo "Falling back to ephemeral ngrok URL because reserved domain setup failed." >&2
      NGROK_DOMAIN=""
    fi
  fi

  if [[ -n "${NGROK_DOMAIN:-}" ]]; then
    echo "Starting ngrok tunnel on port ${tunnel_port} with domain ${NGROK_DOMAIN}"
    ngrok http --domain="${NGROK_DOMAIN}" "${tunnel_port}" >/tmp/ngrok.log 2>&1 &
  else
    echo "Starting ngrok tunnel on port ${tunnel_port}"
    ngrok http "${tunnel_port}" >/tmp/ngrok.log 2>&1 &
  fi
  echo "ngrok started in background. Inspect /tmp/ngrok.log for tunnel URL."
fi

exec "$@"
