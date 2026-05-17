use std::io::{Read, Write};
use std::thread;
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde_json::json;
use tiny_http::{Header, Method, Request, Response, StatusCode};

use super::persistence_verifier::{provider_auth_status, provider_state_persisted};
use super::preflight::run_preflight;
use super::provider_adapters::{login_command, parse_login_info};
use super::session_manager::{ProcessHandle, SessionManager};
use super::types::{auth_error, Provider, ProviderRequestBody, SessionState, SubmitCodeBody};

const CONTAINER_NAME: &str = "jira-automation";

#[derive(Debug, PartialEq, Eq)]
enum RouteMatch {
    Health,
    Preflight,
    Start,
    SessionStatus(String),
    SessionCode(String),
    SessionLogin(String),
    SessionVerify(String),
    SessionCancel(String),
    NotFound,
}

fn match_route(method: &Method, path: &str) -> RouteMatch {
    if *method == Method::Get && path == "/api/auth/health" {
        return RouteMatch::Health;
    }
    if *method == Method::Post && path == "/api/auth/preflight" {
        return RouteMatch::Preflight;
    }
    if *method == Method::Post && path == "/api/auth/sessions/start" {
        return RouteMatch::Start;
    }
    if *method == Method::Get
        && path.starts_with("/api/auth/sessions/")
        && !path.contains("/code")
        && !path.contains("/verify")
        && !path.contains("/cancel")
    {
        return RouteMatch::SessionStatus(
            path.trim_start_matches("/api/auth/sessions/").to_string(),
        );
    }
    if *method == Method::Post && path.ends_with("/code") && path.starts_with("/api/auth/sessions/")
    {
        return RouteMatch::SessionCode(
            path.trim_start_matches("/api/auth/sessions/")
                .trim_end_matches("/code")
                .trim_end_matches('/')
                .to_string(),
        );
    }
    if *method == Method::Post
        && path.ends_with("/login")
        && path.starts_with("/api/auth/sessions/")
    {
        return RouteMatch::SessionLogin(
            path.trim_start_matches("/api/auth/sessions/")
                .trim_end_matches("/login")
                .trim_end_matches('/')
                .to_string(),
        );
    }
    if *method == Method::Post
        && path.ends_with("/verify")
        && path.starts_with("/api/auth/sessions/")
    {
        return RouteMatch::SessionVerify(
            path.trim_start_matches("/api/auth/sessions/")
                .trim_end_matches("/verify")
                .trim_end_matches('/')
                .to_string(),
        );
    }
    if *method == Method::Post
        && path.ends_with("/cancel")
        && path.starts_with("/api/auth/sessions/")
    {
        return RouteMatch::SessionCancel(
            path.trim_start_matches("/api/auth/sessions/")
                .trim_end_matches("/cancel")
                .trim_end_matches('/')
                .to_string(),
        );
    }
    RouteMatch::NotFound
}

fn read_body(request: &mut Request) -> String {
    let mut body = String::new();
    let _ = request.as_reader().read_to_string(&mut body);
    body
}

fn log_auth_event(session_id: &str, provider: Option<Provider>, event: &str, detail: &str) {
    let provider_label = provider
        .map(|p| p.id().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    println!(
        "[auth-broker] session={} provider={} event={} detail={}",
        session_id, provider_label, event, detail
    );
}

fn clip_for_log(text: &str, limit: usize) -> String {
    let normalized = text.replace('\n', "\\n").replace('\r', "\\r");
    let clipped: String = normalized.chars().take(limit).collect();
    if normalized.chars().count() > limit {
        format!("{clipped}...(truncated)")
    } else {
        clipped
    }
}

fn write_session_input(
    manager: &SessionManager,
    session_id: &str,
    provider: Provider,
    input: &[u8],
    success_event: &str,
    success_detail: &str,
    failure_event: &str,
) -> bool {
    let Some(handle) = manager.get_process(session_id) else {
        log_auth_event(
            session_id,
            Some(provider),
            failure_event,
            "process_not_found",
        );
        return false;
    };

    let mut writer = handle.writer.lock().unwrap();
    let wrote = writer.write_all(input).is_ok();
    let flushed = writer.flush().is_ok();
    if wrote && flushed {
        log_auth_event(session_id, Some(provider), success_event, success_detail);
        true
    } else {
        log_auth_event(
            session_id,
            Some(provider),
            failure_event,
            &format!("write_ok={} flush_ok={}", wrote, flushed),
        );
        false
    }
}

fn schedule_claude_login_after_onboarding(manager: SessionManager, session_id: String) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(900));
        let Some(session) = manager.get_session(&session_id) else {
            return;
        };
        if session.provider != Provider::Claude
            || !session.browser_url.is_empty()
            || matches!(
                session.state,
                SessionState::Authenticated | SessionState::Cancelled | SessionState::Failed
            )
        {
            return;
        }

        if write_session_input(
            &manager,
            &session_id,
            Provider::Claude,
            b"/login\r",
            "claude_auto_login_sent",
            "sent=/login after onboarding",
            "claude_auto_login_send_failed",
        ) {
            let _ = manager.update_session(&session_id, |s| {
                s.state = SessionState::WaitingForBrowser;
            });
        }

        thread::sleep(Duration::from_millis(2_500));
        if !session_still_needs_claude_login(&manager, &session_id) {
            return;
        }

        if write_session_input(
            &manager,
            &session_id,
            Provider::Claude,
            b"/login\r",
            "claude_auto_login_retry_sent",
            "sent=/login retry from bootstrap",
            "claude_auto_login_retry_failed",
        ) {
            let _ = manager.update_session(&session_id, |s| {
                s.state = SessionState::WaitingForBrowser;
            });
        }
    });
}

fn schedule_claude_login_retry(
    manager: SessionManager,
    session_id: String,
    delay: Duration,
    detail: &'static str,
) {
    thread::spawn(move || {
        thread::sleep(delay);
        if !session_still_needs_claude_login(&manager, &session_id) {
            return;
        }

        if write_session_input(
            &manager,
            &session_id,
            Provider::Claude,
            b"/login\r",
            "claude_auto_login_retry_sent",
            detail,
            "claude_auto_login_retry_failed",
        ) {
            let _ = manager.update_session(&session_id, |s| {
                s.state = SessionState::WaitingForBrowser;
            });
        }
    });
}

fn mark_session_authenticated(
    manager: &SessionManager,
    session_id: &str,
    provider: Provider,
    output: String,
) {
    let persistence_verified = provider_state_persisted(provider);
    let _ = manager.update_session(session_id, |s| {
        s.state = SessionState::Persisting;
        s.persistence_verified = persistence_verified;
        s.output = [s.output.clone(), output.clone()]
            .into_iter()
            .filter(|v| !v.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        s.state = SessionState::Authenticated;
        s.error = if s.persistence_verified {
            None
        } else {
            Some(auth_error(
                "auth_persistence_not_verified",
                &format!(
                    "{} authenticated, but persisted auth state could not be verified.",
                    s.provider.label()
                ),
                "Confirm the shared auth volume is mounted and contains persisted provider auth state.",
            ))
        };
    });
    log_auth_event(
        session_id,
        Some(provider),
        "verify_completed",
        &format!(
            "persistence_verified={} output={}",
            persistence_verified,
            clip_for_log(&output, 180)
        ),
    );
}

fn session_still_needs_claude_login(manager: &SessionManager, session_id: &str) -> bool {
    let Some(session) = manager.get_session(session_id) else {
        return false;
    };

    session.provider == Provider::Claude
        && session.browser_url.is_empty()
        && matches!(
            session.state,
            SessionState::Starting | SessionState::WaitingForBrowser
        )
}

fn schedule_claude_post_code_verification(manager: SessionManager, session_id: String) {
    thread::spawn(move || {
        let mut sent_recovery_login = false;
        for attempt in 1..=8 {
            thread::sleep(Duration::from_millis(1_500));
            let Some(session) = manager.get_session(&session_id) else {
                return;
            };
            if session.provider != Provider::Claude
                || matches!(
                    session.state,
                    SessionState::Authenticated | SessionState::Cancelled
                )
            {
                return;
            }

            let (ok, output) = provider_auth_status(Provider::Claude);
            if ok {
                mark_session_authenticated(&manager, &session_id, Provider::Claude, output);
                return;
            }

            let lowered = output.to_ascii_lowercase();
            log_auth_event(
                &session_id,
                Some(Provider::Claude),
                "post_code_verify_pending",
                &format!("attempt={} output={}", attempt, clip_for_log(&output, 180)),
            );

            if !sent_recovery_login
                && lowered.contains("not logged in")
                && lowered.contains("please run /login")
            {
                sent_recovery_login = write_session_input(
                    &manager,
                    &session_id,
                    Provider::Claude,
                    b"/login\r",
                    "claude_post_code_login_retry_sent",
                    "sent=/login after code verification reported not logged in",
                    "claude_post_code_login_retry_failed",
                );
            }
        }
    });
}

fn schedule_claude_login_bootstrap(manager: SessionManager, session_id: String) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(700));
        if !session_still_needs_claude_login(&manager, &session_id) {
            return;
        }

        let _ = write_session_input(
            &manager,
            &session_id,
            Provider::Claude,
            b"\r",
            "claude_bootstrap_enter_sent",
            "sent=enter before /login",
            "claude_bootstrap_enter_failed",
        );

        thread::sleep(Duration::from_millis(900));
        if !session_still_needs_claude_login(&manager, &session_id) {
            return;
        }

        if write_session_input(
            &manager,
            &session_id,
            Provider::Claude,
            b"/login\r",
            "claude_auto_login_sent",
            "sent=/login from bootstrap",
            "claude_auto_login_send_failed",
        ) {
            let _ = manager.update_session(&session_id, |s| {
                s.state = SessionState::WaitingForBrowser;
            });
        }

        schedule_claude_login_retry(
            manager,
            session_id,
            Duration::from_millis(3_000),
            "sent=/login retry from bootstrap",
        );
    });
}

pub fn json_response(
    status: u16,
    payload: serde_json::Value,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let content = payload.to_string();
    let mut response = Response::from_string(content).with_status_code(StatusCode(status));
    if let Ok(header) = Header::from_bytes("Content-Type", "application/json; charset=utf-8") {
        response = response.with_header(header);
    }
    if let Ok(header) = Header::from_bytes("Access-Control-Allow-Origin", "*") {
        response = response.with_header(header);
    }
    if let Ok(header) = Header::from_bytes("Access-Control-Allow-Methods", "GET,POST,OPTIONS") {
        response = response.with_header(header);
    }
    if let Ok(header) = Header::from_bytes("Access-Control-Allow-Headers", "Content-Type") {
        response = response.with_header(header);
    }
    response
}

fn start_provider_session(manager: &SessionManager, provider: Provider) -> serde_json::Value {
    let preflight = run_preflight(provider);
    let preflight_ok = preflight
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let session = manager.create_session(provider);
    log_auth_event(&session.id, Some(provider), "start_session", "created");
    let _ = manager.update_session(&session.id, |s| {
        s.state = SessionState::Preflight;
    });

    if !preflight_ok {
        log_auth_event(
            &session.id,
            Some(provider),
            "preflight_failed",
            "at least one check failed",
        );
        let message = preflight
            .get("checks")
            .and_then(|v| v.as_array())
            .and_then(|checks| {
                checks
                    .iter()
                    .find(|check| check.get("severity").and_then(|v| v.as_str()) == Some("fail"))
            })
            .and_then(|check| check.get("summary"))
            .and_then(|v| v.as_str())
            .unwrap_or("Preflight failed.")
            .to_string();
        manager.fail_session(
            &session.id,
            "preflight_failed",
            &message,
            "Fix the failing preflight checks and retry.",
        );
        return manager.session_payload(&session.id);
    }

    let (already_ok, status_output) = provider_auth_status(provider);
    if already_ok {
        log_auth_event(
            &session.id,
            Some(provider),
            "already_authenticated",
            &clip_for_log(&status_output, 240),
        );
        let _ = manager.update_session(&session.id, |s| {
            s.state = SessionState::Authenticated;
            s.output = status_output.clone();
            s.persistence_verified = provider_state_persisted(provider);
        });
        return manager.session_payload(&session.id);
    }

    let pty_system = native_pty_system();
    let pair = match pty_system.openpty(PtySize {
        rows: 30,
        cols: 120,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(pair) => pair,
        Err(err) => {
            manager.fail_session(
                &session.id,
                "interactive_session_start_failed",
                &err.to_string(),
                "Ensure launcher runtime can start interactive provider sessions.",
            );
            return manager.session_payload(&session.id);
        }
    };

    let mut cmd = CommandBuilder::new("docker");
    cmd.args(&[
        "exec",
        "-it",
        CONTAINER_NAME,
        "sh",
        "-lc",
        login_command(provider),
    ]);
    log_auth_event(
        &session.id,
        Some(provider),
        "spawn_interactive",
        login_command(provider),
    );

    let child = match pair.slave.spawn_command(cmd) {
        Ok(child) => child,
        Err(err) => {
            manager.fail_session(
                &session.id,
                "interactive_session_start_failed",
                &err.to_string(),
                "Ensure launcher runtime can start interactive provider sessions.",
            );
            return manager.session_payload(&session.id);
        }
    };

    let writer = match pair.master.take_writer() {
        Ok(writer) => writer,
        Err(err) => {
            manager.fail_session(
                &session.id,
                "interactive_session_start_failed",
                &err.to_string(),
                "Ensure launcher runtime can start interactive provider sessions.",
            );
            return manager.session_payload(&session.id);
        }
    };

    let reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(err) => {
            manager.fail_session(
                &session.id,
                "interactive_session_start_failed",
                &err.to_string(),
                "Ensure launcher runtime can start interactive provider sessions.",
            );
            return manager.session_payload(&session.id);
        }
    };

    manager.insert_process(
        session.id.clone(),
        ProcessHandle {
            child: std::sync::Arc::new(std::sync::Mutex::new(child)),
            writer: std::sync::Arc::new(std::sync::Mutex::new(writer)),
        },
    );
    let _ = manager.update_session(&session.id, |s| {
        s.state = SessionState::Starting;
    });
    if provider == Provider::Claude {
        schedule_claude_login_bootstrap(manager.clone(), session.id.clone());
    }

    let sid_read = session.id.clone();
    let manager_read = manager.clone();
    thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0_u8; 4096];
        let mut claude_onboarding_dismissed = false;
        let mut claude_auth_method_selected = false;
        let mut claude_auto_login_sent = false;
        let mut claude_post_login_enter_sent = false;
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let _ = manager_read.update_session(&sid_read, |s| {
                        s.output.push_str(&text);
                        let (url, code, needs_code, state_hint) =
                            parse_login_info(provider, &s.output);
                        if !url.is_empty() {
                            log_auth_event(
                                &sid_read,
                                Some(provider),
                                "parsed_login_info",
                                &format!(
                                    "state_hint={} url={} code={} needs_code={}",
                                    format!("{:?}", state_hint),
                                    clip_for_log(&url, 180),
                                    clip_for_log(&code, 64),
                                    needs_code
                                ),
                            );
                            s.browser_url = url;
                            s.code = code;
                            s.requires_code = needs_code;
                            if !matches!(
                                s.state,
                                SessionState::Verifying
                                    | SessionState::Persisting
                                    | SessionState::Authenticated
                            ) {
                                s.state = state_hint;
                            }
                        } else if s.provider == Provider::Claude {
                            let lowered = s.output.to_ascii_lowercase();
                            if !claude_onboarding_dismissed
                                && lowered.contains("choose the text style")
                                && lowered.contains("run /theme")
                            {
                                if write_session_input(
                                    &manager_read,
                                    &sid_read,
                                    provider,
                                    b"\r",
                                    "claude_onboarding_auto_dismissed",
                                    "sent=enter",
                                    "claude_onboarding_auto_dismiss_failed",
                                ) {
                                    claude_onboarding_dismissed = true;
                                    claude_auto_login_sent = true;
                                    schedule_claude_login_after_onboarding(
                                        manager_read.clone(),
                                        sid_read.clone(),
                                    );
                                }
                            }
                            if lowered.contains("/login")
                                || lowered.contains("authorization")
                                || lowered.contains("browser")
                                || lowered.contains("device")
                            {
                                log_auth_event(
                                    &sid_read,
                                    Some(provider),
                                    "claude_waiting_for_browser_hint",
                                    "matched textual hint in PTY output",
                                );
                                s.state = SessionState::WaitingForBrowser;
                            }
                            if !claude_auth_method_selected
                                && lowered.contains(
                                    "claude code can be used with your claude subscription",
                                )
                                && lowered.contains("console account")
                            {
                                if write_session_input(
                                    &manager_read,
                                    &sid_read,
                                    provider,
                                    b"\r",
                                    "claude_auth_method_auto_selected",
                                    "sent=enter",
                                    "claude_auth_method_auto_select_failed",
                                ) {
                                    claude_auth_method_selected = true;
                                    schedule_claude_login_retry(
                                        manager_read.clone(),
                                        sid_read.clone(),
                                        Duration::from_millis(2_500),
                                        "sent=/login retry after auth method",
                                    );
                                }
                            }
                            if !claude_auto_login_sent
                                && ((lowered.contains("let's get started")
                                    && !lowered.contains("choose the text style")
                                    && !lowered.contains("run /theme"))
                                    || (claude_onboarding_dismissed
                                        && !lowered.contains("choose the text style")))
                            {
                                if write_session_input(
                                    &manager_read,
                                    &sid_read,
                                    provider,
                                    b"/login\r",
                                    "claude_auto_login_sent",
                                    "sent=/login",
                                    "claude_auto_login_send_failed",
                                ) {
                                    claude_auto_login_sent = true;
                                    s.state = SessionState::WaitingForBrowser;
                                }
                            }
                            if !claude_post_login_enter_sent
                                && lowered.contains("login successful")
                                && lowered.contains("press enter to continue")
                            {
                                if write_session_input(
                                    &manager_read,
                                    &sid_read,
                                    provider,
                                    b"\r",
                                    "claude_post_login_continue_sent",
                                    "sent=enter",
                                    "claude_post_login_continue_failed",
                                ) {
                                    claude_post_login_enter_sent = true;
                                }
                            }
                        }
                    });
                    log_auth_event(
                        &sid_read,
                        Some(provider),
                        "pty_output_chunk",
                        &clip_for_log(&text, 220),
                    );
                }
                Err(_) => break,
            }
        }
    });

    let sid_exit = session.id.clone();
    let manager_exit = manager.clone();
    thread::spawn(move || {
        if let Some(handle) = manager_exit.get_process(&sid_exit) {
            let status = handle.child.lock().unwrap().wait();
            if let Some(current) = manager_exit.get_session(&sid_exit) {
                if !matches!(
                    current.state,
                    SessionState::Authenticated | SessionState::Cancelled
                ) {
                    let code = status.ok().map(|st| st.exit_code() as i32).unwrap_or(-1);
                    manager_exit.fail_session(
                        &sid_exit,
                        "interactive_session_ended",
                        &format!(
                            "Interactive {} session exited with status {}.",
                            current.provider.label(),
                            code
                        ),
                        "Restart the auth session from the wizard.",
                    );
                    log_auth_event(
                        &sid_exit,
                        Some(current.provider),
                        "interactive_session_ended",
                        &format!("exit_status={}", code),
                    );
                }
            }
            let _ = manager_exit.remove_process(&sid_exit);
        }
    });

    manager.session_payload(&session.id)
}

fn verify_session(manager: &SessionManager, session_id: &str) -> serde_json::Value {
    let session = match manager.get_session(session_id) {
        Some(session) => session,
        None => {
            return json!({
                "ok": false,
                "session": null,
                "error": auth_error("session_not_found", "Auth session not found.", "Start a new auth session from the wizard.")
            })
        }
    };

    let _ = manager.update_session(session_id, |s| {
        s.state = SessionState::Verifying;
    });
    log_auth_event(
        session_id,
        Some(session.provider),
        "verify_started",
        "running provider auth status",
    );

    let (ok, output) = provider_auth_status(session.provider);
    if !ok {
        log_auth_event(
            session_id,
            Some(session.provider),
            "verify_failed",
            &clip_for_log(&output, 280),
        );
        manager.fail_session(
            session_id,
            "browser_authorization_not_accepted",
            &output,
            "Complete the browser authorization flow and retry verification.",
        );
        return manager.session_payload(session_id);
    }

    mark_session_authenticated(manager, session_id, session.provider, output);
    manager.session_payload(session_id)
}

fn refresh_session_status(manager: &SessionManager, session_id: &str) -> serde_json::Value {
    let session = match manager.get_session(session_id) {
        Some(session) => session,
        None => return manager.session_payload(session_id),
    };

    if matches!(
        session.state,
        SessionState::Authenticated | SessionState::Failed | SessionState::Cancelled
    ) {
        return manager.session_payload(session_id);
    }

    let should_probe_provider = matches!(
        session.state,
        SessionState::Starting
            | SessionState::WaitingForBrowser
            | SessionState::WaitingForCode
            | SessionState::Verifying
            | SessionState::Persisting
    );

    if should_probe_provider {
        let (ok, output) = provider_auth_status(session.provider);
        if ok {
            log_auth_event(
                session_id,
                Some(session.provider),
                "status_authenticated",
                "provider auth status succeeded during poll",
            );
            mark_session_authenticated(manager, session_id, session.provider, output);
        }
    }

    manager.session_payload(session_id)
}

fn run_session_login(manager: &SessionManager, session_id: &str) -> serde_json::Value {
    if let Some(session) = manager.get_session(session_id) {
        if session.provider != Provider::Claude {
            manager.fail_session(
                session_id,
                "provider_login_command_unsupported",
                "Manual /login is only supported for Claude in this flow.",
                "Use the provider-specific browser flow and retry.",
            );
            return manager.session_payload(session_id);
        }
    } else {
        return json!({
            "ok": false,
            "session": null,
            "error": auth_error("session_not_found", "Auth session not found.", "Start a new auth session from the wizard.")
        });
    }

    if let Some(handle) = manager.get_process(session_id) {
        let mut writer = handle.writer.lock().unwrap();
        let wrote = writer.write_all(b"/login\r").is_ok();
        let flushed = writer.flush().is_ok();
        if wrote && flushed {
            log_auth_event(
                session_id,
                Some(Provider::Claude),
                "login_command_sent",
                "sent=/login",
            );
            let _ = manager.update_session(session_id, |s| {
                s.state = SessionState::WaitingForBrowser;
            });
        } else {
            log_auth_event(
                session_id,
                Some(Provider::Claude),
                "login_command_failed",
                &format!("write_ok={} flush_ok={}", wrote, flushed),
            );
            manager.fail_session(
                session_id,
                "interactive_session_missing",
                "Interactive Claude session is not active.",
                "Restart Claude Code login from the wizard.",
            );
        }
    } else {
        manager.fail_session(
            session_id,
            "interactive_session_missing",
            "Interactive Claude session is not active.",
            "Restart Claude Code login from the wizard.",
        );
    }
    manager.session_payload(session_id)
}

pub fn handle_request(mut request: Request, manager: &SessionManager) {
    let method = request.method().clone();
    let path = request.url().to_string();

    if method == Method::Options {
        let _ = request.respond(json_response(204, json!({})));
        return;
    }

    match match_route(&method, &path) {
        RouteMatch::Health => {
            let _ = request.respond(json_response(
                200,
                json!({
                    "ok": true,
                    "service": "auth-broker",
                    "hostType": "launcher_native_host",
                    "hostMode": "launcher_http",
                    "nodeVersion": "native-rust",
                    "providers": [
                        { "id": "claude", "label": "Claude Code" },
                        { "id": "codex", "label": "Codex" }
                    ]
                }),
            ));
        }
        RouteMatch::Preflight => {
            let body = read_body(&mut request);
            let parsed: ProviderRequestBody =
                serde_json::from_str(&body).unwrap_or(ProviderRequestBody {
                    provider: "codex".to_string(),
                });
            let provider = Provider::from_input(&parsed.provider);
            let _ = request.respond(json_response(200, run_preflight(provider)));
        }
        RouteMatch::Start => {
            let body = read_body(&mut request);
            let parsed: ProviderRequestBody =
                serde_json::from_str(&body).unwrap_or(ProviderRequestBody {
                    provider: "codex".to_string(),
                });
            let provider = Provider::from_input(&parsed.provider);
            let _ = request.respond(json_response(
                200,
                start_provider_session(manager, provider),
            ));
        }
        RouteMatch::SessionStatus(session_id) => {
            let _ = request.respond(json_response(
                200,
                refresh_session_status(manager, &session_id),
            ));
        }
        RouteMatch::SessionCode(session_id) => {
            let body = read_body(&mut request);
            let parsed: SubmitCodeBody = serde_json::from_str(&body).unwrap_or(SubmitCodeBody {
                code: String::new(),
            });

            if parsed.code.trim().is_empty() {
                manager.fail_session(
                    &session_id,
                    "browser_authorization_code_missing",
                    "Paste the authorization code before submitting it.",
                    "Copy the returned code from the browser flow and retry.",
                );
                let _ = request.respond(json_response(200, manager.session_payload(&session_id)));
                return;
            }

            if let Some(session) = manager.get_session(&session_id) {
                if session.provider != Provider::Claude {
                    manager.fail_session(
                        &session_id,
                        "provider_code_submission_unsupported",
                        "Codex does not require pasted code submission in this flow.",
                        "Return to the browser sign-in flow and finish provider login.",
                    );
                    let _ =
                        request.respond(json_response(200, manager.session_payload(&session_id)));
                    return;
                }
                if let Some(handle) = manager.get_process(&session_id) {
                    let command = format!("{}\r", parsed.code.trim());
                    let mut writer = handle.writer.lock().unwrap();
                    let wrote = writer.write_all(command.as_bytes()).is_ok();
                    let flushed = writer.flush().is_ok();
                    if wrote && flushed {
                        log_auth_event(
                            &session_id,
                            Some(Provider::Claude),
                            "authorization_code_sent",
                            &format!("code_len={}", parsed.code.trim().len()),
                        );
                        let _ = manager.update_session(&session_id, |s| {
                            s.state = SessionState::Verifying;
                        });
                        schedule_claude_post_code_verification(manager.clone(), session_id.clone());
                    } else {
                        log_auth_event(
                            &session_id,
                            Some(Provider::Claude),
                            "authorization_code_send_failed",
                            &format!("write_ok={} flush_ok={}", wrote, flushed),
                        );
                        manager.fail_session(
                            &session_id,
                            "interactive_session_missing",
                            "Interactive Claude session is not active.",
                            "Restart Claude Code login from the wizard.",
                        );
                    }
                } else {
                    manager.fail_session(
                        &session_id,
                        "interactive_session_missing",
                        "Interactive Claude session is not active.",
                        "Restart Claude Code login from the wizard.",
                    );
                }
                let _ = request.respond(json_response(200, manager.session_payload(&session_id)));
                return;
            }

            let _ = request.respond(json_response(
            200,
            json!({
                "ok": false,
                "session": null,
                "error": auth_error("session_not_found", "Auth session not found.", "Start a new auth session from the wizard.")
            }),
        ));
        }
        RouteMatch::SessionLogin(session_id) => {
            let _ = request.respond(json_response(200, run_session_login(manager, &session_id)));
        }
        RouteMatch::SessionVerify(session_id) => {
            let _ = request.respond(json_response(200, verify_session(manager, &session_id)));
        }
        RouteMatch::SessionCancel(session_id) => {
            if let Some(handle) = manager.remove_process(&session_id) {
                let _ = handle.child.lock().unwrap().kill();
            }
            let _ = manager.set_cancelled(&session_id);
            let _ = request.respond(json_response(200, manager.session_payload(&session_id)));
        }
        RouteMatch::NotFound => {
            let _ = request.respond(json_response(
                404,
                json!({ "ok": false, "error": "Not found" }),
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::json_response;
    use super::match_route;
    use super::RouteMatch;
    use serde_json::json;
    use tiny_http::Method;

    #[test]
    fn json_response_sets_status() {
        let response = json_response(200, json!({"ok": true}));
        assert_eq!(response.status_code().0, 200);
    }

    #[test]
    fn routes_cover_contract_endpoints() {
        assert_eq!(
            match_route(&Method::Get, "/api/auth/health"),
            RouteMatch::Health
        );
        assert_eq!(
            match_route(&Method::Post, "/api/auth/preflight"),
            RouteMatch::Preflight
        );
        assert_eq!(
            match_route(&Method::Post, "/api/auth/sessions/start"),
            RouteMatch::Start
        );
        assert_eq!(
            match_route(&Method::Get, "/api/auth/sessions/s-1"),
            RouteMatch::SessionStatus("s-1".to_string())
        );
        assert_eq!(
            match_route(&Method::Post, "/api/auth/sessions/s-1/code"),
            RouteMatch::SessionCode("s-1".to_string())
        );
        assert_eq!(
            match_route(&Method::Post, "/api/auth/sessions/s-1/login"),
            RouteMatch::SessionLogin("s-1".to_string())
        );
        assert_eq!(
            match_route(&Method::Post, "/api/auth/sessions/s-1/verify"),
            RouteMatch::SessionVerify("s-1".to_string())
        );
        assert_eq!(
            match_route(&Method::Post, "/api/auth/sessions/s-1/cancel"),
            RouteMatch::SessionCancel("s-1".to_string())
        );
    }
}
