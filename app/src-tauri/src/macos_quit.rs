//! Route `terminate:` (menu, Dock et session macOS) vers la fermeture Tauri.

use std::ffi::{c_char, c_void};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use dispatch2::{DispatchQueue, DispatchTime};
use objc2::{
    class, msg_send,
    runtime::{AnyClass, AnyObject, Bool, Sel},
    sel,
};
use tauri::{AppHandle, Manager};

static APP: OnceLock<AppHandle> = OnceLock::new();
static QUIT: Mutex<QuitState> = Mutex::new(QuitState {
    next: 0,
    pending: None,
});

#[derive(Default)]
struct QuitState {
    next: u64,
    pending: Option<u64>,
}

impl QuitState {
    // Une nouvelle demande ne remplace jamais la demande déjà en attente de Cocoa.
    fn begin(&mut self) -> Option<u64> {
        if self.pending.is_some() {
            return None;
        }
        self.next = self.next.wrapping_add(1);
        self.pending = Some(self.next);
        self.pending
    }

    fn finish(&mut self, id: u64) -> bool {
        if self.pending != Some(id) {
            return false;
        }
        self.pending = None;
        true
    }
}

#[link(name = "objc")]
extern "C" {
    fn class_addMethod(
        class: *const AnyClass,
        name: Sel,
        implementation: *const c_void,
        types: *const c_char,
    ) -> i8;
}

// À appeler hors d'un rappel de la boucle Tao : YES déclenche potentiellement
// applicationWillTerminate: et donc le rappel Rust RunEvent::Exit immédiatement.
fn reply(id: u64, yes: bool) {
    if !QUIT.lock().unwrap_or_else(|e| e.into_inner()).finish(id) {
        return;
    }
    if yes {
        eprintln!("[atlas] sortie confirmée");
    } else {
        eprintln!("[atlas] sortie refusée (délai)");
    }
    // SAFETY: exécuté uniquement sur la file principale ; NSApplication est vivant.
    unsafe {
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let _: () = msg_send![app, replyToApplicationShouldTerminate: Bool::new(yes)];
    }
}

// NSApplicationTerminateReply : cancel = 0, now = 1, later = 2.
extern "C-unwind" fn should_terminate(_: &AnyObject, _: Sel, _: &AnyObject) -> usize {
    if QUIT
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .pending
        .is_some()
    {
        return 2;
    }
    let Some(window) = APP.get().and_then(|app| app.get_webview_window("main")) else {
        return 1;
    };
    let Some(id) = QUIT.lock().unwrap_or_else(|e| e.into_inner()).begin() else {
        return 2;
    };
    eprintln!("[atlas] quitter intercepté");
    // Le JS attend au plus deux secondes avant destroy. Si la fermeture est
    // empêchée ou si destroy échoue, ne pas laisser la session macOS bloquée.
    let deadline = DispatchTime::try_from(Duration::from_secs(5)).expect("délai valide");
    if DispatchQueue::main()
        .after(deadline, move || reply(id, false))
        .is_err()
    {
        QUIT.lock().unwrap_or_else(|e| e.into_inner()).finish(id);
        return 0;
    }
    if let Err(error) = window.close() {
        eprintln!("[atlas] impossible de demander la fermeture : {error}");
        DispatchQueue::main().exec_async(move || reply(id, false));
    }
    2
}

/// Après destruction, répondre hors du rappel Tao pour éviter sa réentrance.
pub fn window_destroyed() {
    let id = QUIT.lock().unwrap_or_else(|e| e.into_inner()).pending;
    if let Some(id) = id {
        DispatchQueue::main().exec_async(move || reply(id, true));
    }
}

/// Suspendre la sortie automatique de Tauri jusqu'à la réponse Cocoa.
pub fn pending() -> bool {
    QUIT.lock()
        .unwrap_or_else(|e| e.into_inner())
        .pending
        .is_some()
}

/// Ajoute uniquement le sélecteur manquant au délégué de Tao, sans le remplacer.
pub fn install(app: &AppHandle) {
    // SAFETY: appelé sur le fil principal ; la signature correspond à Cocoa.
    unsafe {
        let application: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let delegate: *mut AnyObject = msg_send![application, delegate];
        let Some(delegate) = delegate.as_ref() else {
            eprintln!(
                "[atlas] avertissement : délégué macOS absent, interception de Quitter désactivée"
            );
            return;
        };
        if APP.set(app.clone()).is_err() {
            eprintln!("[atlas] avertissement : interception de Quitter déjà initialisée");
            return;
        }
        if class_addMethod(
            delegate.class(),
            sel!(applicationShouldTerminate:),
            should_terminate as *const () as *const c_void,
            c"Q@:@".as_ptr(),
        ) == 0
        {
            eprintln!(
                "[atlas] avertissement : interception de Quitter indisponible sur le délégué macOS"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::QuitState;

    #[test]
    fn pending_quit_is_single_and_each_reply_is_consumed_once() {
        let mut state = QuitState::default();
        let first = state.begin().unwrap();
        assert_eq!(state.begin(), None);
        assert!(state.finish(first));
        assert!(!state.finish(first));
        let second = state.begin().unwrap();
        assert_ne!(first, second);
        assert!(!state.finish(first)); // ancien délai, après une nouvelle demande
        assert_eq!(state.pending, Some(second));
        assert!(state.finish(second));
    }
}
