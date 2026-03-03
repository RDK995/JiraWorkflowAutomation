#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".env" ]]; then
  echo "Missing .env file."
  echo "Create it first with: cp .env.example .env"
  exit 1
fi

if ! python3 -c "import flask, requests, dotenv" >/dev/null 2>&1; then
  echo "Python dependencies not installed. Running pip install..."
  python3 -m pip install -r requirements.txt
fi

echo "Starting Jira Workflow Automation..."
python3 src/app.py
