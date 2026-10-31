import SwiftUI
import WidgetKit

/// A small watch-face icon that opens the app. It shows no live data on purpose: the system
/// rations widget refreshes, so a pending count would often be stale, and a stale count on
/// an approval app is worse than none.
struct LauncherEntry: TimelineEntry {
    let date = Date.now
}

struct LauncherProvider: TimelineProvider {
    func placeholder(in context: Context) -> LauncherEntry {
        LauncherEntry()
    }

    func getSnapshot(in context: Context, completion: @escaping (LauncherEntry) -> Void) {
        completion(LauncherEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<LauncherEntry>) -> Void) {
        completion(Timeline(entries: [LauncherEntry()], policy: .never))
    }
}

struct LauncherView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryInline:
            Text("Tapapprove")
        case .accessoryCorner:
            mark
                .widgetLabel("Tapapprove")
        default:
            ZStack {
                AccessoryWidgetBackground()
                mark
            }
        }
    }

    private var mark: some View {
        BrandMark()
            .fill(Color.accentColor)
            .widgetAccentable()
            .accessibilityLabel("Tapapprove")
    }
}

@main
struct TapapproveWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TapapproveLauncher", provider: LauncherProvider()) { _ in
            LauncherView()
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("Tapapprove")
        .description("Open Tapapprove from your watch face.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryInline])
    }
}
