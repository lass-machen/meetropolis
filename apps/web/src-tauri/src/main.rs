// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use tauri::api::path::app_config_dir;
use serde::{Deserialize, Serialize};

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
    // Fallback URL für den Test (damit du nicht vor einem weißen Schirm stehst)
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
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_config, set_config])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

