mod auth_broker;

const DEFAULT_BIND: &str = "127.0.0.1:3020";

fn main() {
    let bind = std::env::var("AUTH_BROKER_BIND").unwrap_or_else(|_| DEFAULT_BIND.to_string());
    auth_broker::run_server(&bind);
}
