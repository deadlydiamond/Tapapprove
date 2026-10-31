import Foundation

enum Config {
    /// Set at build time by TAPAPPROVE_RELAY_URL, so a build from source never sends one
    /// person's commands to another person's relay by accident. Unset, nothing is reachable.
    static let relayURL: URL = {
        if let value = Bundle.main.object(forInfoDictionaryKey: "TapapproveRelayURL") as? String,
           !value.isEmpty,
           let url = URL(string: value) {
            return url
        }
        return URL(string: "https://relay-not-configured.invalid")!
    }()

    #if DEBUG
    static let apnsEnvironment = "sandbox"
    /// The UI test starts unpaired and cannot answer the system notification prompt.
    static let isUITest = ProcessInfo.processInfo.arguments.contains("-tapapprove-ui-test")
    #else
    static let apnsEnvironment = "production"
    static let isUITest = false
    #endif

    static let pollInterval: Duration = .seconds(2)
    /// A new request ignores taps this long, so a tap aimed at the previous one cannot approve it.
    static let armDelay: Duration = .milliseconds(600)
}
