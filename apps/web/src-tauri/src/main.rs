// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, PhysicalPosition};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder, PredefinedMenuItem};
use serde::{Deserialize, Serialize};

mod audio;

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
struct AppConfig {
    api_base: Option<String>,
    web_base: Option<String>,
    audio_ducking: Option<bool>,
}

#[derive(Clone, Debug)]
struct WindowGeometry {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

// State für Mini-Modus
struct AppState {
    is_mini_mode: Mutex<bool>,
    saved_geometry: Mutex<Option<WindowGeometry>>,
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
        api_base: Some("https://api.meetropolis.me".to_string()),
        web_base: Some("https://meetropolis.me".to_string()),
        audio_ducking: Some(true),
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

/// Interne Toggle-Logik, aufrufbar sowohl vom Tauri-Command als auch vom Menu-Event.
fn do_toggle_mini_mode(app: &tauri::AppHandle, state: &AppState) -> bool {
    let is_mini = *state.is_mini_mode.lock().unwrap();

    if let Some(main_window) = app.get_webview_window("main") {
        if is_mini {
            // Zurück zum Vollmodus
            if let Some(geo) = state.saved_geometry.lock().unwrap().take() {
                let _ = main_window.set_resizable(true);
                let _ = main_window.set_always_on_top(false);
                let _ = main_window.set_size(tauri::PhysicalSize::new(geo.width, geo.height));
                let _ = main_window.set_position(PhysicalPosition::new(geo.x, geo.y));
            } else {
                let _ = main_window.set_resizable(true);
                let _ = main_window.set_always_on_top(false);
                let _ = main_window.set_size(tauri::PhysicalSize::new(1280, 800));
                let _ = main_window.center();
            }
            *state.is_mini_mode.lock().unwrap() = false;
            let _ = main_window.emit("mini-mode-changed", false);
            false
        } else {
            // Mini-Modus aktivieren: Geometrie speichern
            let outer = main_window.outer_position().ok();
            let inner = main_window.inner_size().ok();
            if let (Some(pos), Some(size)) = (outer, inner) {
                *state.saved_geometry.lock().unwrap() = Some(WindowGeometry {
                    x: pos.x,
                    y: pos.y,
                    width: size.width,
                    height: size.height,
                });
            }

            // Resize auf 340x520, always-on-top
            let _ = main_window.set_size(tauri::PhysicalSize::new(340, 520));
            let _ = main_window.set_always_on_top(true);
            let _ = main_window.set_resizable(false);

            // Position unten rechts
            if let Ok(Some(monitor)) = main_window.current_monitor() {
                let screen_size = monitor.size();
                let screen_pos = monitor.position();
                let x = screen_pos.x + (screen_size.width as i32) - 340 - 20;
                let y = screen_pos.y + (screen_size.height as i32) - 520 - 80;
                let _ = main_window.set_position(PhysicalPosition::new(x, y));
            }

            *state.is_mini_mode.lock().unwrap() = true;
            let _ = main_window.emit("mini-mode-changed", true);
            true
        }
    } else {
        !is_mini
    }
}

#[tauri::command]
fn toggle_mini_mode(app: tauri::AppHandle, state: tauri::State<AppState>) -> bool {
    do_toggle_mini_mode(&app, &state)
}

#[tauri::command]
fn is_mini_mode(state: tauri::State<AppState>) -> bool {
    *state.is_mini_mode.lock().unwrap()
}

#[tauri::command]
fn set_audio_ducking(handle: tauri::AppHandle, enabled: bool) -> bool {
    if let Err(e) = audio::set_audio_ducking(enabled) {
        eprintln!("Failed to set audio ducking: {}", e);
        return false;
    }
    // Persist to config
    let mut config = get_config(handle.clone());
    config.audio_ducking = Some(enabled);
    set_config(handle, config)
}

#[tauri::command]
fn get_audio_ducking(handle: tauri::AppHandle) -> bool {
    let config = get_config(handle);
    config.audio_ducking.unwrap_or(true)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            is_mini_mode: Mutex::new(false),
            saved_geometry: Mutex::new(None),
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

            // Apply audio ducking from config at startup
            let config = get_config(app.handle().clone());
            audio::apply_audio_ducking_from_config(&config);

            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "preferences" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("open-preferences", ());
                    }
                }
                "reload" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.eval("window.location.reload()");
                    }
                }
                "mini_mode" => {
                    let state = app.state::<AppState>();
                    do_toggle_mini_mode(&app, &state);
                }
                _ => {}
            }
        })
        .on_window_event(|_window, _event| {
            // Keine speziellen Window-Events mehr nötig
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_config,
            reload_app,
            toggle_mini_mode,
            is_mini_mode,
            set_audio_ducking,
            get_audio_ducking
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
