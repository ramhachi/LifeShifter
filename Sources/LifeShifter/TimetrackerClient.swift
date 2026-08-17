import Foundation
import Security

struct Activity: Codable, Identifiable, Equatable {
    let id: Int
    let name: String
    let icon: String?
    let iconColor: String?
    let parentID: Int?

    enum CodingKeys: String, CodingKey {
        case id, name, icon
        case iconColor = "icon_color"
        case parentID = "parent_id"
    }
}

struct CurrentEntry: Codable, Equatable {
    let id: Int
    let activityID: Int
    let activityName: String
    let activityIcon: String?
    let activityIconColor: String?
    let startTime: String
    let endTime: String?
    let isActive: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case activityID = "activity_id"
        case activityName = "activity_name"
        case activityIcon = "activity_icon"
        case activityIconColor = "activity_icon_color"
        case startTime = "start_time"
        case endTime = "end_time"
        case isActive = "is_active"
    }

    var startedAt: Date? { Self.parseDate(startTime) }

    static func optimistic(activity: Activity, at date: Date) -> CurrentEntry {
        CurrentEntry(
            id: -1,
            activityID: activity.id,
            activityName: activity.name,
            activityIcon: activity.icon,
            activityIconColor: activity.iconColor,
            startTime: ISO8601DateFormatter().string(from: date),
            endTime: nil,
            isActive: true
        )
    }

    private static func parseDate(_ value: String) -> Date? {
        let precise = ISO8601DateFormatter()
        precise.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return precise.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

struct SwitchResponse: Decodable {
    let newEntry: CurrentEntry

    enum CodingKeys: String, CodingKey {
        case newEntry = "new_entry"
    }
}

private struct LoginResponse: Decodable {
    let tokens: Tokens
}

private struct Tokens: Codable {
    let access: String
    let refresh: String
}

private struct RefreshResponse: Decodable {
    let access: String
    let refresh: String?
}

enum TimetrackerError: LocalizedError {
    case signedOut
    case invalidResponse
    case server(Int, String)

    var errorDescription: String? {
        switch self {
        case .signedOut:
            return "ログインが必要です"
        case .invalidResponse:
            return "Timetrackerから不正な応答を受信しました"
        case let .server(status, message):
            return message.isEmpty ? "Timetrackerエラー (HTTP \(status))" : message
        }
    }
}

enum TokenStore {
    private static let service = "com.sota.lifeshifter"
    private static let accessAccount = "access-token"
    private static let refreshAccount = "refresh-token"

    static var hasAccessToken: Bool { read(account: accessAccount) != nil }

    static func accessToken() -> String? { read(account: accessAccount) }
    static func refreshToken() -> String? { read(account: refreshAccount) }

    static func save(access: String, refresh: String) throws {
        try write(access, account: accessAccount)
        try write(refresh, account: refreshAccount)
    }

    static func clear() {
        delete(account: accessAccount)
        delete(account: refreshAccount)
    }

    private static func read(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func write(_ value: String, account: String) throws {
        let lookup: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let data = Data(value.utf8)
        let status = SecItemUpdate(lookup as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = lookup
            item[kSecValueData as String] = data
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else {
                throw TimetrackerError.invalidResponse
            }
        } else if status != errSecSuccess {
            throw TimetrackerError.invalidResponse
        }
    }

    private static func delete(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }
}

actor TimetrackerClient {
    static let baseURL = URL(string: "https://api.timetracker.live/api/")!
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    func login(email: String, password: String) async throws {
        struct LoginBody: Encodable { let email: String; let password: String }
        let response: LoginResponse = try await request(
            "auth/login/",
            method: "POST",
            body: LoginBody(email: email, password: password),
            authenticated: false
        )
        try TokenStore.save(access: response.tokens.access, refresh: response.tokens.refresh)
    }

    func listActivities() async throws -> [Activity] {
        try await request("activities/")
    }

    func current() async throws -> CurrentEntry? {
        try await request("time-tracking/current/", as: CurrentEntry?.self)
    }

    func switchTo(activityID: Int) async throws -> SwitchResponse {
        struct SwitchBody: Encodable { let activityID: Int }
        return try await request(
            "time-tracking/switch/",
            method: "POST",
            body: SwitchBody(activityID: activityID)
        )
    }

    private func request<Response: Decodable>(
        _ endpoint: String,
        as type: Response.Type = Response.self,
        authenticated: Bool = true,
        retryAfterRefresh: Bool = true
    ) async throws -> Response {
        try await request(endpoint, method: "GET", bodyData: nil, as: type, authenticated: authenticated, retryAfterRefresh: retryAfterRefresh)
    }

    private func request<Response: Decodable, Body: Encodable>(
        _ endpoint: String,
        method: String,
        body: Body,
        authenticated: Bool = true
    ) async throws -> Response {
        let bodyData = try encoder.encode(body)
        return try await request(endpoint, method: method, bodyData: bodyData, as: Response.self, authenticated: authenticated, retryAfterRefresh: true)
    }

    private func request<Response: Decodable>(
        _ endpoint: String,
        method: String,
        bodyData: Data?,
        as type: Response.Type,
        authenticated: Bool,
        retryAfterRefresh: Bool
    ) async throws -> Response {
        guard let url = URL(string: endpoint, relativeTo: Self.baseURL) else {
            throw TimetrackerError.invalidResponse
        }
        let token = authenticated ? TokenStore.accessToken() : nil
        if authenticated && token == nil { throw TimetrackerError.signedOut }

        var urlRequest = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 10)
        urlRequest.httpMethod = method
        urlRequest.httpBody = bodyData
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue("macos", forHTTPHeaderField: "X-Client-Type")
        urlRequest.setValue("2.3.1", forHTTPHeaderField: "X-Client-Version")
        if let token { urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }

        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else { throw TimetrackerError.invalidResponse }
        if http.statusCode == 401, authenticated, retryAfterRefresh, try await refreshToken() {
            return try await request(endpoint, method: method, bodyData: bodyData, as: type, authenticated: authenticated, retryAfterRefresh: false)
        }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 { TokenStore.clear() }
            throw TimetrackerError.server(http.statusCode, Self.errorMessage(from: data))
        }
        do {
            return try decoder.decode(type, from: data)
        } catch {
            throw TimetrackerError.invalidResponse
        }
    }

    private func refreshToken() async throws -> Bool {
        guard let refresh = TokenStore.refreshToken() else { return false }
        struct RefreshBody: Encodable { let refresh: String }
        let url = Self.baseURL.appendingPathComponent("token/refresh/")
        var urlRequest = URLRequest(url: url, timeoutInterval: 10)
        urlRequest.httpMethod = "POST"
        urlRequest.httpBody = try encoder.encode(RefreshBody(refresh: refresh))
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let tokens = try? decoder.decode(RefreshResponse.self, from: data) else { return false }
        try TokenStore.save(access: tokens.access, refresh: tokens.refresh ?? refresh)
        return true
    }

    private static func errorMessage(from data: Data) -> String {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "" }
        for key in ["detail", "message", "error", "non_field_errors", "email", "password"] {
            if let value = object[key] as? String { return value }
            if let value = (object[key] as? [String])?.first { return value }
        }
        return ""
    }
}
