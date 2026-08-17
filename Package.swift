// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LifeShifter",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "LifeShifter", targets: ["LifeShifter"])],
    targets: [.executableTarget(name: "LifeShifter")]
)
