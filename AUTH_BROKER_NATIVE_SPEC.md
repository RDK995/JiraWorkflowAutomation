# Native Auth Broker Cutover

## Purpose

This document defines the next production cutover step for provider authentication:

- keep the wizard UX as the only visible authentication surface
- move interactive auth hosting into the launcher/native runtime
- preserve the current broker contract so the frontend and setup-api do not need another redesign

## Current State

The repository now uses a provider-neutral Auth Broker contract:

- frontend talks to `/api/auth/*` via `setup-api`
- `setup-api` proxies auth operations to an auth broker client
- `auth-broker` currently runs as a separate local Node service in development
- Claude and Codex provider logic live behind broker adapters

This is the correct contract shape, but not the final production host.

### Development Emulation

Until launcher/native source is available in this repository, `setup-api` now defaults to the `launcher_http` transport while talking to the current local broker host.

This means:

- the transport contract matches the intended production cutover shape
- the current broker host is still a Node-based development implementation
- production still needs the launcher-native host to fully remove the end-user runtime dependency

## Production Goal

Replace the standalone local Node `auth-broker` process with a launcher-managed native broker.

From the user's perspective:

1. Open the launcher.
2. Use the setup wizard.
3. Authenticate Claude or Codex inside the wizard.
4. Never install or manage a specific Node version.

## Stable Contract To Preserve

Keep these endpoints unchanged:

- `GET /api/auth/health`
- `POST /api/auth/preflight`
- `POST /api/auth/sessions/start`
- `GET /api/auth/sessions/:id`
- `POST /api/auth/sessions/:id/code`
- `POST /api/auth/sessions/:id/verify`
- `POST /api/auth/sessions/:id/cancel`

Keep these session states unchanged:

- `idle`
- `preflight`
- `starting`
- `waiting_for_browser`
- `waiting_for_code`
- `verifying`
- `persisting`
- `authenticated`
- `failed`
- `cancelled`

## Transport Model

`setup-api` should continue to use an auth broker client abstraction.

Supported transport modes:

- `standalone_http`
  - current development mode
  - talks to a local broker process, default `http://127.0.0.1:3020`
- `launcher_http`
  - target production mode
  - talks to a launcher-managed local HTTP surface or IPC bridge exposed through a localhost adapter

Configuration:

- `AUTH_BROKER_TRANSPORT`
- `AUTH_BROKER_BASE_URL`

The frontend must remain unaware of which transport is active.

## Launcher Responsibilities

The launcher-hosted broker must own:

- real interactive TTY/process lifecycle
- provider session state management
- incremental output capture
- browser URL/code prompt parsing
- code submission into the same live session
- persistence verification

The launcher must not require the user to install or manage a Node runtime.

## Provider Responsibilities

### Claude

- start a real interactive Claude login session
- parse the browser authorization URL
- detect whether a pasted code is required
- accept the pasted code into the same live session
- verify login with `claude auth status` or equivalent
- verify persistence in shared Claude auth state

### Codex

- use the same broker session contract
- preserve provider-specific implementation details inside the adapter only
- verify persistence in shared Codex auth state

## setup-api Responsibilities After Cutover

`setup-api` should continue to own:

- Docker operations
- environment/config save and validation
- health/status aggregation
- auth broker proxy routes

`setup-api` should not own:

- interactive auth sessions
- PTY logic
- provider-specific auth subprocesses

## Suggested Launcher File Boundaries

When launcher source is available, implement these responsibilities in the launcher repository:

- `auth_broker/session_manager`
- `auth_broker/provider_adapters/claude`
- `auth_broker/provider_adapters/codex`
- `auth_broker/preflight`
- `auth_broker/persistence_verifier`
- `auth_broker/api`

## Cutover Sequence

1. Implement launcher-native broker with the same HTTP/IPC contract.
2. Run it behind `AUTH_BROKER_TRANSPORT=launcher_http`.
3. Point `setup-api` at the launcher broker base URL.
4. Validate Claude end-to-end wizard login.
5. Validate Codex end-to-end wizard login.
6. Remove standalone `auth-broker` from the production path.
7. Retain standalone `auth-broker` only for development if useful.

## Acceptance Criteria

The cutover is complete when:

- end users do not manage a Node runtime for auth
- Claude auth works entirely from the wizard UX
- Codex uses the same broker contract
- setup-api remains transport/proxy oriented only
- launcher is the only interactive auth host in production
