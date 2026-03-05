import UIKit
import LiveKit

class VideoPreviewView: UIView {

    // MARK: - Properties

    var videoTrack: VideoTrack? {
        didSet {
            updateVideoView()
        }
    }

    private var videoView: VideoView?

    // MARK: - Initialization

    override init(frame: CGRect) {
        super.init(frame: frame)
        setupUI()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    // MARK: - Setup

    private func setupUI() {
        backgroundColor = .black
        layer.cornerRadius = 8
        clipsToBounds = true
    }

    // MARK: - Video Track Management

    private func updateVideoView() {
        // Remove existing video view
        videoView?.removeFromSuperview()
        videoView = nil

        guard let track = videoTrack else {
            return
        }

        let lkVideoView = VideoView()
        lkVideoView.layoutMode = .fit
        lkVideoView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(lkVideoView)

        NSLayoutConstraint.activate([
            lkVideoView.topAnchor.constraint(equalTo: topAnchor),
            lkVideoView.leadingAnchor.constraint(equalTo: leadingAnchor),
            lkVideoView.trailingAnchor.constraint(equalTo: trailingAnchor),
            lkVideoView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])

        lkVideoView.track = track
        self.videoView = lkVideoView
    }
}
