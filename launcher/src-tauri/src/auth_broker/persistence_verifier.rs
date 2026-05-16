use std::process::Command;

use super::types::Provider;

const CONTAINER_NAME: &str = "jira-automation";

fn docker_output(args: &[&str]) -> Result<String, String> {
    let output = Command::new("docker")
        .args(args)
        .output()
        .map_err(|err| err.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!("docker command failed: {:?}", args))
        } else {
            Err(stderr)
        }
    }
}

pub fn verify_volume_writable(path: &str) -> bool {
    docker_output(&[
        "exec",
        CONTAINER_NAME,
        "sh",
        "-lc",
        &format!("test -w {path} && echo writable"),
    ])
    .map(|value| value.contains("writable"))
    .unwrap_or(false)
}

pub fn verify_state_persisted(path: &str) -> bool {
    docker_output(&[
        "exec",
        CONTAINER_NAME,
        "sh",
        "-lc",
        &format!("if [ -d {path} ] && find {path} -mindepth 1 -maxdepth 3 -print -quit | grep -q .; then echo persisted; fi"),
    ])
    .map(|value| value.contains("persisted"))
    .unwrap_or(false)
}

pub fn provider_state_persisted(provider: Provider) -> bool {
    verify_state_persisted(provider.state_dir())
}

pub fn docker_reachable() -> bool {
    docker_output(&["version"]).is_ok()
}

pub fn container_running() -> bool {
    docker_output(&[
        "ps",
        "-a",
        "--filter",
        &format!("name={CONTAINER_NAME}"),
        "--format",
        "{{.Status}}",
    ])
    .map(|value| value.to_ascii_lowercase().starts_with("up"))
    .unwrap_or(false)
}

pub fn provider_cli_available(provider: Provider) -> bool {
    let command = if provider == Provider::Claude {
        "claude --version"
    } else {
        "codex --version"
    };
    docker_output(&["exec", CONTAINER_NAME, "sh", "-lc", command]).is_ok()
}

pub fn provider_auth_status(provider: Provider) -> (bool, String) {
    match provider {
        Provider::Claude => {
            let script = "status_command='claude auth status'; if claude auth status >/tmp/pronto-claude-auth 2>&1; then status_rc=0; elif claude login status >/tmp/pronto-claude-auth 2>&1; then status_command='claude login status'; status_rc=0; elif claude whoami >/tmp/pronto-claude-auth 2>&1; then status_command='claude whoami'; status_rc=0; else status_rc=$?; fi; printf '__PRONTO_CLAUDE_STATUS_COMMAND__:%s\\n' \"$status_command\"; printf '__PRONTO_CLAUDE_STATUS_RC__:%s\\n' \"$status_rc\"; cat /tmp/pronto-claude-auth; exit 0";
            let out =
                docker_output(&["exec", CONTAINER_NAME, "sh", "-lc", script]).unwrap_or_default();
            let lowered = out.to_ascii_lowercase();
            let ok = lowered.contains("__pronto_claude_status_rc__:0")
                && !lowered.contains("not logged in")
                && !lowered.contains("\"loggedin\": false")
                && !lowered.contains("\"authmethod\": \"none\"");
            (ok, out)
        }
        Provider::Codex => {
            let result =
                docker_output(&["exec", CONTAINER_NAME, "sh", "-lc", "codex login status"]);
            match result {
                Ok(out) => (true, out),
                Err(err) => (false, err),
            }
        }
    }
}
