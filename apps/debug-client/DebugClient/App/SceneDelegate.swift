import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate, ServerConfigVCDelegate, LoginVCDelegate {

    var window: UIWindow?

    // MARK: - Services (lazily created after config is set)

    private var apiClient: APIClient?
    private var authService: AuthService?
    private var livekitManager: LiveKitManager?
    private var positionService: PositionService?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let window = UIWindow(windowScene: windowScene)
        self.window = window

        // Check if we have a saved server config
        if let config = ServerConfig.load(), let baseURL = URL(string: config.apiBaseURL) {
            setupServices(baseURL: baseURL)
            showMainUI()

            // Try restoring session
            Task { @MainActor in
                guard let authService else { return }
                let restored = await authService.restoreSession()
                if !restored {
                    presentLogin()
                }
            }
        } else {
            // Show a placeholder root VC and present server config modally
            let placeholderVC = UIViewController()
            placeholderVC.view.backgroundColor = .systemBackground
            window.rootViewController = placeholderVC
            window.makeKeyAndVisible()
            presentServerConfig()
        }
    }

    // MARK: - Service Setup

    private func setupServices(baseURL: URL) {
        let client = APIClient(baseURL: baseURL, tenant: "default")
        apiClient = client
        authService = AuthService(apiClient: client)
        livekitManager = LiveKitManager()
        positionService = PositionService(apiClient: client)
    }

    // MARK: - UI Presentation

    private func showMainUI() {
        guard let apiClient, let authService, let livekitManager, let positionService else { return }

        let tabBarController = MainTabBarController(
            apiClient: apiClient,
            authService: authService,
            livekitManager: livekitManager,
            positionService: positionService
        )

        window?.rootViewController = tabBarController
        window?.makeKeyAndVisible()
    }

    private func presentServerConfig() {
        let serverConfigVC = ServerConfigVC()
        serverConfigVC.delegate = self
        let nav = UINavigationController(rootViewController: serverConfigVC)
        nav.modalPresentationStyle = .fullScreen

        // Present on next run loop to ensure root VC is ready
        DispatchQueue.main.async {
            self.window?.rootViewController?.present(nav, animated: true)
        }
    }

    private func presentLogin() {
        guard let authService else { return }

        let loginVC = LoginVC(authService: authService)
        loginVC.delegate = self
        let nav = UINavigationController(rootViewController: loginVC)
        nav.modalPresentationStyle = .fullScreen

        DispatchQueue.main.async {
            self.window?.rootViewController?.present(nav, animated: true)
        }
    }

    // MARK: - ServerConfigVCDelegate

    func serverConfigVCDidSave(_ vc: ServerConfigVC, config: ServerConfig) {
        guard let baseURL = URL(string: config.apiBaseURL) else { return }

        setupServices(baseURL: baseURL)
        showMainUI()

        vc.dismiss(animated: true) {
            self.presentLogin()
        }
    }

    // MARK: - LoginVCDelegate

    func loginVCDidLogin(_ vc: LoginVC) {
        vc.dismiss(animated: true)
    }

    // MARK: - Scene Lifecycle

    func sceneDidDisconnect(_ scene: UIScene) {
        // Called when the scene is being released by the system.
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        // Called when the scene moves from an inactive state to an active state.
    }

    func sceneWillResignActive(_ scene: UIScene) {
        // Called when the scene moves from an active state to an inactive state.
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        // Called as the scene transitions from the background to the foreground.
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        // Called as the scene transitions from the foreground to the background.
    }
}
