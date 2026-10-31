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

    func testPairThenApproveThenDeny() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-tapapprove-ui-test"]
        app.launch()

        let code = app.staticTexts["pairCode"]
        XCTAssertTrue(code.waitForExistence(timeout: 60), "No pairing code. Is the relay running?")
        screenshot("1-pairing")
        try code.label.write(to: handoff.appending(path: "code"), atomically: true, encoding: .utf8)

        // First request: a long command, which must be read before it can be approved.
        let approve = app.buttons["approveButton"]
        XCTAssertTrue(approve.waitForExistence(timeout: 120), "The first request never reached the watch")
        sleep(2)
        screenshot("2-long-request-unread")
        XCTAssertFalse(approve.isEnabled, "Approve must stay off until the end of the text is reached")

        var swipes = 0
        while !approve.isEnabled && swipes < 40 {
            app.swipeUp()
            swipes += 1
        }
        XCTAssertTrue(approve.isEnabled, "Scrolling to the end should enable Approve")
        screenshot("3-long-request-read")
        approve.tap()

        // Second request: short, so Approve is ready as soon as the safety delay ends.
        let title = app.staticTexts["requestTitle"]
        XCTAssertTrue(title.waitForExistence(timeout: 120), "The second request never reached the watch")
        let deny = app.buttons["denyButton"]
        waitUntilEnabled(deny)
        waitUntilEnabled(app.buttons["approveButton"])
        screenshot("4-short-request")
        deny.tap()

        // Third request: too long to show in full, so it can only be denied here.
        let notice = app.staticTexts["truncatedNotice"]
        let noticeShown = NSPredicate(format: "exists == true")
        wait(for: [XCTNSPredicateExpectation(predicate: noticeShown, object: notice)], timeout: 120)
        waitUntilEnabled(deny)
        screenshot("5-too-long-request")
        XCTAssertFalse(app.buttons["approveButton"].exists, "A request with a hidden tail must not offer Approve")
        deny.tap()

        XCTAssertTrue(app.staticTexts["idleTitle"].waitForExistence(timeout: 30))
        screenshot("6-idle")
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
