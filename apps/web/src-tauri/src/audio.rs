use crate::AppConfig;

#[cfg(target_os = "macos")]
pub fn set_audio_ducking(enabled: bool) -> Result<(), String> {
    use objc2::runtime::AnyClass;
    use objc2::{msg_send, msg_send_id};
    use objc2::rc::Id;
    use objc2::runtime::AnyObject;
    use std::ptr;

    unsafe {
        let cls = AnyClass::get("AVAudioSession")
            .ok_or("AVAudioSession class not found")?;

        let instance: Id<AnyObject> = msg_send_id![cls, sharedInstance];

        // AVAudioSessionCategoryPlayAndRecord
        let category: Id<AnyObject> =
            msg_send_id![AnyClass::get("NSString").unwrap(), stringWithUTF8String: "AVAudioSessionCategoryPlayAndRecord\0".as_ptr()];

        // Default mode
        let mode: Id<AnyObject> =
            msg_send_id![AnyClass::get("NSString").unwrap(), stringWithUTF8String: "AVAudioSessionModeDefault\0".as_ptr()];

        // AVAudioSessionCategoryOptionDuckOthers = 0x2
        let options: u64 = if enabled { 0x2 } else { 0 };

        let mut error: *mut AnyObject = ptr::null_mut();

        let success: bool = msg_send![
            &*instance,
            setCategory: &*category
            mode: &*mode
            options: options
            error: &mut error
        ];

        if !success {
            return Err("Failed to set audio session category".to_string());
        }

        let active_success: bool = msg_send![
            &*instance,
            setActive: true
            error: &mut error
        ];

        if !active_success {
            return Err("Failed to activate audio session".to_string());
        }
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_audio_ducking(_enabled: bool) -> Result<(), String> {
    Ok(())
}

pub fn apply_audio_ducking_from_config(config: &AppConfig) {
    let enabled = config.audio_ducking.unwrap_or(true);
    if let Err(e) = set_audio_ducking(enabled) {
        eprintln!("Failed to apply audio ducking: {}", e);
    }
}
