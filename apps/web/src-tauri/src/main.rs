// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, LogicalSize, PhysicalPosition, PhysicalSize};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder, PredefinedMenuItem};
use serde::{Deserialize, Serialize};

mod audio;

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
struct AppConfig {
    api_base: Option<String>,
    web_base: Option<String>,
    audio_ducking: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct WindowGeometry {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
struct WindowState {
    is_mini_mode: bool,
    normal_geometry: Option<WindowGeometry>,
    mini_position: Option<(i32, i32)>,
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

fn get_window_state_path(handle: &tauri::AppHandle) -> Option<PathBuf> {
    let config_dir = handle.path().app_config_dir().ok()?;
    if !config_dir.exists() {
        let _ = fs::create_dir_all(&config_dir);
    }
    Some(config_dir.join("window_state.json"))
}

fn save_window_state(handle: &tauri::AppHandle, state: &WindowState) {
    if let Some(path) = get_window_state_path(handle) {
        if let Ok(json) = serde_json::to_string_pretty(state) {
            let _ = fs::write(path, json);
        }
    }
}

fn load_window_state(handle: &tauri::AppHandle) -> Option<WindowState> {
    let path = get_window_state_path(handle)?;
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<WindowState>(&content).ok()
}

/// Check if a position is visible on any connected monitor.
fn is_position_on_screen(app: &tauri::AppHandle, x: i32, y: i32, width: u32, height: u32) -> bool {
    if let Ok(monitors) = app.available_monitors() {
        for monitor in monitors {
            let pos = monitor.position();
            let size = monitor.size();
            let mon_left = pos.x;
            let mon_top = pos.y;
            let mon_right = pos.x + size.width as i32;
            let mon_bottom = pos.y + size.height as i32;

            // Window is considered visible if at least 50px overlap with any monitor
            let overlap_x = (x + width as i32).min(mon_right) - x.max(mon_left);
            let overlap_y = (y + height as i32).min(mon_bottom) - y.max(mon_top);

            if overlap_x >= 50 && overlap_y >= 50 {
                return true;
            }
        }
    }
    false
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
                let _ = main_window.set_size(PhysicalSize::new(geo.width, geo.height));
                let _ = main_window.set_position(PhysicalPosition::new(geo.x, geo.y));
            } else {
                let _ = main_window.set_resizable(true);
                let _ = main_window.set_always_on_top(false);
                let _ = main_window.set_size(LogicalSize::new(1280.0, 800.0));
                let _ = main_window.center();
            }
            *state.is_mini_mode.lock().unwrap() = false;
            let _ = main_window.emit("mini-mode-changed", false);

            // Persist window state after leaving mini mode
            let normal_geo = state.saved_geometry.lock().unwrap().clone();
            save_window_state(app, &WindowState {
                is_mini_mode: false,
                normal_geometry: normal_geo,
                mini_position: None,
            });

            false
        } else {
            // Mini-Modus aktivieren: Geometrie speichern (physische Pixel für exaktes Restore)
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

            // Resize auf 340x520 logische Pixel (DPI-unabhängig → immer 340 CSS-px breit)
            let _ = main_window.set_size(LogicalSize::new(340.0, 520.0));
            let _ = main_window.set_always_on_top(true);
            let _ = main_window.set_resizable(false);

            // Position unten rechts (monitor liefert physische Pixel → scale factor berücksichtigen)
            if let Ok(Some(monitor)) = main_window.current_monitor() {
                let scale = monitor.scale_factor();
                let screen_size = monitor.size();
                let screen_pos = monitor.position();
                let win_w = (340.0 * scale) as i32;
                let win_h = (520.0 * scale) as i32;
                let margin = (20.0 * scale) as i32;
                let bottom_margin = (60.0 * scale) as i32;
                let x = screen_pos.x + (screen_size.width as i32) - win_w - margin;
                let y = screen_pos.y + (screen_size.height as i32) - win_h - bottom_margin;
                let _ = main_window.set_position(PhysicalPosition::new(x, y));
            }

            *state.is_mini_mode.lock().unwrap() = true;
            let _ = main_window.emit("mini-mode-changed", true);

            // Persist window state after entering mini mode
            let normal_geo = state.saved_geometry.lock().unwrap().clone();
            let mini_pos = main_window.outer_position().ok().map(|p| (p.x, p.y));
            save_window_state(app, &WindowState {
                is_mini_mode: true,
                normal_geometry: normal_geo,
                mini_position: mini_pos,
            });

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

            // Restore saved window state
            if let Some(ws) = load_window_state(app.handle()) {
                let app_state = app.state::<AppState>();

                if ws.is_mini_mode {
                    // Restore normal geometry into saved_geometry so exiting mini mode works
                    if let Some(geo) = &ws.normal_geometry {
                        *app_state.saved_geometry.lock().unwrap() = Some(geo.clone());
                    }

                    // Activate mini mode
                    if let Some(main_window) = app.get_webview_window("main") {
                        let _ = main_window.set_size(LogicalSize::new(340.0, 520.0));
                        let _ = main_window.set_always_on_top(true);
                        let _ = main_window.set_resizable(false);

                        // Restore mini position with bounds check
                        let scale = main_window.current_monitor()
                            .ok().flatten()
                            .map(|m| m.scale_factor())
                            .unwrap_or(1.0);
                        let mini_w = (340.0 * scale) as u32;
                        let mini_h = (520.0 * scale) as u32;

                        let restored_pos = ws.mini_position
                            .filter(|&(x, y)| is_position_on_screen(app.handle(), x, y, mini_w, mini_h));

                        if let Some((x, y)) = restored_pos {
                            let _ = main_window.set_position(PhysicalPosition::new(x, y));
                        } else if let Ok(Some(monitor)) = main_window.current_monitor() {
                            // Default: bottom-right
                            let screen_size = monitor.size();
                            let screen_pos = monitor.position();
                            let margin = (20.0 * scale) as i32;
                            let bottom_margin = (60.0 * scale) as i32;
                            let x = screen_pos.x + (screen_size.width as i32) - mini_w as i32 - margin;
                            let y = screen_pos.y + (screen_size.height as i32) - mini_h as i32 - bottom_margin;
                            let _ = main_window.set_position(PhysicalPosition::new(x, y));
                        }

                        *app_state.is_mini_mode.lock().unwrap() = true;
                        let _ = main_window.emit("mini-mode-changed", true);
                    }
                } else if let Some(geo) = &ws.normal_geometry {
                    // Restore normal window geometry with bounds check
                    if is_position_on_screen(app.handle(), geo.x, geo.y, geo.width, geo.height) {
                        if let Some(main_window) = app.get_webview_window("main") {
                            let _ = main_window.set_size(PhysicalSize::new(geo.width, geo.height));
                            let _ = main_window.set_position(PhysicalPosition::new(geo.x, geo.y));
                        }
                    }
                }
            }

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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle();
                let state = app.state::<AppState>();
                let is_mini = *state.is_mini_mode.lock().unwrap();
                let normal_geo = state.saved_geometry.lock().unwrap().clone();
                let current_pos = window.outer_position().ok().map(|p| (p.x, p.y));

                let window_state = if is_mini {
                    WindowState {
                        is_mini_mode: true,
                        normal_geometry: normal_geo,
                        mini_position: current_pos,
                    }
                } else {
                    // In normal mode, save current geometry as normal_geometry
                    let current_size = window.inner_size().ok();
                    let current_geo = match (current_pos, current_size) {
                        (Some((x, y)), Some(size)) => Some(WindowGeometry {
                            x, y, width: size.width, height: size.height,
                        }),
                        _ => normal_geo,
                    };
                    WindowState {
                        is_mini_mode: false,
                        normal_geometry: current_geo,
                        mini_position: None,
                    }
                };

                save_window_state(app, &window_state);
            }
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
