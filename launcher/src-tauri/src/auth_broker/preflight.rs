use serde_json::json;

use super::persistence_verifier::{
    container_running, docker_reachable, provider_cli_available, verify_volume_writable,
};
use super::types::Provider;

pub fn run_preflight(provider: Provider) -> serde_json::Value {
    let docker_ok = docker_reachable();
    let running = container_running();
    let cli_ok = if running {
        provider_cli_available(provider)
    } else {
        false
    };
    let volume_ok = if running {
        verify_volume_writable(provider.state_dir())
    } else {
        false
    };

    let checks = vec![
        json!({
            "name": "auth-broker",
            "ok": true,
            "severity": "pass",
            "code": "ok",
            "summary": "Launcher-native auth broker is reachable.",
            "remediation": ""
        }),
        json!({
            "name": "docker",
            "ok": docker_ok,
            "severity": if docker_ok { "pass" } else { "fail" },
            "code": if docker_ok { "ok" } else { "docker_unavailable" },
            "summary": if docker_ok { "Docker is reachable." } else { "Docker is not reachable." },
            "remediation": if docker_ok { "" } else { "Start Docker before authenticating the provider." }
        }),
        json!({
            "name": "pronto-container",
            "ok": running,
            "severity": if running { "pass" } else { "warning" },
            "code": if running { "ok" } else { "container_not_running" },
            "summary": if running { "PRonto container is running." } else { "PRonto container is not running yet." },
            "remediation": if running { "" } else { "Launch PRonto before starting interactive provider authentication." }
        }),
        json!({
            "name": format!("{}-cli", provider.id()),
            "ok": cli_ok,
            "severity": if cli_ok { "pass" } else { if running { "fail" } else { "warning" } },
            "code": if cli_ok { "ok" } else { "provider_cli_missing" },
            "summary": if cli_ok { format!("{} CLI is available.", provider.label()) } else { format!("{} CLI is not available in the running container.", provider.label()) },
            "remediation": if cli_ok { "" } else { "Rebuild and relaunch PRonto so the selected provider CLI is installed inside the container." }
        }),
        json!({
            "name": format!("{}-volume", provider.id()),
            "ok": volume_ok,
            "severity": if volume_ok { "pass" } else { if running { "fail" } else { "warning" } },
            "code": if volume_ok { "ok" } else { "provider_state_unwritable" },
            "summary": if volume_ok { format!("{} auth volume is writable.", provider.label()) } else { format!("{} auth volume is not writable.", provider.label()) },
            "remediation": if volume_ok { "".to_string() } else { format!("Ensure {} is mounted and writable before authenticating {}.", provider.state_dir(), provider.label()) }
        }),
    ];

    let ok = checks
        .iter()
        .all(|check| check.get("severity").and_then(|v| v.as_str()) != Some("fail"));

    json!({
        "ok": ok,
        "provider": provider.id(),
        "checks": checks,
        "state": "preflight"
    })
}
