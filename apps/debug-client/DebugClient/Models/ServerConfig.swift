import Foundation

struct ServerConfig: Codable, Sendable {

    // MARK: - Properties

    var apiBaseURL: String
    var livekitURL: String?

    // MARK: - UserDefaults Keys

    private static let userDefaultsKey = "com.meetropolis.debug-client.serverConfig"

    // MARK: - Shared Instance

    private static let lock = NSLock()
    nonisolated(unsafe) private static var _shared: ServerConfig?

    static var shared: ServerConfig {
        get {
            lock.lock()
            defer { lock.unlock() }
            if let existing = _shared {
                return existing
            }
            if let loaded = Self.load() {
                _shared = loaded
                return loaded
            }
            let defaultConfig = ServerConfig(apiBaseURL: "http://localhost:2567")
            _shared = defaultConfig
            return defaultConfig
        }
        set {
            lock.lock()
            defer { lock.unlock() }
            _shared = newValue
            newValue.save()
        }
    }

    // MARK: - Persistence

    func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        UserDefaults.standard.set(data, forKey: Self.userDefaultsKey)
    }

    static func load() -> ServerConfig? {
        guard let data = UserDefaults.standard.data(forKey: userDefaultsKey) else { return nil }
        return try? JSONDecoder().decode(ServerConfig.self, from: data)
    }

    static func clear() {
        lock.lock()
        defer { lock.unlock() }
        UserDefaults.standard.removeObject(forKey: userDefaultsKey)
        _shared = nil
    }
}
