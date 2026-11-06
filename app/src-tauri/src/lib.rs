//! Shell de bureau de Skifer Atlas.
//!
//! Au lancement : choisit un port libre, génère un token de session, démarre le
//! serveur Python (sidecar empaqueté en release, `uv run` en dev), attend qu'il
//! prouve son identité sur /alive, puis affiche l'interface. À la fermeture, tue le
//! serveur ; le serveur surveille aussi notre identifiant de processus
//! (`ATLAS_PARENT_PID`) et s'arrête seul si l'app disparaît sans fermeture propre
//! (plan 0019).
//!
//! Le port est libéré avant le lancement du serveur : un autre processus local peut le
//! prendre entre-temps. La sonde ne se contente donc pas d'une réponse 200 et ne
//! transmet jamais le token : elle envoie un nonce et n'accepte que le HMAC-SHA256 que
//! seul le vrai serveur sait calculer (ADR 0041).

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerInfo {
    base_url: String,
    token: String,
}

struct Sidecar(Mutex<Option<CommandChild>>);

/// Fin du processus serveur : `None` tant qu'il tourne, sinon son code de sortie (s'il en a un).
type Exit = Arc<Mutex<Option<Option<i32>>>>;

/// Combien de ports essayer si le serveur s'arrête au démarrage (port repris, par exemple).
const START_ATTEMPTS: u32 = 3;
const START_TIMEOUT: Duration = Duration::from_secs(30);

/// Ligne écrite sur la sortie de l'app une fois la preuve du serveur acceptée, et seulement
/// alors : `scripts/smoke-app.sh` la lit pour savoir que la fenêtre va s'ouvrir. Elle ne porte
/// ni le token ni la preuve.
fn ready_message(port: u16) -> String {
    format!("[atlas] serveur vérifié, port {port}")
}

/// Contexte de la preuve : identique à `ALIVE_CONTEXT` de `api/app.py`.
const ALIVE_CONTEXT: &[u8] = b"skifer-atlas-alive:";

#[tauri::command]
fn get_server_info(info: State<'_, Mutex<ServerInfo>>) -> ServerInfo {
    info.lock().unwrap().clone()
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(8765)
}

fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut block = [0u8; BLOCK];
    if key.len() > BLOCK {
        block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let pad = |byte: u8| block.map(|b| b ^ byte);
    let mut inner = Sha256::new();
    inner.update(pad(0x36));
    inner.update(message);
    let mut outer = Sha256::new();
    outer.update(pad(0x5c));
    outer.update(inner.finalize());
    outer.finalize().into()
}

/// La preuve que le serveur doit rendre pour ce nonce : HMAC-SHA256(token, contexte || nonce), en hexadécimal.
fn alive_proof(token: &str, nonce: &str) -> String {
    let message = [ALIVE_CONTEXT, nonce.as_bytes()].concat();
    hmac_sha256(token.as_bytes(), &message)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Comparaison en temps constant (la longueur seule peut fuir, elle est publique).
fn same_bytes(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |diff, (x, y)| diff | (x ^ y)) == 0
}

fn alive_request(nonce: &str) -> String {
    format!("GET /alive?nonce={nonce} HTTP/1.0\r\nHost: localhost\r\n\r\n")
}

/// Vrai si `raw`, la réponse HTTP brute, est un 200 qui porte la preuve attendue pour ce
/// token et ce nonce. Tout le reste (autre statut, corps illisible, mauvaise preuve : un
/// serveur qui répond 200 à tout) est refusé.
fn alive_response_is_valid(raw: &str, token: &str, nonce: &str) -> bool {
    let Some((head, body)) = raw.split_once("\r\n\r\n") else {
        return false;
    };
    let status = head.lines().next().unwrap_or("");
    if !status.starts_with("HTTP/1.") || status.split_whitespace().nth(1) != Some("200") {
        return false;
    }
    let Ok(json) = serde_json::from_str::<serde_json::Value>(body.trim()) else {
        return false;
    };
    match json.get("proof").and_then(|p| p.as_str()) {
        Some(proof) => same_bytes(proof.as_bytes(), alive_proof(token, nonce).as_bytes()),
        None => false,
    }
}

enum Probe {
    /// Le serveur a prouvé son identité.
    Ready,
    /// Le processus serveur s'est arrêté (code de sortie éventuel).
    Exited(Option<i32>),
    TimedOut,
}

/// Sonde /alive en HTTP brut, sans dépendance supplémentaire. S'arrête dès que le processus
/// serveur n'est plus là : inutile d'attendre le délai complet un port déjà pris.
fn wait_alive(port: u16, token: &str, exit: &Exit, timeout: Duration) -> Probe {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Some(code) = *exit.lock().unwrap() {
            return Probe::Exited(code);
        }
        // Un nonce neuf à chaque essai : une réponse ne se rejoue pas.
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        if let Ok(mut s) = TcpStream::connect_timeout(
            &format!("127.0.0.1:{port}").parse().unwrap(),
            Duration::from_millis(300),
        ) {
            let _ = s.set_read_timeout(Some(Duration::from_millis(500)));
            let _ = s.write_all(alive_request(&nonce).as_bytes());
            let mut buf = String::new();
            let _ = s.read_to_string(&mut buf);
            // Le serveur peut avoir quitté pendant l'échange : un imposteur sur le port ne
            // doit pas passer pour lui. La preuve fait foi, pas la réponse seule.
            if alive_response_is_valid(&buf, token, &nonce) && exit.lock().unwrap().is_none() {
                return Probe::Ready;
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Probe::TimedOut
}

fn spawn_server(app: &AppHandle, port: u16, token: &str) -> Result<(CommandChild, Exit), String> {
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
    let (mut rx, child) = command
        .env("ATLAS_PORT", port.to_string())
        .env("ATLAS_TOKEN", token)
        .env("ATLAS_PARENT_PID", std::process::id().to_string())
        .spawn()
        .map_err(|e| format!("Impossible de démarrer le serveur local : {e}"))?;
    let exit: Exit = Arc::new(Mutex::new(None));
    let watcher = exit.clone();
    // La sortie du serveur est relayée sur celle de l'app (sans paniquer si elle n'a pas de
    // sortie). Sans lecteur, ses tubes se ferment et la moindre écriture du serveur échoue.
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    let _ = writeln!(std::io::stderr(), "[serveur] {}", text.trim_end());
                }
                CommandEvent::Terminated(status) => {
                    let _ = writeln!(std::io::stderr(), "[serveur] arrêté ({:?})", status.code);
                    *watcher.lock().unwrap() = Some(status.code);
                }
                _ => {}
            }
        }
    });
    Ok((child, exit))
}

/// Lance le serveur sur un port libre et attend sa preuve d'identité. Si le processus
/// s'arrête au démarrage (port repris entre-temps), nouvel essai sur un autre port ; si la
/// preuve n'arrive pas, ou après le dernier essai, une erreur claire. Garde le serveur dans
/// l'état `Sidecar` dès qu'il tourne, pour que la fermeture le tue.
fn start_server(app: &AppHandle, token: &str) -> Result<ServerInfo, String> {
    let mut last = String::new();
    for attempt in 1..=START_ATTEMPTS {
        let port = free_port();
        let (child, exit) = spawn_server(app, port, token)?;
        *app.state::<Sidecar>().0.lock().unwrap() = Some(child);
        match wait_alive(port, token, &exit, START_TIMEOUT) {
            Probe::Ready => {
                let _ = writeln!(std::io::stderr(), "{}", ready_message(port));
                return Ok(ServerInfo {
                    base_url: format!("http://127.0.0.1:{port}"),
                    token: token.to_string(),
                });
            }
            Probe::Exited(code) => {
                last = format!(
                    "Le serveur local s'est arrêté au démarrage (code {}) sur le port {port}, \
                     peut-être déjà pris par un autre programme.",
                    code.map_or("inconnu".to_string(), |c| c.to_string())
                );
                stop_server(app);
                let _ = writeln!(
                    std::io::stderr(),
                    "[atlas] essai {attempt}/{START_ATTEMPTS} : {last}"
                );
            }
            Probe::TimedOut => {
                stop_server(app);
                return Err(format!(
                    "Le serveur local n'a pas prouvé son identité dans les {} s (port {port}).",
                    START_TIMEOUT.as_secs()
                ));
            }
        }
    }
    Err(format!("{last} Abandon après {START_ATTEMPTS} essais."))
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
    let token = uuid::Uuid::new_v4().to_string();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        // Renseigné par `setup`, avant l'affichage de la fenêtre : l'interface ne l'interroge
        // qu'ensuite.
        .manage(Mutex::new(ServerInfo {
            base_url: String::new(),
            token: String::new(),
        }))
        .manage(Sidecar(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![get_server_info])
        .setup(move |app| {
            let handle = app.handle().clone();
            let info = start_server(&handle, &token)?;
            *app.state::<Mutex<ServerInfo>>().lock().unwrap() = info;
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

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "jeton-de-session";
    const NONCE: &str = "0123456789abcdef0123456789abcdef";
    // Calculée avec `hmac.new(TOKEN, b"skifer-atlas-alive:" + NONCE, "sha256")` en Python :
    // le même vecteur est dans core/tests/test_api.py.
    const PROOF: &str = "64c4bb9f25f4e223a53dc3ef420f459a0f570ee2929bfbfab8940fa6074806bf";

    fn hex(bytes: [u8; 32]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn response(status: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{body}",
            body.len()
        )
    }

    #[test]
    fn hmac_matches_the_rfc_4231_vectors() {
        // Cas 1 : clé courte.
        assert_eq!(
            hex(hmac_sha256(&[0x0b; 20], b"Hi There")),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
        // Cas 2 : clé « Jefe ».
        assert_eq!(
            hex(hmac_sha256(b"Jefe", b"what do ya want for nothing?")),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
        // Cas 6 : clé plus longue qu'un bloc, hachée d'abord.
        assert_eq!(
            hex(hmac_sha256(
                &[0xaa; 131],
                b"Test Using Larger Than Block-Size Key - Hash Key First"
            )),
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
        );
    }

    #[test]
    fn the_proof_is_the_one_the_python_server_computes() {
        assert_eq!(alive_proof(TOKEN, NONCE), PROOF);
    }

    #[test]
    fn the_request_carries_the_nonce_and_never_the_token() {
        let request = alive_request(NONCE);
        assert!(request.starts_with(&format!("GET /alive?nonce={NONCE} HTTP/1.0\r\n")));
        assert!(!request.contains(TOKEN) && !request.to_lowercase().contains("authorization"));
    }

    #[test]
    fn the_right_proof_is_accepted() {
        let body = format!("{{\"proof\":\"{PROOF}\"}}");
        assert!(alive_response_is_valid(
            &response("200 OK", &body),
            TOKEN,
            NONCE
        ));
    }

    #[test]
    fn an_impostor_answering_200_to_everything_is_refused() {
        // Le /health d'un autre programme, une page quelconque, un JSON sans preuve.
        for body in [
            "{\"status\":\"ok\",\"version\":\"0.0.1\"}",
            "OK",
            "",
            "{\"proof\":\"\"}",
            "{\"proof\":42}",
            "{\"proof\":null}",
        ] {
            assert!(
                !alive_response_is_valid(&response("200 OK", body), TOKEN, NONCE),
                "{body}"
            );
        }
    }

    #[test]
    fn a_proof_for_another_token_or_another_nonce_is_refused() {
        let other_token = format!("{{\"proof\":\"{}\"}}", alive_proof("autre-jeton", NONCE));
        let other_nonce = format!("{{\"proof\":\"{}\"}}", alive_proof(TOKEN, "ff"));
        let truncated = format!("{{\"proof\":\"{}\"}}", &PROOF[..63]);
        for body in [other_token, other_nonce, truncated] {
            assert!(!alive_response_is_valid(
                &response("200 OK", &body),
                TOKEN,
                NONCE
            ));
        }
    }

    #[test]
    fn a_good_proof_with_another_status_is_refused() {
        let body = format!("{{\"proof\":\"{PROOF}\"}}");
        for status in [
            "401 Unauthorized",
            "404 Not Found",
            "500 Internal Server Error",
        ] {
            assert!(!alive_response_is_valid(
                &response(status, &body),
                TOKEN,
                NONCE
            ));
        }
    }

    #[test]
    fn a_truncated_or_foreign_reply_is_refused() {
        let body = format!("{{\"proof\":\"{PROOF}\"}}");
        assert!(!alive_response_is_valid("", TOKEN, NONCE));
        assert!(!alive_response_is_valid("HTTP/1.1 200 OK", TOKEN, NONCE));
        assert!(!alive_response_is_valid(
            &format!("SSH-2.0 200 \r\n\r\n{body}"),
            TOKEN,
            NONCE
        ));
        assert!(!alive_response_is_valid(
            "HTTP/1.1 200 OK\r\n\r\n{\"proof\":",
            TOKEN,
            NONCE
        ));
    }

    /// Un faux serveur local : répond à une cinquantaine de connexions, puis s'arrête. Le
    /// fil de test qui l'a lancé ne l'attend pas (le fil du serveur meurt avec le processus).
    fn serve(reply: impl Fn(&str) -> String + Send + 'static) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for _ in 0..50 {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                let mut request = [0u8; 1024];
                let n = stream.read(&mut request).unwrap_or(0);
                let request = String::from_utf8_lossy(&request[..n]).to_string();
                let _ = stream.write_all(reply(&request).as_bytes());
            }
        });
        port
    }

    /// Le serveur légitime : signe le nonce qu'on lui envoie.
    fn real_server(request: &str) -> String {
        let nonce = request
            .split("nonce=")
            .nth(1)
            .and_then(|rest| rest.split_whitespace().next())
            .unwrap_or("");
        response(
            "200 OK",
            &format!("{{\"proof\":\"{}\"}}", alive_proof(TOKEN, nonce)),
        )
    }

    fn running() -> Exit {
        Arc::new(Mutex::new(None))
    }

    #[test]
    fn the_probe_accepts_the_real_server() {
        let port = serve(real_server);
        assert!(matches!(
            wait_alive(port, TOKEN, &running(), Duration::from_secs(5)),
            Probe::Ready
        ));
    }

    #[test]
    fn the_probe_never_signals_ready_for_a_well_formed_but_false_proof() {
        // Une preuve de la bonne forme (64 caractères hexadécimaux), mais d'un autre token :
        // c'est ce que renverrait un sidecar qui ne connaît pas le token de la session.
        let forged = alive_proof("autre-jeton", NONCE);
        assert_eq!(forged.len(), 64);
        let port = serve(move |_| response("200 OK", &format!("{{\"proof\":\"{forged}\"}}")));
        assert!(matches!(
            wait_alive(port, TOKEN, &running(), Duration::from_millis(800)),
            Probe::TimedOut
        ));
    }

    #[test]
    fn the_ready_line_carries_the_port_and_neither_the_token_nor_a_proof() {
        let line = ready_message(50321);
        assert_eq!(line, "[atlas] serveur vérifié, port 50321");
        assert!(!line.contains(TOKEN) && !line.contains(PROOF));
    }

    #[test]
    fn the_probe_never_accepts_a_server_that_answers_200_to_everything() {
        let port = serve(|_| response("200 OK", "{\"status\":\"ok\"}"));
        assert!(matches!(
            wait_alive(port, TOKEN, &running(), Duration::from_millis(800)),
            Probe::TimedOut
        ));
    }

    #[test]
    fn the_probe_gives_up_at_once_when_the_server_process_has_stopped() {
        let port = serve(|_| response("200 OK", "{\"status\":\"ok\"}"));
        let exit: Exit = Arc::new(Mutex::new(Some(Some(1))));
        let started = Instant::now();
        assert!(matches!(
            wait_alive(port, TOKEN, &exit, Duration::from_secs(30)),
            Probe::Exited(Some(1))
        ));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn the_probe_refuses_a_good_proof_once_the_server_process_has_stopped() {
        // Le port est tenu par un autre programme qui rejoue une preuve valide : sans
        // processus serveur vivant, la sonde n'y croit pas.
        let port = serve(real_server);
        let exit: Exit = Arc::new(Mutex::new(Some(None)));
        assert!(matches!(
            wait_alive(port, TOKEN, &exit, Duration::from_secs(5)),
            Probe::Exited(None)
        ));
    }
}
