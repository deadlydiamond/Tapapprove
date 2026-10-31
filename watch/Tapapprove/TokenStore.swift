import Foundation
import Security

/// Keeps the pairing token and keys in the Keychain. They must stay readable after first
/// unlock, because a notification can arrive while the app is in the background, and the
/// notification extension reads the same items.
enum TokenStore {
    private static let tokenAccount = "watchToken"
    private static let keysAccount = "channelKeys"

    private static var service: String {
        Bundle.main.object(forInfoDictionaryKey: "TapapproveAppBundleID") as? String
            ?? Bundle.main.bundleIdentifier
            ?? "tapapprove"
    }

    private static func query(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private static func read(_ account: String) -> Data? {
        var lookup = query(account)
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(lookup as CFDictionary, &item) == errSecSuccess else { return nil }
        return item as? Data
    }

    @discardableResult
    private static func write(_ data: Data, account: String) -> Bool {
        SecItemDelete(query(account) as CFDictionary)
        var attributes = query(account)
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess
    }

    static func load() -> String? {
        read(tokenAccount).flatMap { String(data: $0, encoding: .utf8) }
    }

    static func loadKeys() -> ChannelKeys? {
        read(keysAccount).flatMap { try? JSONDecoder().decode(ChannelKeys.self, from: $0) }
    }

    /// Saves both or neither, since a token without its keys could not open anything.
    @discardableResult
    static func save(token: String, keys: ChannelKeys) -> Bool {
        guard let encoded = try? JSONEncoder().encode(keys),
              write(encoded, account: keysAccount),
              write(Data(token.utf8), account: tokenAccount)
        else {
            delete()
            return false
        }
        return true
    }

    static func delete() {
        SecItemDelete(query(tokenAccount) as CFDictionary)
        SecItemDelete(query(keysAccount) as CFDictionary)
    }
}
