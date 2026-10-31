//! Shell de bureau de Skifer Atlas.
//!
//! Au lancement : choisit un port libre, génère un token de session, démarre le
//! serveur Python (sidecar empaqueté en release, `uv run` en dev), attend qu'il
//! réponde sur /health, puis affiche l'interface. À la fermeture, tue le serveur.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerInfo {
    base_url: String,
    token: String,
}

struct Sidecar(Mutex<Option<CommandChild>>);

#[tauri::command]
fn get_server_info(info: State<'_, ServerInfo>) -> ServerInfo {
    info.inner().clone()
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(8765)
}

/// Sonde /health en HTTP brut, sans dépendance supplémentaire.
fn wait_health(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Ok(mut s) = TcpStream::connect_timeout(
            &format!("127.0.0.1:{port}").parse().unwrap(),
            Duration::from_millis(300),
        ) {
            let _ = s.set_read_timeout(Some(Duration::from_millis(500)));
            let _ = s.write_all(b"GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n");
            let mut buf = String::new();
            let _ = s.read_to_string(&mut buf);
            if buf.starts_with("HTTP/1.") && buf.contains(" 200 ") {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

fn spawn_server(app: &AppHandle, port: u16, token: &str) -> Result<CommandChild, String> {
    let shell = app.shell();
    let command = if cfg!(debug_assertions) {
        // Dev : le cœur Python tourne depuis `core/` via uv, sans empaquetage.
        let core_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../core");
        shell
            .command("uv")
            .args(["run", "--project", core_dir, "skifer-atlas-server"])
    } else {
        shell
            .sidecar("skifer-atlas-server")
            .map_err(|e| format!("Sidecar introuvable : {e}"))?
    };
    let (_rx, child) = command
        .env("ATLAS_PORT", port.to_string())
        .env("ATLAS_TOKEN", token)
        .spawn()
        .map_err(|e| format!("Impossible de démarrer le serveur local : {e}"))?;
    Ok(child)
}

fn stop_server(app: &AppHandle) {
    if let Some(state) = app.try_state::<Sidecar>() {
        if let Some(child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Client OAuth GitHub d'Atlas (plan 0025, ADR 0029) : un identifiant public, fixé à la
    // compilation par la build de release, que le serveur hérite de notre environnement.
    // Une valeur déjà présente sur le poste garde la main. Avant tout fil d'exécution.
    if let Some(id) = option_env!("ATLAS_GITHUB_CLIENT_ID") {
        if std::env::var_os("ATLAS_GITHUB_CLIENT_ID").is_none() {
            std::env::set_var("ATLAS_GITHUB_CLIENT_ID", id);
        }
    }
    let port = free_port();
    let token = uuid::Uuid::new_v4().to_string();
    let info = ServerInfo {
        base_url: format!("http://127.0.0.1:{port}"),
        token: token.clone(),
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(info)
        .manage(Sidecar(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![get_server_info])
        .setup(move |app| {
            let handle = app.handle().clone();
            let child = spawn_server(&handle, port, &token)?;
            *app.state::<Sidecar>().0.lock().unwrap() = Some(child);
            if !wait_health(port, Duration::from_secs(30)) {
                stop_server(&handle);
                return Err("Le serveur local n'a pas répondu dans les 30 s.".into());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erreur au démarrage de Skifer Atlas");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop_server(handle);
        }
    });
}
