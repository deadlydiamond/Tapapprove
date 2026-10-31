/// Shared with the notification extension, which only needs this one type from the app.
enum Decision: String, Codable, Sendable {
    case allow
    case deny
}
