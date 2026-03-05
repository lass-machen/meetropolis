import Foundation
import LiveKit

// MARK: - Connection State

enum ConnectionState: Sendable {
    case disconnected
    case connecting
    case connected
    case reconnecting
}

// MARK: - LiveKit Manager Delegate

protocol LiveKitManagerDelegate: AnyObject {
    func livekitManager(_ manager: LiveKitManager, didChangeConnectionState state: ConnectionState)
    func livekitManager(_ manager: LiveKitManager, participantDidJoin participant: RemoteParticipant)
    func livekitManager(_ manager: LiveKitManager, participantDidLeave participant: RemoteParticipant)
    func livekitManager(_ manager: LiveKitManager, participant: RemoteParticipant, didPublishTrack publication: RemoteTrackPublication)
    func livekitManager(_ manager: LiveKitManager, participant: RemoteParticipant, didUnpublishTrack publication: RemoteTrackPublication)
}

// MARK: - LiveKit Manager

class LiveKitManager: NSObject, @unchecked Sendable {

    // MARK: - Properties

    weak var delegate: LiveKitManagerDelegate?
    private var room: Room?
    private(set) var connectionState: ConnectionState = .disconnected {
        didSet {
            guard oldValue != connectionState else { return }
            delegate?.livekitManager(self, didChangeConnectionState: connectionState)
        }
    }

    // MARK: - Connection

    func connect(url: String, token: String) async throws {
        connectionState = .connecting

        let room = Room(delegate: self)
        self.room = room

        try await room.connect(url: url, token: token)
        connectionState = .connected
    }

    func disconnect() async {
        await room?.disconnect()
        room = nil
        connectionState = .disconnected
    }

    // MARK: - Local Track Controls

    var isMicEnabled: Bool {
        guard let localParticipant = room?.localParticipant else { return false }
        return localParticipant.isMicrophoneEnabled()
    }

    var isCameraEnabled: Bool {
        guard let localParticipant = room?.localParticipant else { return false }
        return localParticipant.isCameraEnabled()
    }

    var isScreenshareEnabled: Bool {
        guard let localParticipant = room?.localParticipant else { return false }
        return localParticipant.isScreenShareEnabled()
    }

    func setMicEnabled(_ enabled: Bool) async throws {
        guard let localParticipant = room?.localParticipant else { return }
        try await localParticipant.setMicrophone(enabled: enabled)
    }

    func setCameraEnabled(_ enabled: Bool) async throws {
        guard let localParticipant = room?.localParticipant else { return }
        try await localParticipant.setCamera(enabled: enabled)
    }

    func setScreenshareEnabled(_ enabled: Bool) async throws {
        guard let localParticipant = room?.localParticipant else { return }
        try await localParticipant.setScreenShare(enabled: enabled)
    }

    // MARK: - Remote Participants

    var remoteParticipants: [RemoteParticipant] {
        guard let room else { return [] }
        return Array(room.remoteParticipants.values)
    }

    func subscribe(to publication: RemoteTrackPublication) async throws {
        try await publication.set(subscribed: true)
    }

    func unsubscribe(from publication: RemoteTrackPublication) async throws {
        try await publication.set(subscribed: false)
    }
}

// MARK: - RoomDelegate

extension LiveKitManager: RoomDelegate {

    func room(_ room: Room, didUpdateConnectionState connectionState: LiveKit.ConnectionState, oldConnectionState: LiveKit.ConnectionState) {
        switch connectionState {
        case .disconnected:
            self.connectionState = .disconnected
        case .connecting:
            self.connectionState = .connecting
        case .reconnecting:
            self.connectionState = .reconnecting
        case .connected:
            self.connectionState = .connected
        case .disconnecting:
            // Treat disconnecting as a transitional state toward disconnected
            break
        @unknown default:
            break
        }
    }

    func room(_ room: Room, participantDidConnect participant: RemoteParticipant) {
        delegate?.livekitManager(self, participantDidJoin: participant)
    }

    func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) {
        delegate?.livekitManager(self, participantDidLeave: participant)
    }

    func room(_ room: Room, participant: RemoteParticipant, didPublishTrack publication: RemoteTrackPublication) {
        delegate?.livekitManager(self, participant: participant, didPublishTrack: publication)
    }

    func room(_ room: Room, participant: RemoteParticipant, didUnpublishTrack publication: RemoteTrackPublication) {
        delegate?.livekitManager(self, participant: participant, didUnpublishTrack: publication)
    }
}
