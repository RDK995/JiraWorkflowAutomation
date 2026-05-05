use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Idle,
    Preflight,
    Starting,
    WaitingForBrowser,
    WaitingForCode,
    Verifying,
    Persisting,
    Authenticated,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Claude,
    Codex,
}

impl Provider {
    pub fn from_input(value: &str) -> Provider {
        if value.eq_ignore_ascii_case("claude") {
            Provider::Claude
        } else {
            Provider::Codex
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Provider::Claude => "claude",
            Provider::Codex => "codex",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Provider::Claude => "Claude Code",
            Provider::Codex => "Codex",
        }
    }

    pub fn state_dir(self) -> &'static str {
        match self {
            Provider::Claude => "/data/claude",
            Provider::Codex => "/data/codex",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthError {
    pub code: String,
    pub message: String,
    pub remediation: String,
    pub severity: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Session {
    pub id: String,
    pub provider: Provider,
    pub state: SessionState,
    pub output: String,
    #[serde(rename = "browserUrl")]
    pub browser_url: String,
    pub code: String,
    #[serde(rename = "requiresCode")]
    pub requires_code: bool,
    #[serde(rename = "persistenceVerified")]
    pub persistence_verified: bool,
    pub error: Option<AuthError>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct ProviderRequestBody {
    pub provider: String,
}

#[derive(Debug, Deserialize)]
pub struct SubmitCodeBody {
    pub code: String,
}

pub fn now_iso_like() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}Z", now.as_secs(), now.subsec_millis())
}

pub fn auth_error(code: &str, message: &str, remediation: &str) -> AuthError {
    AuthError {
        code: code.to_string(),
        message: message.to_string(),
        remediation: remediation.to_string(),
        severity: "fail".to_string(),
    }
}
