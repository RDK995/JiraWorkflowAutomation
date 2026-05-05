FROM python:3.11-alpine

RUN apk add --no-cache bash curl git github-cli nodejs npm

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && npm i -g @openai/codex @anthropic-ai/claude-code ngrok

COPY src ./src
COPY tools ./tools
COPY scripts ./scripts
COPY jira_ticket_to_pr.sh ./jira_ticket_to_pr.sh
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh ./jira_ticket_to_pr.sh

ENV PORT=3000 \
    AI_AGENT=codex \
    JIRA_BASE_URL= \
    JIRA_USER_EMAIL= \
    READY_STATUS="To Do" \
    IN_PROGRESS_STATUS="In Progress" \
    GIT_AUTHOR_NAME=PRonto \
    GIT_AUTHOR_EMAIL=pronto-bot@example.com \
    REQUIRE_GITHUB_AUTH=false \
    CODEX_BOOTSTRAP_LOGIN=true \
    CODEX_DEVICE_LOGIN_ON_START=true \
    CODEX_STATE_DIR=/data/codex \
    CLAUDE_BOOTSTRAP_LOGIN=true \
    CLAUDE_DEVICE_LOGIN_ON_START=true \
    CLAUDE_STATE_DIR=/data/claude \
    WORKFLOW_BASE_BRANCH=main \
    WORKFLOW_SCRIPT=./jira_ticket_to_pr.sh \
    WORKFLOW_TIMEOUT_SECONDS=5400 \
    POST_WORKFLOW_RESULT_TO_JIRA=true \
    CODEX_EXEC_ARGS=--dangerously-bypass-approvals-and-sandbox \
    CLAUDE_EXEC_ARGS="--permission-mode auto --allowedTools Bash,Read,Edit,Write" \
    NGROK_ENABLE=false \
    NGROK_DOMAIN= \
    NGROK_PORT=3000

EXPOSE 3000
VOLUME ["/data/codex", "/data/claude"]

ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["sh", "-c", "gunicorn -b 0.0.0.0:${PORT} --access-logfile - --error-logfile - --capture-output --log-level info src.app:app"]
