# Jira Workflow Automation

This project runs a webhook service that listens for Jira issue transitions and triggers Codex when an issue moves from **Ready** to **In Progress**.

## What it does

1. Receives a Jira webhook payload.
2. Verifies the transition is `Ready -> In Progress`.
3. Fetches the full issue details from Jira API.
4. Sends an assignment prompt to Codex through the OpenAI Responses API.
5. Posts Codex output back to the Jira ticket as a comment.

## Setup

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment

```bash
cp .env.example .env
```

Populate `.env`:

- `JIRA_BASE_URL`: `https://<your-site>.atlassian.net`
- `JIRA_USER_EMAIL`: Jira account email.
- `JIRA_API_TOKEN`: Jira API token (Atlassian account security settings).
- `JIRA_WEBHOOK_SECRET`: Optional shared secret expected in `x-jira-webhook-secret` header.
- `READY_STATUS` and `IN_PROGRESS_STATUS`: exact status names in your Jira workflow.
- `ASSIGNMENT_FIELD_ID`: Optional custom field where assignment details are stored.
- `CODEX_API_KEY`: API key used for Codex request.

### 3) Run service

```bash
npm run start
```

Health endpoint:

- `GET /health`

Webhook endpoint:

- `POST /webhooks/jira-transition`

## Jira webhook configuration

In Jira Cloud:

1. Go to **Settings → System → Webhooks**.
2. Create a webhook targeting:
   - `https://<your-host>/webhooks/jira-transition`
3. Select **Issue updated** events.
4. Add JQL filter if needed (for project-specific automation).
5. (Optional) Configure an outbound secret and send it as `x-jira-webhook-secret`.

To keep traffic low, use a JQL filter such as:

```text
project = ENG AND status CHANGED FROM "Ready" TO "In Progress"
```

## Notes

- This service does not directly modify code repositories; it sends assignment context to Codex and posts the resulting action plan/output into Jira.
- If you want automatic git/PR execution, connect this service to your CI runner or coding agent environment that can execute Codex plans.
