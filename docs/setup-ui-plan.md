# Setup UI Plan

Phase 1 adds a host-side setup API and a React wizard so a new user can:

1. Enter Jira, GitHub, Codex, and optional ngrok configuration.
2. Generate the project `.env` file from the UI.
3. Build and run the existing Docker image.
4. Check container health and recent logs.

The React frontend is intentionally onboarding-focused. It does not replace the webhook app in `src/app.py`; it wraps the current Docker workflow with a guided local control surface.
