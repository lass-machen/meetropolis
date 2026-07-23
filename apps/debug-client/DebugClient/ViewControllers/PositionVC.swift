import UIKit

@MainActor
class PositionVC: UIViewController {

    // MARK: - Services

    private let apiClient: APIClient
    private let authService: AuthService
    private let positionService: PositionService

    // MARK: - UI Elements

    private let scrollView = UIScrollView()
    private let contentStack = UIStackView()

    // Current position
    private let currentXLabel = UILabel()
    private let currentYLabel = UILabel()
    private let currentDirectionLabel = UILabel()
    private let currentMapLabel = UILabel()
    private let refreshButton = UIButton(type: .system)

    // Set position
    private let mapPickerButton = UIButton(type: .system)
    private let xField = UITextField()
    private let xStepper = UIStepper()
    private let yField = UITextField()
    private let yStepper = UIStepper()
    private let directionSegment = UISegmentedControl(items: ["up", "down", "left", "right"])
    private let updateButton = UIButton(type: .system)

    // Map info
    private let mapInfoContainer = UIStackView()
    private let mapSizeLabel = UILabel()
    private let zoneCountLabel = UILabel()
    private let zoneListStack = UIStackView()

    // State
    private var maps: [MapInfo] = []
    private var selectedMap: MapInfo?
    private let activityIndicator = UIActivityIndicatorView(style: .medium)

    // MARK: - Initialization

    init(apiClient: APIClient, authService: AuthService, positionService: PositionService) {
        self.apiClient = apiClient
        self.authService = authService
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
        setupUI()

        Task {
            await loadData()
        }
    }

    // MARK: - UI Setup

    private func setupUI() {
        view.backgroundColor = .systemGroupedBackground
        title = "Position"
        navigationController?.navigationBar.prefersLargeTitles = true

        scrollView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scrollView)

        contentStack.axis = .vertical
        contentStack.spacing = 16
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(contentStack)

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            contentStack.topAnchor.constraint(equalTo: scrollView.topAnchor, constant: 16),
            contentStack.leadingAnchor.constraint(equalTo: scrollView.leadingAnchor, constant: 16),
            contentStack.trailingAnchor.constraint(equalTo: scrollView.trailingAnchor, constant: -16),
            contentStack.bottomAnchor.constraint(equalTo: scrollView.bottomAnchor, constant: -16),
            contentStack.widthAnchor.constraint(equalTo: scrollView.widthAnchor, constant: -32),
        ])

        contentStack.addArrangedSubview(buildCurrentPositionSection())
        contentStack.addArrangedSubview(buildSetPositionSection())
        contentStack.addArrangedSubview(buildMapInfoSection())
    }

    // MARK: - Current Position Section

    private func buildCurrentPositionSection() -> UIView {
        let card = createCard(title: "Current Position")

        configureInfoLabel(currentXLabel, text: "X: --")
        configureInfoLabel(currentYLabel, text: "Y: --")
        configureInfoLabel(currentDirectionLabel, text: "Direction: --")
        configureInfoLabel(currentMapLabel, text: "Map: --")

        var refreshConfig = UIButton.Configuration.tinted()
        refreshConfig.title = "Refresh"
        refreshConfig.image = UIImage(systemName: "arrow.clockwise")
        refreshConfig.imagePadding = 4
        refreshConfig.cornerStyle = .medium
        refreshButton.configuration = refreshConfig
        refreshButton.addTarget(self, action: #selector(refreshTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [
            currentXLabel,
            currentYLabel,
            currentDirectionLabel,
            currentMapLabel,
            refreshButton,
        ])
        stack.axis = .vertical
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false

        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 40),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16),
        ])

        return card
    }

    // MARK: - Set Position Section

    private func buildSetPositionSection() -> UIView {
        let card = createCard(title: "Set Position")

        // Map picker
        let mapLabel = UILabel()
        mapLabel.text = "Map"
        mapLabel.font = .preferredFont(forTextStyle: .caption1)
        mapLabel.textColor = .secondaryLabel

        var mapBtnConfig = UIButton.Configuration.tinted()
        mapBtnConfig.title = "Select Map..."
        mapBtnConfig.cornerStyle = .medium
        mapPickerButton.configuration = mapBtnConfig
        mapPickerButton.showsMenuAsPrimaryAction = true

        // X coordinate
        let xLabel = UILabel()
        xLabel.text = "X"
        xLabel.font = .preferredFont(forTextStyle: .caption1)
        xLabel.textColor = .secondaryLabel

        xField.borderStyle = .roundedRect
        xField.keyboardType = .numberPad
        xField.placeholder = "0"
        xField.text = "0"

        xStepper.minimumValue = 0
        xStepper.maximumValue = 9999
        xStepper.stepValue = 1
        xStepper.addTarget(self, action: #selector(xStepperChanged), for: .valueChanged)

        let xRow = UIStackView(arrangedSubviews: [xField, xStepper])
        xRow.axis = .horizontal
        xRow.spacing = 8
        xRow.alignment = .center
        xField.setContentHuggingPriority(.defaultLow, for: .horizontal)

        // Y coordinate
        let yLabel = UILabel()
        yLabel.text = "Y"
        yLabel.font = .preferredFont(forTextStyle: .caption1)
        yLabel.textColor = .secondaryLabel

        yField.borderStyle = .roundedRect
        yField.keyboardType = .numberPad
        yField.placeholder = "0"
        yField.text = "0"

        yStepper.minimumValue = 0
        yStepper.maximumValue = 9999
        yStepper.stepValue = 1
        yStepper.addTarget(self, action: #selector(yStepperChanged), for: .valueChanged)

        let yRow = UIStackView(arrangedSubviews: [yField, yStepper])
        yRow.axis = .horizontal
        yRow.spacing = 8
        yRow.alignment = .center
        yField.setContentHuggingPriority(.defaultLow, for: .horizontal)

        // Direction
        let dirLabel = UILabel()
        dirLabel.text = "Direction"
        dirLabel.font = .preferredFont(forTextStyle: .caption1)
        dirLabel.textColor = .secondaryLabel

        directionSegment.selectedSegmentIndex = 0

        // Update button
        var updateConfig = UIButton.Configuration.filled()
        updateConfig.title = "Update Position"
        updateConfig.cornerStyle = .medium
        updateButton.configuration = updateConfig
        updateButton.addTarget(self, action: #selector(updatePositionTapped), for: .touchUpInside)

        activityIndicator.hidesWhenStopped = true

        let stack = UIStackView(arrangedSubviews: [
            mapLabel,
            mapPickerButton,
            createSpacer(height: 8),
            xLabel,
            xRow,
            createSpacer(height: 4),
            yLabel,
            yRow,
            createSpacer(height: 8),
            dirLabel,
            directionSegment,
            createSpacer(height: 16),
            updateButton,
            activityIndicator,
        ])
        stack.axis = .vertical
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false

        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 40),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16),
        ])

        return card
    }

    // MARK: - Map Info Section

    private func buildMapInfoSection() -> UIView {
        let card = createCard(title: "Map Info")

        configureInfoLabel(mapSizeLabel, text: "Size: --")
        configureInfoLabel(zoneCountLabel, text: "Zones: --")

        zoneListStack.axis = .vertical
        zoneListStack.spacing = 4

        mapInfoContainer.axis = .vertical
        mapInfoContainer.spacing = 6
        mapInfoContainer.isHidden = true
        mapInfoContainer.addArrangedSubview(mapSizeLabel)
        mapInfoContainer.addArrangedSubview(zoneCountLabel)
        mapInfoContainer.addArrangedSubview(zoneListStack)
        mapInfoContainer.translatesAutoresizingMaskIntoConstraints = false

        card.addSubview(mapInfoContainer)
        NSLayoutConstraint.activate([
            mapInfoContainer.topAnchor.constraint(equalTo: card.topAnchor, constant: 40),
            mapInfoContainer.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            mapInfoContainer.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            mapInfoContainer.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16),
        ])

        return card
    }

    // MARK: - Helpers

    private func createCard(title: String) -> UIView {
        let card = UIView()
        card.backgroundColor = .secondarySystemGroupedBackground
        card.layer.cornerRadius = 12
        card.translatesAutoresizingMaskIntoConstraints = false

        let titleLabel = UILabel()
        titleLabel.text = title
        titleLabel.font = .preferredFont(forTextStyle: .headline)
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(titleLabel)

        NSLayoutConstraint.activate([
            titleLabel.topAnchor.constraint(equalTo: card.topAnchor, constant: 12),
            titleLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            titleLabel.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
        ])

        return card
    }

    private func configureInfoLabel(_ label: UILabel, text: String) {
        label.font = .monospacedSystemFont(ofSize: 14, weight: .regular)
        label.text = text
        label.textColor = .label
    }

    private func createSpacer(height: CGFloat) -> UIView {
        let spacer = UIView()
        spacer.translatesAutoresizingMaskIntoConstraints = false
        spacer.heightAnchor.constraint(equalToConstant: height).isActive = true
        return spacer
    }

    // MARK: - Data Loading

    private func loadData() async {
        await loadMaps()
        await loadCurrentPosition()
    }

    private func loadMaps() async {
        do {
            maps = try await positionService.fetchMaps()
            updateMapPicker()
        } catch {
            showAlert(title: "Error", message: "Failed to load maps: \(error.localizedDescription)")
        }
    }

    private func loadCurrentPosition() async {
        do {
            if let pos = try await positionService.fetchCurrentPosition() {
                currentXLabel.text = "X: \(pos.x)"
                currentYLabel.text = "Y: \(pos.y)"
                currentDirectionLabel.text = "Direction: \(pos.direction)"
                currentMapLabel.text = "Map: \(pos.mapName ?? "--")"

                // Pre-fill the set position form
                xField.text = "\(Int(pos.x))"
                yField.text = "\(Int(pos.y))"
                xStepper.value = pos.x
                yStepper.value = pos.y

                let directions = ["up", "down", "left", "right"]
                if let idx = directions.firstIndex(of: pos.direction) {
                    directionSegment.selectedSegmentIndex = idx
                }
            }
        } catch {
            // Non-critical
        }
    }

    private func updateMapPicker() {
        let actions = maps.map { map in
            UIAction(title: map.name) { [weak self] _ in
                self?.selectMap(map)
            }
        }
        mapPickerButton.menu = UIMenu(title: "Select Map", children: actions)

        if let first = maps.first {
            selectMap(first)
        }
    }

    private func selectMap(_ map: MapInfo) {
        selectedMap = map
        var config = mapPickerButton.configuration
        config?.title = map.name
        mapPickerButton.configuration = config

        // Update map info
        mapInfoContainer.isHidden = false
        let w = map.width ?? 0
        let h = map.height ?? 0
        mapSizeLabel.text = "Size: \(w) x \(h) tiles"

        let zones = map.zones ?? []
        zoneCountLabel.text = "Zones: \(zones.count)"

        // Clear existing zone labels
        zoneListStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for zone in zones {
            let label = UILabel()
            label.font = .preferredFont(forTextStyle: .footnote)
            label.textColor = .secondaryLabel
            label.text = "  - \(zone.name) (\(zone.type ?? "unknown"))"
            zoneListStack.addArrangedSubview(label)
        }
    }

    // MARK: - Actions

    @objc private func refreshTapped() {
        Task {
            refreshButton.isEnabled = false
            await loadCurrentPosition()
            refreshButton.isEnabled = true
        }
    }

    @objc private func xStepperChanged() {
        xField.text = "\(Int(xStepper.value))"
    }

    @objc private func yStepperChanged() {
        yField.text = "\(Int(yStepper.value))"
    }

    @objc private func updatePositionTapped() {
        let x = Double(xField.text ?? "0") ?? 0
        let y = Double(yField.text ?? "0") ?? 0
        let directions = ["up", "down", "left", "right"]
        let direction = directions[directionSegment.selectedSegmentIndex]
        let mapName = selectedMap?.name

        updateButton.isEnabled = false
        activityIndicator.startAnimating()

        Task {
            do {
                try await positionService.updatePosition(
                    x: x,
                    y: y,
                    direction: direction,
                    mapName: mapName
                )
                await loadCurrentPosition()
            } catch {
                showAlert(title: "Error", message: "Failed to update position: \(error.localizedDescription)")
            }

            updateButton.isEnabled = true
            activityIndicator.stopAnimating()
        }
    }

    private func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}
