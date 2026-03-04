fn main() {
  #[cfg(target_os = "macos")]
  println!("cargo:rustc-link-framework=AVFoundation");

  tauri_build::build()
}

