import XCTest

/// Drives the real app against the local relay. `scripts/e2e-sim.sh` runs this and plays
/// the computer's side: it reads the pairing code from the handoff folder, then pairs
/// with the real CLI and sends real requests, in the order this test expects them.
@MainActor
final class EndToEndTests: XCTestCase {
    private let handoff = URL(fileURLWithPath: "/tmp/tapapprove-e2e")

    override func setUp() async throws {
        continueAfterFailure = false
    }

    func testPairThenAnswerRequests() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-tapapprove-ui-test"]
        app.launch()

        let code = app.staticTexts["pairCode"]
        XCTAssertTrue(code.waitForExistence(timeout: 60), "No pairing code. Is the relay running?")
        screenshot("1-pairing")

        // A sample request works before pairing, so anyone can try the app without a computer.
        let sampleButton = app.buttons["sampleButton"]
        scrollUntilVisible(sampleButton, app: app, swipes: 5)
        sampleButton.tap()
        let sampleYes = app.buttons["approveButton"]
        XCTAssertTrue(sampleYes.waitForExistence(timeout: 10), "The sample request never appeared")
        waitUntilEnabled(sampleYes)
        screenshot("1b-sample-request")
        sampleYes.tap()
        confirmOutcome(app, screenshot: "1c-sample-approved")
        XCTAssertTrue(code.waitForExistence(timeout: 15), "The sample should return to the pairing code")

        try code.label.write(to: handoff.appending(path: "code"), atomically: true, encoding: .utf8)

        let idle = app.staticTexts["idleTitle"]
        XCTAssertTrue(idle.waitForExistence(timeout: 60), "Pairing never finished")
        screenshot("2-idle")

        // First request: long, so its answers do not exist until the end has been reached.
        let title = app.staticTexts["requestTitle"]
        let approve = app.buttons["approveButton"]
        XCTAssertTrue(title.waitForExistence(timeout: 120), "The first request never reached the watch")
        waitUntilEnabled(app.buttons["quickDenyButton"])
        screenshot("3-long-request-unread")
        XCTAssertFalse(approve.exists, "Yes must not exist until the end of the text is reached")
        scrollUntilVisible(approve, app: app, swipes: 40)
        waitUntilEnabled(approve)
        screenshot("4-long-request-read")
        approve.tap()
        confirmOutcome(app, screenshot: "5-approved")

        // Second request: short, with a session answer in Claude's own words.
        let session = app.buttons["sessionOption0"]
        XCTAssertTrue(session.waitForExistence(timeout: 120), "The session answer never reached the watch")
        waitUntilEnabled(session)
        screenshot("6-short-request")
        scrollUntilVisible(session, app: app, swipes: 5)
        screenshot("7-session-answer")
        session.tap()
        confirmOutcome(app, screenshot: "8-approved-for-session")

        // Third request: short, denied from the list of answers.
        XCTAssertTrue(title.waitForExistence(timeout: 120), "The third request never reached the watch")
        let deny = app.buttons["denyButton"]
        XCTAssertTrue(deny.waitForExistence(timeout: 10))
        waitUntilEnabled(deny)
        scrollUntilVisible(app.buttons["insteadButton"], app: app, swipes: 5)
        screenshot("9-all-answers")
        scrollUntilVisible(deny, app: app, swipes: 5)
        deny.tap()
        confirmOutcome(app, screenshot: "10-denied")

        // Fourth request: thousands of characters, which must arrive whole and be approvable.
        let hint = app.staticTexts["scrollHint"]
        XCTAssertTrue(hint.waitForExistence(timeout: 120), "The very long request never reached the watch")
        XCTAssertFalse(approve.exists, "Yes must not exist until the end of the text is reached")
        scrollUntilVisible(approve, app: app, swipes: 150)
        waitUntilEnabled(approve)
        approve.tap()
        confirmOutcome(app, screenshot: "11-approved-long")

        // Fifth request: close to the limit. The app must stay responsive, and No is one tap away.
        XCTAssertTrue(hint.waitForExistence(timeout: 120), "The request near the limit never reached the watch")
        let quickDeny = app.buttons["quickDenyButton"]
        waitUntilEnabled(quickDeny)
        XCTAssertFalse(approve.exists, "Yes must not exist until the end of the text is reached")
        screenshot("12-near-limit-request")
        quickDeny.tap()
        confirmOutcome(app, screenshot: "13-denied-long")

        XCTAssertTrue(idle.waitForExistence(timeout: 30))
    }

    private func scrollUntilVisible(_ element: XCUIElement, app: XCUIApplication, swipes: Int) {
        var count = 0
        while !(element.exists && element.isHittable) && count < swipes {
            app.swipeUp()
            count += 1
        }
        XCTAssertTrue(element.exists && element.isHittable, "\(element) is not reachable by scrolling")
    }

    private func confirmOutcome(_ app: XCUIApplication, screenshot name: String) {
        XCTAssertTrue(app.staticTexts["outcomeTitle"].waitForExistence(timeout: 10), "No confirmation after answering")
        sleep(1)
        screenshot(name)
    }

    private func waitUntilEnabled(_ element: XCUIElement) {
        let enabled = NSPredicate(format: "isEnabled == true")
        wait(for: [XCTNSPredicateExpectation(predicate: enabled, object: element)], timeout: 10)
    }

    private func screenshot(_ name: String) {
        let data = XCUIScreen.main.screenshot().pngRepresentation
        try? data.write(to: handoff.appending(path: "\(name).png"))
    }
}
