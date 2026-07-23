import Foundation

// MARK: - Map Info

struct MapInfo: Codable, Sendable {
    let id: String
    let name: String
    let tenantId: String
    let width: Int?
    let height: Int?
    let tileWidth: Int?
    let tileHeight: Int?
    let zones: [ZoneInfo]?
}

// MARK: - Zone Info

struct ZoneInfo: Codable, Sendable {
    let id: String
    let name: String
    let type: String?
    let capacity: Int?
}
