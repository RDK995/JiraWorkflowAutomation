use regex::Regex;

use crate::auth_broker::types::SessionState;

pub fn parse_login_info(output: &str) -> (String, String, bool, SessionState) {
    let cleaned = output.replace('\u{001b}', "");
    let url = Regex::new(r"https://auth\.openai\.com/codex/device")
        .unwrap()
        .find(&cleaned)
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();
    let code = Regex::new(r"\b[A-Z0-9]{4}-[A-Z0-9]{5}\b")
        .unwrap()
        .find(&cleaned)
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();

    let state = if url.is_empty() {
        SessionState::Starting
    } else {
        SessionState::WaitingForBrowser
    };

    (url, code, false, state)
}

#[cfg(test)]
mod tests {
    use super::parse_login_info;
    use crate::auth_broker::types::SessionState;

    #[test]
    fn parses_codex_device_prompt() {
        let output = "Go to https://auth.openai.com/codex/device then enter ABCD-12345";
        let (url, code, needs_code, state) = parse_login_info(output);
        assert_eq!(url, "https://auth.openai.com/codex/device");
        assert_eq!(code, "ABCD-12345");
        assert!(!needs_code);
        assert_eq!(state, SessionState::WaitingForBrowser);
    }
}
