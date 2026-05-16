pub mod api;
pub mod persistence_verifier;
pub mod preflight;
pub mod provider_adapters;
pub mod session_manager;
pub mod types;

use std::thread;
use tiny_http::Server;

use session_manager::SessionManager;

pub fn run_server(bind: &str) {
    let server = Server::http(bind).expect("failed to bind launcher auth broker host");
    println!("Launcher native auth broker listening on http://{bind}");

    let manager = SessionManager::new();
    for request in server.incoming_requests() {
        let manager_cloned = manager.clone();
        thread::spawn(move || {
            api::handle_request(request, &manager_cloned);
        });
    }
}
