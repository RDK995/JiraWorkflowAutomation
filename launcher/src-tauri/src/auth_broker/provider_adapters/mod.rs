pub mod claude;
pub mod codex;

use super::types::{Provider, SessionState};

pub fn parse_login_info(provider: Provider, output: &str) -> (String, String, bool, SessionState) {
    match provider {
        Provider::Claude => claude::parse_login_info(output),
        Provider::Codex => codex::parse_login_info(output),
    }
}

pub fn login_command(provider: Provider) -> &'static str {
    match provider {
        Provider::Claude => "claude",
        Provider::Codex => "codex login",
    }
}
