// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder, PredefinedMenuItem};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
struct AppConfig {
    api_base: Option<String>,
    web_base: Option<String>,
}

// State für Mini-Window-Modus
struct AppState {
    is_mini_mode: Mutex<bool>,
}

// AV-Status der vom Hauptfenster zum Mini-Fenster synchronisiert wird
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct AvStatus {
    pub mic: bool,
    pub cam: bool,
    pub dnd: bool,
    pub share: bool,
    pub online_count: u32,
    pub speaking_names: Vec<String>,
}

fn get_config_path(handle: &tauri::AppHandle) -> Option<PathBuf> {
    let config_dir = handle.path().app_config_dir().ok()?;
    if !config_dir.exists() {
        let _ = fs::create_dir_all(&config_dir);
    }
    Some(config_dir.join("config.json"))
}

#[tauri::command]
fn get_config(handle: tauri::AppHandle) -> AppConfig {
    if let Some(path) = get_config_path(&handle) {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(cfg) = serde_json::from_str::<AppConfig>(&content) {
                return cfg;
            }
        }
    }
    AppConfig {
        api_base: Some("https://api.meetropolis.s4.lmwow.de".to_string()),
        web_base: Some("https://meetropolis.s4.lmwow.de".to_string()),
    }
}

#[tauri::command]
fn set_config(handle: tauri::AppHandle, config: AppConfig) -> bool {
    if let Some(path) = get_config_path(&handle) {
        if let Ok(json) = serde_json::to_string_pretty(&config) {
            if fs::write(path, json).is_ok() {
                return true;
            }
        }
    }
    false
}

#[tauri::command]
fn reload_app(webview: tauri::Webview) -> bool {
    let _ = webview.eval("window.location.reload()");
    true
}

#[tauri::command]
fn toggle_mini_mode(app: tauri::AppHandle, state: tauri::State<AppState>) -> bool {
    let is_mini = *state.is_mini_mode.lock().unwrap();

    if is_mini {
        // Zurück zum Hauptfenster
        close_mini_show_main(&app, &state);
    } else {
        // Mini-Modus aktivieren
        hide_main_show_mini(&app, &state);
    }

    !is_mini
}

#[tauri::command]
fn is_mini_mode(state: tauri::State<AppState>) -> bool {
    *state.is_mini_mode.lock().unwrap()
}

// Vom Hauptfenster aufgerufen: AV-Status an Mini-Fenster senden
#[tauri::command]
fn sync_av_status(app: tauri::AppHandle, status: AvStatus) {
    if let Some(mini_window) = app.get_webview_window("mini") {
        let _ = mini_window.emit("av-status-update", status);
    }
}

// Vom Mini-Fenster aufgerufen: AV-Aktion an Hauptfenster senden
#[tauri::command]
fn mini_av_action(app: tauri::AppHandle, action: String) {
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.emit("mini-av-action", action);
    }
}

// Vom Mini-Fenster aufgerufen: Zurück zum Hauptfenster
#[tauri::command]
fn expand_from_mini(app: tauri::AppHandle, state: tauri::State<AppState>) {
    close_mini_show_main(&app, &state);
}

fn hide_main_show_mini(app: &tauri::AppHandle, state: &AppState) {
    // Hauptfenster verstecken (nicht schließen!)
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.hide();
    }

    // Mini-Fenster erstellen falls es noch nicht existiert
    if app.get_webview_window("mini").is_none() {
        let mini_window = WebviewWindowBuilder::new(
            app,
            "mini",
            WebviewUrl::App("mini.html".into())
        )
        .title("Meetropolis")
        .inner_size(280.0, 160.0)
        .min_inner_size(280.0, 160.0)
        .resizable(false)
        .decorations(true)  // Normale Titelleiste für Drag!
        .always_on_top(true)
        .skip_taskbar(false)
        .center()
        .build();

        if let Ok(window) = mini_window {
            // Positioniere unten rechts
            if let Ok(Some(monitor)) = window.current_monitor() {
                let screen_size = monitor.size();
                let screen_pos = monitor.position();
                let x = screen_pos.x + (screen_size.width as i32) - 300 - 20;
                let y = screen_pos.y + (screen_size.height as i32) - 180 - 80;
                let _ = window.set_position(PhysicalPosition::new(x, y));
            }
        }
    } else if let Some(mini_window) = app.get_webview_window("mini") {
        let _ = mini_window.show();
        let _ = mini_window.set_focus();
    }

    *state.is_mini_mode.lock().unwrap() = true;

    // Hauptfenster informieren
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.emit("mini-mode-changed", true);
    }
}

fn close_mini_show_main(app: &tauri::AppHandle, state: &AppState) {
    // Mini-Fenster schließen
    if let Some(mini_window) = app.get_webview_window("mini") {
        let _ = mini_window.close();
    }

    // Hauptfenster wieder zeigen
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.show();
        let _ = main_window.set_focus();
    }

    *state.is_mini_mode.lock().unwrap() = false;

    // Hauptfenster informieren
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.emit("mini-mode-changed", false);
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            is_mini_mode: Mutex::new(false),
        })
        .setup(|app| {
            // Menü erstellen
            let prefs = MenuItemBuilder::with_id("preferences", "Einstellungen...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;
            let reload = MenuItemBuilder::with_id("reload", "Neu laden")
                .accelerator("CmdOrCtrl+R")
                .build(app)?;
            let mini_mode = MenuItemBuilder::with_id("mini_mode", "Mini-Fenster")
                .accelerator("CmdOrCtrl+M")
                .build(app)?;

            let submenu_app = SubmenuBuilder::new(app, "Meetropolis")
                .item(&PredefinedMenuItem::about(app, Some("Über Meetropolis"), None)?)
                .separator()
                .item(&prefs)
                .separator()
                .item(&PredefinedMenuItem::services(app, Some("Dienste"))?)
                .item(&PredefinedMenuItem::hide(app, Some("Meetropolis ausblenden"))?)
                .item(&PredefinedMenuItem::hide_others(app, Some("Andere ausblenden"))?)
                .item(&PredefinedMenuItem::show_all(app, Some("Alle anzeigen"))?)
                .separator()
                .item(&PredefinedMenuItem::quit(app, Some("Meetropolis beenden"))?)
                .build()?;

            let submenu_edit = SubmenuBuilder::new(app, "Bearbeiten")
                .item(&PredefinedMenuItem::undo(app, Some("Widerrufen"))?)
                .item(&PredefinedMenuItem::redo(app, Some("Wiederholen"))?)
                .separator()
                .item(&PredefinedMenuItem::cut(app, Some("Ausschneiden"))?)
                .item(&PredefinedMenuItem::copy(app, Some("Kopieren"))?)
                .item(&PredefinedMenuItem::paste(app, Some("Einsetzen"))?)
                .item(&PredefinedMenuItem::select_all(app, Some("Alles auswählen"))?)
                .build()?;

            let submenu_view = SubmenuBuilder::new(app, "Darstellung")
                .item(&reload)
                .separator()
                .item(&mini_mode)
                .separator()
                .item(&PredefinedMenuItem::fullscreen(app, Some("Vollbild ein/aus"))?)
                .build()?;

            let submenu_window = SubmenuBuilder::new(app, "Fenster")
                .item(&PredefinedMenuItem::minimize(app, Some("Minimieren"))?)
                .item(&PredefinedMenuItem::maximize(app, Some("Zoomen"))?)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&submenu_app)
                .item(&submenu_edit)
                .item(&submenu_view)
                .item(&submenu_window)
                .build()?;

            app.set_menu(menu)?;

            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "preferences" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.eval("window.location.href = 'tauri://localhost/index.html#setup'");
                    }
                }
                "reload" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.eval("window.location.reload()");
                    }
                }
                "mini_mode" => {
                    let state = app.state::<AppState>();
                    let is_mini = *state.is_mini_mode.lock().unwrap();

                    if is_mini {
                        close_mini_show_main(&app, &state);
                    } else {
                        hide_main_show_mini(&app, &state);
                    }
                }
                _ => {}
            }
        })
        .on_window_event(|window, event| {
            // Wenn Mini-Fenster geschlossen wird, zurück zum Hauptfenster
            if window.label() == "mini" {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    let app = window.app_handle();
                    let state = app.state::<AppState>();
                    *state.is_mini_mode.lock().unwrap() = false;

                    if let Some(main_window) = app.get_webview_window("main") {
                        let _ = main_window.show();
                        let _ = main_window.set_focus();
                        let _ = main_window.emit("mini-mode-changed", false);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_config,
            reload_app,
            toggle_mini_mode,
            is_mini_mode,
            sync_av_status,
            mini_av_action,
            expand_from_mini
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
