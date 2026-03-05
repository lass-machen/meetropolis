import Foundation

/// Display model representing a LiveKit participant in the debug UI.
/// This is NOT a LiveKit SDK model -- it is a simplified, UI-friendly representation.
struct ParticipantInfo: Sendable, Hashable {
    let identity: String
    var name: String?
    var isAudioPublishing: Bool
    var isVideoPublishing: Bool
    var isScreensharePublishing: Bool
    var isAudioSubscribed: Bool
    var isVideoSubscribed: Bool
    var audioLevel: Float
}
