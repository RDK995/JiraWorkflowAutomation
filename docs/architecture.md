# Workflow and Architecture

## End-to-End Workflow

```mermaid
sequenceDiagram
    autonumber
    participant Jira as Jira Cloud
    participant Ngrok as ngrok Tunnel
    participant App as Flask Webhook App (Container)
    participant Script as jira_ticket_to_pr.sh
    participant Spec as jira_to_spec.py
    participant Agent as Selected AI Agent (Codex CLI or Claude Code)
    participant GitHub as GitHub

    Jira->>Ngrok: Issue transition webhook (To Do -> In Progress)
    Ngrok->>App: POST /webhooks/jira-transition
    App->>App: Validate secret + transition filter
    App->>Script: Start async workflow for issue key
    Script->>Spec: Generate .codex/<KEY>.md from Jira issue
    Spec->>Jira: GET /rest/api/3/issue/{KEY}
    Script->>GitHub: Clone target repo + create jira/<KEY> branch
    Script->>Agent: Run selected implementation workflow (AI_AGENT)
    Agent->>GitHub: Commit/push changes
    Script->>GitHub: Create PR (gh pr create)
    Script->>App: Return output + PR URL
    App->>Jira: Add issue comment with success/failure
```

## Container Architecture

```mermaid
flowchart LR
    subgraph JiraCloud[Jira Cloud]
        JWebhook[Webhook Configuration]
        JIssue[Jira Issue Data]
    end

    subgraph PublicIngress[Public Ingress]
        NG[ngrok Reserved/Ephemeral Domain]
    end

    subgraph Container[Docker Container: jira-workflow-automation]
        Flask[Flask app.py\n/webhooks/jira-transition]
        EP[docker/entrypoint.sh]
        WF[jira_ticket_to_pr.sh]
        SpecPy[tools/jira/jira_to_spec.py]
        CodexCLI[Codex CLI]
        ClaudeCLI[Claude Code CLI]
        GHCLI[GitHub CLI]
        AgentSwitch{AI_AGENT}
    end

    subgraph Persistent[Persistent Storage]
        Vol[/Docker volume: /data/codex\n(Codex login/session state)/]
        VolClaude[/Docker volume: /data/claude\n(Claude login/session state)/]
    end

    subgraph GitHubCloud[GitHub]
        Repo[Target Repository]
        PR[Pull Request]
    end

    JWebhook --> NG --> Flask
    Flask --> WF
    WF --> SpecPy --> JIssue
    WF --> AgentSwitch
    AgentSwitch --> CodexCLI
    AgentSwitch --> ClaudeCLI
    WF --> GHCLI
    CodexCLI --> Repo
    ClaudeCLI --> Repo
    GHCLI --> PR
    EP --> CodexCLI
    EP --> ClaudeCLI
    EP --> GHCLI
    EP --> NG
    CodexCLI <--> Vol
    ClaudeCLI <--> VolClaude
```
