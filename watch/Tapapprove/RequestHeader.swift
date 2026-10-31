import SwiftUI

struct RequestHeader: View {
    let request: PendingRequest
    let queued: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label {
                Text(request.title)
                    .font(.headline)
                    .accessibilityIdentifier("requestTitle")
                    .accessibilityAddTraits(.isHeader)
            } icon: {
                Image(systemName: request.symbolName)
                    .foregroundStyle(.tint)
            }
            HStack(spacing: 4) {
                if let project = request.project {
                    Text(project)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                if queued > 0 {
                    Text("+\(queued)")
                        .bold()
                        .accessibilityLabel("\(queued) more waiting")
                }
                Text(timerInterval: Date.now...max(request.expiresAt, Date.now), countsDown: true)
                    .monospacedDigit()
                    .fixedSize()
                    .accessibilityLabel("Time left")
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
    }
}
