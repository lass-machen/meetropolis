import Foundation

// MARK: - Position Update Request

private struct PositionUpdateRequest: Codable, Sendable {
    let x: Double
    let y: Double
    let direction: String
    let mapName: String?
}

// MARK: - Position Service

final class PositionService: Sendable {

    // MARK: - Properties

    private let apiClient: APIClient

    // MARK: - Initialization

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    // MARK: - Fetch Maps

    /// Fetches all maps for the current tenant.
    func fetchMaps() async throws -> [MapInfo] {
        return try await apiClient.request("GET", path: "/maps")
    }

    // MARK: - Update Position

    /// Updates the authenticated user's position.
    func updatePosition(
        x: Double,
        y: Double,
        direction: String,
        mapName: String? = nil
    ) async throws {
        struct PositionResponse: Decodable {
            let ok: Bool
        }
        let body = PositionUpdateRequest(x: x, y: y, direction: direction, mapName: mapName)
        let _: PositionResponse = try await apiClient.request(
            "POST",
            path: "/auth/position",
            body: body
        )
    }

    // MARK: - Fetch Current Position

    /// Fetches the current user's last known position from /auth/me.
    func fetchCurrentPosition() async throws -> LastPosition? {
        let userInfo: UserInfo = try await apiClient.request("GET", path: "/auth/me")
        return userInfo.lastPosition
    }
}
