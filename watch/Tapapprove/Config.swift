import Foundation

enum Config {
    static let privacyPolicyURL = URL(string: "https://github.com/deadlydiamond/Tapapprove/blob/main/PRIVACY.md")!

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
    static let armInterval: TimeInterval = 0.6
    static let armDelay: Duration = .seconds(armInterval)
    /// The UI test waits for the app to go idle before it looks, so it needs longer to see this.
    static let outcomeDuration: Duration = isUITest ? .seconds(4) : .milliseconds(900)
}
