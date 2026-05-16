use regex::Regex;

use crate::auth_broker::types::SessionState;

pub fn parse_login_info(output: &str) -> (String, String, bool, SessionState) {
    let cleaned = strip_terminal_control(output);
    let url = extract_best_oauth_url(&cleaned);
    let code = Regex::new(r"\b[A-Z0-9]{4}-[A-Z0-9]{4,}\b")
        .unwrap()
        .find(&cleaned)
        .map(|m| m.as_str().to_string())
        .unwrap_or_default();

    let needs_code = cleaned.to_ascii_lowercase().contains("authorization code")
        || cleaned.to_ascii_lowercase().contains("paste")
        || !code.is_empty();

    let state = if url.is_empty() {
        SessionState::Starting
    } else if needs_code {
        SessionState::WaitingForCode
    } else {
        SessionState::WaitingForBrowser
    };

    (url, code, needs_code, state)
}

fn extract_best_oauth_url(output: &str) -> String {
    let mut best_incomplete = String::new();
    let mut best_complete = String::new();
    let mut best_generic = String::new();
    for candidate in extract_wrapped_urls(output) {
        if !candidate.contains("oauth/authorize") {
            if candidate.len() > best_generic.len() {
                best_generic = candidate;
            }
            continue;
        }
        if has_non_empty_query_param(&candidate, "redirect_uri")
            || has_non_empty_query_param(&candidate, "redir")
        {
            if candidate.len() > best_complete.len() {
                best_complete = candidate;
            }
            continue;
        }
        if candidate.len() > best_incomplete.len() {
            best_incomplete = candidate;
        }
    }
    if !best_complete.is_empty() {
        return best_complete;
    }
    if !best_generic.is_empty() {
        return best_generic;
    }
    if !best_incomplete.is_empty() {
        return String::new();
    }
    String::new()
}

fn extract_wrapped_urls(output: &str) -> Vec<String> {
    let bytes = output.as_bytes();
    let mut urls = Vec::new();
    let mut i = 0usize;
    while i + 8 <= bytes.len() {
        if output[i..].starts_with("https://") {
            let mut j = i;
            let mut value = String::new();
            while j < bytes.len() {
                let ch = output[j..].chars().next().unwrap_or('\0');
                let ch_len = ch.len_utf8();
                if is_url_char(ch) {
                    value.push(ch);
                    j += ch_len;
                    continue;
                }
                if ch == '\n' || ch == '\r' {
                    j += ch_len;
                    continue;
                }
                break;
            }
            let sanitized = sanitize_url(&value);
            if !sanitized.is_empty() {
                urls.push(sanitized);
            }
            i = j;
            continue;
        }
        let ch = output[i..].chars().next().unwrap_or('\0');
        i += ch.len_utf8();
    }
    urls
}

fn is_url_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ":/?#[]@!$&'()*+,;=%._~-".contains(ch)
}

fn sanitize_url(raw: &str) -> String {
    raw.trim_end_matches(|ch: char| ",.;:!?\"'`".contains(ch))
        .to_string()
}

fn has_non_empty_query_param(url: &str, key: &str) -> bool {
    let marker = format!("{key}=");
    let Some(start) = url.find(&marker) else {
        return false;
    };
    let value_start = start + marker.len();
    let value = url[value_start..].split('&').next().unwrap_or("").trim();
    !value.is_empty()
}

fn strip_terminal_control(text: &str) -> String {
    // Strip CSI sequences (e.g. color/style controls).
    let without_csi = Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]")
        .unwrap()
        .replace_all(text, "");
    // Strip OSC sequences (e.g. terminal hyperlinks/title metadata).
    let without_osc = Regex::new(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")
        .unwrap()
        .replace_all(&without_csi, "");
    without_osc
        .chars()
        .filter(|ch| *ch == '\n' || *ch == '\r' || *ch == '\t' || !ch.is_control())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{has_non_empty_query_param, parse_login_info, strip_terminal_control};
    use crate::auth_broker::types::SessionState;

    #[test]
    fn parses_claude_login_url_and_code() {
        let output = "Open https://claude.example/device and paste ABCD-123456";
        let (url, code, needs_code, state) = parse_login_info(output);
        assert_eq!(url, "https://claude.example/device");
        assert_eq!(code, "ABCD-123456");
        assert!(needs_code);
        assert_eq!(state, SessionState::WaitingForCode);
    }

    #[test]
    fn strips_csi_and_osc_sequences() {
        let output = "\u{1b}[31mOpen\u{1b}[0m https://claude.example/device \u{1b}]8;;https://ignored\u{7}meta\u{1b}]8;;\u{7}";
        let cleaned = strip_terminal_control(output);
        assert!(cleaned.contains("Open https://claude.example/device"));
        assert!(!cleaned.contains("\u{1b}[31m"));
        assert!(!cleaned.contains("\u{1b}]8;;"));
    }

    #[test]
    fn ignores_incomplete_oauth_url_with_empty_redir() {
        let output = "Opening browser...\nhttps://claude.ai/oauth/authorize?code=true&client_id=abc&response_type=code&redir=\n";
        let (url, _, _, state) = parse_login_info(output);
        assert_eq!(url, "");
        assert_eq!(state, SessionState::Starting);
    }

    #[test]
    fn accepts_oauth_url_with_non_empty_redir() {
        let output = "https://claude.ai/oauth/authorize?code=true&client_id=abc&response_type=code&redir=https%3A%2F%2Fconsole.anthropic.com%2Fauth%2Fcallback";
        let (url, _, _, state) = parse_login_info(output);
        assert!(url.contains("oauth/authorize"));
        assert!(has_non_empty_query_param(&url, "redir"));
        assert_eq!(state, SessionState::WaitingForBrowser);
    }

    #[test]
    fn reconstructs_wrapped_redirect_uri_oauth_url() {
        let output = "Browser didn't open?\nhttps://claude.ai/oauth/authorize?code=true&client_id=abc&response_type=code&redirect_u\nri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Aprofile";
        let (url, _, _, state) = parse_login_info(output);
        assert!(url.contains("oauth/authorize"));
        assert!(url.contains("redirect_uri="));
        assert!(has_non_empty_query_param(&url, "redirect_uri"));
        assert_eq!(state, SessionState::WaitingForBrowser);
    }
}
