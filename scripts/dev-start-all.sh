#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDS=()
SHUTTING_DOWN=0

cleanup() {
  if [[ "$SHUTTING_DOWN" -eq 1 ]]; then
    return
  fi
  SHUTTING_DOWN=1

  echo ""
  echo "Stopping dev services..."
  for pid in "${PIDS[@]:-}"; do
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  for pid in "${PIDS[@]:-}"; do
    if [[ -n "${pid:-}" ]]; then
      wait "$pid" 2>/dev/null || true
    fi
  done
}

start_service() {
  local name="$1"
  local script_name="$2"

  echo "Starting ${name}..."
  (
    cd "$ROOT_DIR"
    npm run "$script_name"
  ) &
  PIDS+=("$!")
}

trap cleanup INT TERM EXIT

start_service "setup-api" "dev:setup-api"
start_service "launcher-native-host" "dev:launcher-native-host"
start_service "frontend" "dev:frontend"

echo ""
echo "All services started."
echo "Press Ctrl+C to stop setup-api, launcher-native-host, and frontend."
echo ""

while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "A dev service exited unexpectedly."
      exit 1
    fi
  done
  sleep 1
done
