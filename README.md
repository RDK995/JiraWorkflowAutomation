# Jira Workflow Automation

Dockerized webhook service that triggers Codex when a Jira issue transitions from **To Do** to **In Progress**.

## Run with Docker

### 1) Configure env

```bash
cp .env.example .env
```

Set at minimum:

- `JIRA_BASE_URL=https://<your-site>.atlassian.net`
- `JIRA_USER_EMAIL=<jira-email>`
- `JIRA_API_TOKEN=<jira-api-token>`
- `CODEX_API_KEY=<openai-api-key>` (or pre-authenticated `codex login` in container)
- `READY_STATUS="To Do"`
- `IN_PROGRESS_STATUS="In Progress"`

Optional:

- `JIRA_WEBHOOK_SECRET` (recommended for webhook validation)
- `NGROK_ENABLE=true` (start ngrok in-container)
- `NGROK_AUTHTOKEN=<your-ngrok-authtoken>`
- `NGROK_DOMAIN=<your-reserved-domain.ngrok-free.app>` (persistent URL)
- `NGROK_API_KEY=<your-ngrok-api-key>` (auto-provisions reserved domain if missing)
- `WORKFLOW_BASE_BRANCH=main` (branch used by `jira_ticket_to_pr.sh`)
- `WORKFLOW_SCRIPT=./jira_ticket_to_pr.sh`
- `WORKFLOW_TIMEOUT_SECONDS=5400`
- `POST_WORKFLOW_RESULT_TO_JIRA=true`
- `CODEX_EXEC_ARGS=--full-auto` (ensures writable Codex execution in automation)

### 2) Build image

```bash
docker build -t jira-workflow-automation .
```

### 3) Run container

```bash
docker run --env-file .env -p 3000:3000 -v codex-state:/data/codex --name jira-automation jira-workflow-automation
```

Persistent Codex login options:

- API key bootstrap (headless): set `CODEX_BOOTSTRAP_LOGIN=true` and `CODEX_API_KEY=...`
- ChatGPT/device login (one-time, then persisted in volume):
  - set `CODEX_BOOTSTRAP_LOGIN=true` and `CODEX_DEVICE_LOGIN_ON_START=true`
  - first run will prompt for device auth
  - credentials persist in `codex-state` volume and survive container restarts

### 4) Verify service

- Health check: `GET http://localhost:3000/health`
- Webhook endpoint: `POST http://localhost:3000/webhooks/jira-transition`

If `NGROK_ENABLE=true`, get the public URL from inside container:

```bash
docker exec jira-automation sh -lc "wget -qO- http://127.0.0.1:4040/api/tunnels"
```

Use `https://<domain>/webhooks/jira-transition` as your Jira webhook URL.

## Jira webhook setup

In Jira Cloud:

1. Go to **Settings -> System -> Webhooks**
2. Create webhook URL:
   - `https://<your-host>/webhooks/jira-transition`
3. Event: **Issue updated**
4. Add JQL filter:

```text
project = KAN AND status CHANGED FROM "To Do" TO "In Progress"
```

5. If using `JIRA_WEBHOOK_SECRET`, configure Jira to send header:
   - `x-jira-webhook-secret: <your-secret>`

## Example Jira ticket (works with this automation)

Example issue key: `KAN-123`

Summary:

```text
Add validation for webhook secret header
```

Description:

```text
GitHub Repo: your-org/your-repo

Context:
Webhook requests should be rejected if the Jira secret header is missing or invalid.

Acceptance Criteria:
- Requests with invalid x-jira-webhook-secret return 401
- Requests with valid secret continue processing
- Add/adjust tests for secret validation behavior
```

Transition that triggers automation:

- From: `To Do`
- To: `In Progress`

When that transition happens, the service enqueues `jira_ticket_to_pr.sh` (Codex CLI workflow) and posts success/failure back to Jira as a comment.
For automatic push/PR, ensure GitHub CLI auth is configured in container (`GITHUB_TOKEN`/`GH_TOKEN`).

## Target a specific GitHub repo for Codex + PR

Use the runner script to pull a Jira ticket, run Codex, and open a PR against a chosen repository:

```bash
./jira_ticket_to_pr.sh KAN-123 main
```

By default, the script reads `## Target Repository` from the Jira-generated spec (sourced from `GitHub Repo: ...` in the Jira ticket).

Supported repo formats:

- `owner/repo`
- `https://github.com/owner/repo.git`
- `git@github.com:owner/repo.git`

Notes:

- If no repo override is provided, repo is required in Jira ticket description (`GitHub Repo: owner/repo`).
- If repo is provided as third argument, it overrides the Jira ticket repo value.
- Selected repo is cloned under `.codex/repos/` and Codex runs in that repo.
- The PR is pushed and created against that selected repo.
- You can also set `TARGET_GITHUB_REPO=owner/repo` and omit the third argument.
