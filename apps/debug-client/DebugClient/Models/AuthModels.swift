import Foundation

// MARK: - Login Request

struct LoginRequest: Codable, Sendable {
    let email: String
    let password: String
}

// MARK: - Login Response

/// Response from POST /auth/login
/// Fields: id, email, name (optional), token (optional, returned for native clients)
struct LoginResponse: Codable, Sendable {
    let id: String
    let email: String
    let name: String?
    let token: String?
}

// MARK: - User Info

/// Response from GET /auth/me
struct UserInfo: Codable, Sendable {
    let id: String
    let email: String
    let name: String?
    let avatarId: String?
    let isInternalOwner: Bool
    let lastPosition: LastPosition?
}

// MARK: - Last Position

struct LastPosition: Codable, Sendable {
    let x: Double
    let y: Double
    let direction: String
    let mapName: String?
}
