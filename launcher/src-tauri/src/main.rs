use serde::Serialize;
use std::{
    env,
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[derive(Serialize)]
struct LauncherStatus {
    repo_root: Option<String>,
    node_available: bool,
    frontend_bundle_ready: bool,
    setup_api_running: bool,
    setup_url: String,
}

fn setup_url() -> String {
    "http://127.0.0.1:3010".to_string()
}

fn is_port_open(port: u16) -> bool {
    TcpStream::connect(("127.0.0.1", port)).is_ok()
}

fn node_available() -> bool {
    Command::new("node")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn search_upwards_for_workspace(start: &Path) -> Option<PathBuf> {
    let mut current = Some(start.to_path_buf());
    while let Some(path) = current {
        if path.join("setup-api").join("src").join("server.js").exists()
            && path.join("frontend").exists()
        {
            return Some(path);
        }
        current = path.parent().map(|parent| parent.to_path_buf());
    }
    None
}

fn find_repo_root() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(value) = env::var("PRONTO_WORKSPACE_ROOT") {
      candidates.push(PathBuf::from(value));
    }
    if let Ok(value) = env::current_dir() {
      candidates.push(value);
    }
    if let Ok(value) = env::current_exe() {
      if let Some(parent) = value.parent() {
        candidates.push(parent.to_path_buf());
      }
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")));

    for candidate in candidates {
        if let Some(found) = search_upwards_for_workspace(&candidate) {
            return Some(found);
        }
    }

    None
}

fn frontend_bundle_ready(root: &Path) -> bool {
    root.join("frontend").join("dist").join("index.html").exists()
}

fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(url);
        cmd
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", url]);
        cmd
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(url);
        cmd
    };

    command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not open the browser automatically: {error}"))?;

    Ok(())
}

fn launch_status() -> LauncherStatus {
    let repo_root = find_repo_root();
    let repo_root_text = repo_root.as_ref().map(|path| path.display().to_string());
    let frontend_ready = repo_root
        .as_ref()
        .map(|path| frontend_bundle_ready(path))
        .unwrap_or(false);

    LauncherStatus {
        repo_root: repo_root_text,
        node_available: node_available(),
        frontend_bundle_ready: frontend_ready,
        setup_api_running: is_port_open(3010),
        setup_url: setup_url(),
    }
}

fn start_setup_api(root: &Path) -> Result<(), String> {
    if is_port_open(3010) {
        return Ok(());
    }

    let server_path = root.join("setup-api").join("src").join("server.js");
    if !server_path.exists() {
        return Err("Could not find setup-api/src/server.js in the PRonto workspace.".to_string());
    }

    let mut command = Command::new("node");
    command
        .arg(server_path)
        .current_dir(root)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    command
        .spawn()
        .map_err(|error| format!("Could not start the setup API: {error}"))?;

    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if is_port_open(3010) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(300));
    }

    Err("The setup API did not become ready on port 3010 within 20 seconds.".to_string())
}

#[tauri::command]
fn get_launcher_status() -> LauncherStatus {
    launch_status()
}

#[tauri::command]
fn start_setup_flow() -> Result<LauncherStatus, String> {
    let repo_root = find_repo_root().ok_or_else(|| {
        "Could not find the PRonto workspace. Place the launcher inside the downloaded PRonto folder, or set PRONTO_WORKSPACE_ROOT.".to_string()
    })?;

    if !node_available() {
        return Err("Node.js is not installed or is not available in PATH. Install Node.js first, then retry.".to_string());
    }

    if !frontend_bundle_ready(&repo_root) {
        return Err(
            "The built setup UI is missing. Build the frontend before packaging the launcher so the setup API can serve frontend/dist."
                .to_string(),
        );
    }

    start_setup_api(&repo_root)?;
    open_browser(&setup_url())?;

    Ok(launch_status())
}

#[tauri::command]
fn open_setup_in_browser() -> Result<(), String> {
    open_browser(&setup_url())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_launcher_status,
            start_setup_flow,
            open_setup_in_browser
        ])
        .run(tauri::generate_context!())
        .expect("error while running PRonto Launcher");
}
