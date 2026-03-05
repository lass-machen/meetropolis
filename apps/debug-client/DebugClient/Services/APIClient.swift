import Foundation

// MARK: - API Errors

enum APIError: LocalizedError, Sendable {
    case unauthorized
    case serverError(Int, String)
    case networkError(Error)
    case invalidURL

    var errorDescription: String? {
        switch self {
        case .unauthorized:
            return "Authentication required. Please log in again."
        case .serverError(let code, let message):
            return "Server error (\(code)): \(message)"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .invalidURL:
            return "Invalid URL."
        }
    }
}

// MARK: - API Client

actor APIClient {

    // MARK: - Properties

    let baseURL: URL
    var authToken: String?
    var tenant: String

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    // MARK: - Initialization

    init(baseURL: URL, tenant: String = "default") {
        self.baseURL = baseURL
        self.tenant = tenant

        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: configuration)

        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    // MARK: - Token Management

    func setAuthToken(_ token: String?) {
        self.authToken = token
    }

    // MARK: - Generic Request

    func request<T: Decodable>(
        _ method: String,
        path: String,
        body: (any Encodable)? = nil
    ) async throws -> T {
        let data = try await performRequest(method, path: path, body: body)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.networkError(error)
        }
    }

    // MARK: - Text Request

    func requestText(
        _ method: String,
        path: String,
        body: (any Encodable)? = nil
    ) async throws -> String {
        let data = try await performRequest(method, path: path, body: body)
        guard let text = String(data: data, encoding: .utf8) else {
            throw APIError.serverError(0, "Unable to decode response as text")
        }
        return text
    }

    // MARK: - Server Validation

    func validateServer() async throws -> Bool {
        struct HealthResponse: Decodable {
            let ok: Bool
        }
        let response: HealthResponse = try await request("GET", path: "/health")
        return response.ok
    }

    // MARK: - Private Helpers

    private func performRequest(
        _ method: String,
        path: String,
        body: (any Encodable)? = nil
    ) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIError.invalidURL
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method

        // Headers
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        urlRequest.setValue(tenant, forHTTPHeaderField: "x-tenant")

        if let token = authToken {
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
            urlRequest.httpBody = try encoder.encode(AnyEncodable(body))
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: urlRequest)
        } catch {
            throw APIError.networkError(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.networkError(
                NSError(domain: "APIClient", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
            )
        }

        switch httpResponse.statusCode {
        case 200...299:
            return data
        case 401:
            throw APIError.unauthorized
        default:
            let message = extractErrorMessage(from: data) ?? "Unknown error"
            throw APIError.serverError(httpResponse.statusCode, message)
        }
    }

    private func extractErrorMessage(from data: Data) -> String? {
        struct ErrorBody: Decodable {
            let error: String?
            let message: String?
        }
        guard let body = try? decoder.decode(ErrorBody.self, from: data) else {
            return String(data: data, encoding: .utf8)
        }
        return body.error ?? body.message
    }
}

// MARK: - AnyEncodable Wrapper

/// Type-erased Encodable wrapper to support encoding arbitrary Encodable values.
private struct AnyEncodable: Encodable {
    private let encodeClosure: (Encoder) throws -> Void

    init(_ value: any Encodable) {
        self.encodeClosure = { encoder in
            try value.encode(to: encoder)
        }
    }

    func encode(to encoder: Encoder) throws {
        try encodeClosure(encoder)
    }
}
