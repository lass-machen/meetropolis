// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use tauri::api::path::app_config_dir;
use serde::{Deserialize, Serialize};
use tauri::{CustomMenuItem, Menu, MenuItem, Submenu, AboutMetadata};

#[derive(Serialize, Deserialize, Debug, Default)]
struct AppConfig {
    api_base: Option<String>,
    web_base: Option<String>,
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

fn main() {
    // Menü Definition
    let prefs = CustomMenuItem::new("preferences".to_string(), "Einstellungen...").accelerator("CmdOrCtrl+,");
    
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
        .menu(menu)
        .on_menu_event(|event| {
            match event.menu_item_id() {
                "preferences" => {
                    let window = event.window();
                    // Navigiere zur lokalen index.html mit setup flag
                    // Da die URL "tauri://localhost" (oder file://) ist, navigieren wir relativ
                    // Wenn wir auf remote (https://...) sind, ist "index.html" vielleicht nicht erreichbar als relativer Pfad?
                    // Wir müssen die tauri://localhost URL kennen.
                    // Sicherer: Wir nutzen window.eval, um window.location auf den tauri-scheme Pfad zu setzen.
                    // Auf macOS ist das tauri://localhost/index.html#setup
                    let _ = window.eval("window.location.href = 'tauri://localhost/index.html#setup'");
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![get_config, set_config])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
