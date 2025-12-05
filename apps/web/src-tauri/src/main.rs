// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::api::path::app_config_dir;
use tauri::{CustomMenuItem, Manager, Menu, MenuItem, Submenu, AboutMetadata, PhysicalSize, PhysicalPosition};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
struct AppConfig {
    api_base: Option<String>,
    web_base: Option<String>,
}

// State für Mini-Window-Modus
struct AppState {
    is_mini_mode: Mutex<bool>,
    last_main_position: Mutex<Option<(i32, i32)>>,
    last_main_size: Mutex<Option<(u32, u32)>>,
}

fn get_config_path(handle: &tauri::AppHandle) -> Option<PathBuf> {
    let config_dir = app_config_dir(&handle.config()).unwrap_or_default();
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
        api_base: Some("https://meetropolis.s4.lmwow.de".to_string()),
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
fn reload_app(window: tauri::Window) -> bool {
    // Reload the current page
    let _ = window.eval("window.location.reload()");
    true
}

#[tauri::command]
fn toggle_mini_mode(app: tauri::AppHandle, state: tauri::State<AppState>) -> bool {
    let is_mini = *state.is_mini_mode.lock().unwrap();

    if is_mini {
        // Wechsel zurück zum Hauptfenster
        expand_to_main_window(&app, &state);
        *state.is_mini_mode.lock().unwrap() = false;
    } else {
        // Wechsel zum Mini-Fenster
        shrink_to_mini_window(&app, &state);
        *state.is_mini_mode.lock().unwrap() = true;
    }

    !is_mini
}

#[tauri::command]
fn is_mini_mode(state: tauri::State<AppState>) -> bool {
    *state.is_mini_mode.lock().unwrap()
}

fn shrink_to_mini_window(app: &tauri::AppHandle, state: &AppState) {
    if let Some(main_window) = app.get_window("main") {
        // Speichere aktuelle Position und Größe
        if let Ok(pos) = main_window.outer_position() {
            *state.last_main_position.lock().unwrap() = Some((pos.x, pos.y));
        }
        if let Ok(size) = main_window.inner_size() {
            *state.last_main_size.lock().unwrap() = Some((size.width, size.height));
        }

        // Mini-Fenster: Klein, immer im Vordergrund, unten rechts
        let _ = main_window.set_size(PhysicalSize::new(320, 180));
        let _ = main_window.set_always_on_top(true);
        let _ = main_window.set_decorations(false);

        // Positioniere unten rechts auf dem Bildschirm
        if let Ok(monitor) = main_window.current_monitor() {
            if let Some(monitor) = monitor {
                let screen_size = monitor.size();
                let screen_pos = monitor.position();
                let x = screen_pos.x + (screen_size.width as i32) - 340;
                let y = screen_pos.y + (screen_size.height as i32) - 200;
                let _ = main_window.set_position(PhysicalPosition::new(x, y));
            }
        }

        // Navigiere zur Mini-Ansicht
        let _ = main_window.eval("window.__TAURI_MINI_MODE__ = true; window.dispatchEvent(new CustomEvent('tauri-mini-mode', { detail: { mini: true } }));");
    }
}

fn expand_to_main_window(app: &tauri::AppHandle, state: &AppState) {
    if let Some(main_window) = app.get_window("main") {
        // Stelle ursprüngliche Größe und Position wieder her
        let size = state.last_main_size.lock().unwrap().unwrap_or((1280, 800));
        let pos = state.last_main_position.lock().unwrap();

        let _ = main_window.set_always_on_top(false);
        let _ = main_window.set_decorations(true);
        let _ = main_window.set_size(PhysicalSize::new(size.0, size.1));

        if let Some((x, y)) = *pos {
            let _ = main_window.set_position(PhysicalPosition::new(x, y));
        } else {
            let _ = main_window.center();
        }

        // Benachrichtige die App
        let _ = main_window.eval("window.__TAURI_MINI_MODE__ = false; window.dispatchEvent(new CustomEvent('tauri-mini-mode', { detail: { mini: false } }));");
    }
}

fn main() {
    // Menü Definition
    let prefs = CustomMenuItem::new("preferences".to_string(), "Einstellungen...").accelerator("CmdOrCtrl+,");
    let reload = CustomMenuItem::new("reload".to_string(), "Neu laden").accelerator("CmdOrCtrl+R");
    let mini_mode = CustomMenuItem::new("mini_mode".to_string(), "Mini-Fenster").accelerator("CmdOrCtrl+M");

    let submenu_app = Submenu::new("Meetropolis", Menu::new()
        .add_native_item(MenuItem::About("Meetropolis".to_string(), AboutMetadata::default()))
        .add_native_item(MenuItem::Separator)
        .add_item(prefs)
        .add_native_item(MenuItem::Separator)
        .add_native_item(MenuItem::Services)
        .add_native_item(MenuItem::Hide)
        .add_native_item(MenuItem::HideOthers)
        .add_native_item(MenuItem::ShowAll)
        .add_native_item(MenuItem::Separator)
        .add_native_item(MenuItem::Quit));

    let submenu_edit = Submenu::new("Bearbeiten", Menu::new()
        .add_native_item(MenuItem::Undo)
        .add_native_item(MenuItem::Redo)
        .add_native_item(MenuItem::Separator)
        .add_native_item(MenuItem::Cut)
        .add_native_item(MenuItem::Copy)
        .add_native_item(MenuItem::Paste)
        .add_native_item(MenuItem::SelectAll));

    let submenu_view = Submenu::new("Darstellung", Menu::new()
        .add_item(reload)
        .add_native_item(MenuItem::Separator)
        .add_item(mini_mode)
        .add_native_item(MenuItem::Separator)
        .add_native_item(MenuItem::EnterFullScreen));

    let submenu_window = Submenu::new("Fenster", Menu::new()
        .add_native_item(MenuItem::Minimize)
        .add_native_item(MenuItem::Zoom));

    let menu = Menu::new()
        .add_submenu(submenu_app)
        .add_submenu(submenu_edit)
        .add_submenu(submenu_view)
        .add_submenu(submenu_window);

    tauri::Builder::default()
        .manage(AppState {
            is_mini_mode: Mutex::new(false),
            last_main_position: Mutex::new(None),
            last_main_size: Mutex::new(None),
        })
        .menu(menu)
        .on_menu_event(|event| {
            let app = event.window().app_handle();
            match event.menu_item_id() {
                "preferences" => {
                    let window = event.window();
                    let _ = window.eval("window.location.href = 'tauri://localhost/index.html#setup'");
                }
                "reload" => {
                    let window = event.window();
                    let _ = window.eval("window.location.reload()");
                }
                "mini_mode" => {
                    let state = app.state::<AppState>();
                    let is_mini = *state.is_mini_mode.lock().unwrap();

                    if is_mini {
                        expand_to_main_window(&app, &state);
                        *state.is_mini_mode.lock().unwrap() = false;
                    } else {
                        shrink_to_mini_window(&app, &state);
                        *state.is_mini_mode.lock().unwrap() = true;
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_config,
            reload_app,
            toggle_mini_mode,
            is_mini_mode
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
