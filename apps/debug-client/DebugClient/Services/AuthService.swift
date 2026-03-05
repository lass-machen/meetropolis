import Foundation
import Security

// MARK: - Auth Service

final class AuthService: Sendable {

    // MARK: - Properties

    private let apiClient: APIClient

    private static let keychainService = "com.meetropolis.debug-client"
    private static let keychainAccount = "auth-token"

    // MARK: - Initialization

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    // MARK: - Login

    /// Authenticates with email and password.
    /// Stores the token in Keychain and sets it on the APIClient.
    func login(email: String, password: String) async throws -> LoginResponse {
        let body = LoginRequest(email: email, password: password)
        let response: LoginResponse = try await apiClient.request(
            "POST",
            path: "/auth/login",
            body: body
        )

        if let token = response.token {
            Self.saveToken(token)
            await apiClient.setAuthToken(token)
        }

        return response
    }

    // MARK: - Fetch Current User

    /// Fetches the currently authenticated user's info.
    func fetchCurrentUser() async throws -> UserInfo {
        return try await apiClient.request("GET", path: "/auth/me")
    }

    // MARK: - Logout

    /// Logs out the user, clears token from Keychain and APIClient.
    func logout() async {
        // Best-effort server-side logout
        struct LogoutResponse: Decodable {
            let ok: Bool?
        }
        _ = try? await apiClient.request("POST", path: "/auth/logout") as LogoutResponse

        Self.deleteToken()
        await apiClient.setAuthToken(nil)
    }

    // MARK: - Session Restore

    /// Attempts to restore a previous session from Keychain.
    /// Returns true if the session is valid, false otherwise.
    func restoreSession() async -> Bool {
        guard let token = Self.loadToken() else { return false }

        await apiClient.setAuthToken(token)

        do {
            _ = try await fetchCurrentUser()
            return true
        } catch {
            // Token is invalid or expired, clean up
            Self.deleteToken()
            await apiClient.setAuthToken(nil)
            return false
        }
    }

    // MARK: - Keychain Helpers

    private static func saveToken(_ token: String) {
        // Delete any existing token first
        deleteToken()

        guard let tokenData = token.data(using: .utf8) else { return }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecValueData as String: tokenData,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            kSecUseDataProtectionKeychain as String: true,
        ]

        let status = SecItemAdd(query as CFDictionary, nil)
        if status != errSecSuccess {
            print("[AuthService] Keychain save failed: \(status)")
        }
    }

    private static func loadToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseDataProtectionKeychain as String: true,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8) else {
            return nil
        }

        return token
    }

    private static func deleteToken() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecUseDataProtectionKeychain as String: true,
        ]

        SecItemDelete(query as CFDictionary)
    }
}
