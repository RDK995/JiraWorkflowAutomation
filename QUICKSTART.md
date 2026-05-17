# PRonto Quickstart

## Fastest Path

Install workspace dependencies:

```bash
npm install
```

Start the setup API:

```bash
npm run dev:setup-api
```

Start the auth broker in a second terminal:

```bash
npm run dev:auth-broker
```

Start the frontend in a third terminal:

```bash
npm run dev:frontend
```

Open the Vite URL shown in the terminal, usually `http://localhost:5173`.

Use the wizard to:

- save `.env`
- validate Jira, GitHub, AI, ngrok, and Docker setup
- build the Docker image
- run the `jira-automation` container
- watch health and logs

## Auth Broker Transport

`setup-api` proxies auth through the stable `/api/auth/*` contract and supports:

- `AUTH_BROKER_TRANSPORT=launcher_http` (default)
- `AUTH_BROKER_TRANSPORT=standalone_http`
- `AUTH_BROKER_BASE_URL=http://127.0.0.1:3020` (default)

Local dev emulation only:

- `AUTH_BROKER_DEV_EMULATION=true` allows setup-api to spawn a local dev auth host when launcher transport is selected and unreachable.
- `AUTH_BROKER_AUTOSTART=false` disables that dev-emulation autostart behavior.
- `AUTH_BROKER_DEV_EMULATION_HOST=native` (default) starts the Rust launcher host in `launcher/src-tauri`.
- `AUTH_BROKER_DEV_EMULATION_HOST=node` starts the legacy Node host for compatibility.

Production expectation: launcher mode should use a launcher-managed auth host, not a user-managed Node runtime.

## Direct Docker Run

Create `.env`:

```bash
cp .env.example .env
```

Build and launch:

```bash
docker build -t jira-workflow-automation .
docker rm -f jira-automation 2>/dev/null || true
docker run --env-file .env -p 3000:3000 \
  -v codex-state:/data/codex \
  -v claude-state:/data/claude \
  --name jira-automation -d jira-workflow-automation
```

Check health and logs:

```bash
curl -sS http://localhost:3000/health
docker logs -f jira-automation
```

## Required Config

At minimum, `.env` needs:

```bash
JIRA_BASE_URL=https://<your-site>.atlassian.net
JIRA_USER_EMAIL=<jira-email>
JIRA_API_TOKEN=<jira-api-token>
READY_STATUS="To Do"
IN_PROGRESS_STATUS="In Progress"
IN_REVIEW_STATUS="In Review"
GITHUB_TOKEN=<github-token>
REQUIRE_GITHUB_AUTH=true
AI_AGENT=codex
```

For Codex in Docker, prefer:

```bash
CODEX_EXEC_ARGS=--dangerously-bypass-approvals-and-sandbox
```

Authentication options:

- Codex API key: set `CODEX_API_KEY` or `OPENAI_API_KEY`
- Codex device login: set `CODEX_DEVICE_LOGIN_ON_START=true`
- Claude mode: set `AI_AGENT=claude`

## Tests

Python tests:

```bash
python -m unittest discover -s tests
```

Setup API tests:

```bash
npm run test:setup-api
```

## Launcher

Build the frontend first:

```bash
npm run build:frontend
npm run dev:launcher-native-host
```

The launcher expects `frontend/dist` to exist and opens the setup flow at `http://127.0.0.1:3010`.

## Start Reading Here

- Automation entrypoint: [`src/app.py`](/Users/ryankenny/Projects/JiraWorkflowAutomation/src/app.py:1)
- Main workflow: [`jira_ticket_to_pr.sh`](/Users/ryankenny/Projects/JiraWorkflowAutomation/jira_ticket_to_pr.sh:1)
- Setup control plane: [`setup-api/src/server.js`](/Users/ryankenny/Projects/JiraWorkflowAutomation/setup-api/src/server.js:1)
