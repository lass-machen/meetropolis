import UIKit

@MainActor
class MainTabBarController: UITabBarController {

    // MARK: - Services

    let apiClient: APIClient
    let authService: AuthService
    let livekitManager: LiveKitManager
    let positionService: PositionService

    // MARK: - Child VCs

    private(set) var dashboardVC: DashboardVC!
    private(set) var positionVC: PositionVC!
    private(set) var participantsVC: ParticipantsVC!

    // MARK: - Initialization

    init(
        apiClient: APIClient,
        authService: AuthService,
        livekitManager: LiveKitManager,
        positionService: PositionService
    ) {
        self.apiClient = apiClient
        self.authService = authService
        self.livekitManager = livekitManager
        self.positionService = positionService
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        setupTabs()
    }

    // MARK: - Setup

    private func setupTabs() {
        dashboardVC = DashboardVC(
            apiClient: apiClient,
            authService: authService,
            livekitManager: livekitManager
        )
        positionVC = PositionVC(
            apiClient: apiClient,
            authService: authService,
            positionService: positionService
        )
        participantsVC = ParticipantsVC(
            livekitManager: livekitManager
        )

        let dashboardNav = UINavigationController(rootViewController: dashboardVC)
        dashboardNav.tabBarItem = UITabBarItem(
            title: "Dashboard",
            image: UIImage(systemName: "antenna.radiowaves.left.and.right"),
            tag: 0
        )

        let positionNav = UINavigationController(rootViewController: positionVC)
        positionNav.tabBarItem = UITabBarItem(
            title: "Position",
            image: UIImage(systemName: "map"),
            tag: 1
        )

        let participantsNav = UINavigationController(rootViewController: participantsVC)
        participantsNav.tabBarItem = UITabBarItem(
            title: "Participants",
            image: UIImage(systemName: "person.3"),
            tag: 2
        )

        viewControllers = [dashboardNav, positionNav, participantsNav]
    }
}
