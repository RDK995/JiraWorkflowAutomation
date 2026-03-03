FROM python:3.11-alpine

RUN apk add --no-cache bash curl git github-cli nodejs npm

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && npm i -g @openai/codex ngrok

COPY src ./src
COPY tools ./tools
COPY scripts ./scripts
COPY jira_ticket_to_pr.sh ./jira_ticket_to_pr.sh
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh ./jira_ticket_to_pr.sh

ENV PORT=3000 \
    JIRA_BASE_URL= \
    JIRA_USER_EMAIL= \
    JIRA_API_TOKEN= \
    JIRA_WEBHOOK_SECRET= \
    READY_STATUS="To Do" \
    IN_PROGRESS_STATUS="In Progress" \
    CODEX_API_KEY= \
    OPENAI_API_KEY= \
    GITHUB_TOKEN= \
    GH_TOKEN= \
    GIT_AUTHOR_NAME="Codex Bot" \
    GIT_AUTHOR_EMAIL=codex-bot@example.com \
    REQUIRE_GITHUB_AUTH=false \
    CODEX_BOOTSTRAP_LOGIN=false \
    CODEX_DEVICE_LOGIN_ON_START=false \
    CODEX_STATE_DIR=/data/codex \
    WORKFLOW_BASE_BRANCH=main \
    WORKFLOW_SCRIPT=./jira_ticket_to_pr.sh \
    WORKFLOW_TIMEOUT_SECONDS=5400 \
    POST_WORKFLOW_RESULT_TO_JIRA=true \
    CODEX_EXEC_ARGS=--full-auto \
    NGROK_ENABLE=false \
    NGROK_AUTHTOKEN= \
    NGROK_API_KEY= \
    NGROK_DOMAIN= \
    NGROK_PORT=3000

EXPOSE 3000
VOLUME ["/data/codex"]

ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["sh", "-c", "gunicorn -b 0.0.0.0:${PORT} src.app:app"]
