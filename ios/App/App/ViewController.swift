import UIKit
import Capacitor

class ViewController: CAPBridgeViewController {

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        zeroScrollInsets()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        zeroScrollInsets()
    }

    // WKWebView adds a contentInset.top equal to safeAreaInsets.top which
    // prevents scrollable body content from reaching the Dynamic Island zone.
    // Zeroing it here (after Capacitor's setup) restores the full scroll range.
    private func zeroScrollInsets() {
        guard let scrollView = bridge?.webView?.scrollView else { return }
        scrollView.contentInset = .zero
        scrollView.scrollIndicatorInsets = .zero
        scrollView.contentInsetAdjustmentBehavior = .never
    }
}
