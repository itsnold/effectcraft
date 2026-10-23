plugins { id("com.android.application") }

android {
    namespace = "io.github.itsnold.ecdroid"
    compileSdk = 35
    defaultConfig {
        applicationId = "io.github.itsnold.ecdroid"
        minSdk = 29
        targetSdk = 35
        versionCode = 3
        versionName = "0.1.2-alpha"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    androidResources { noCompress += "wasm" }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/assets"))
    sourceSets["main"].res.srcDir(layout.buildDirectory.dir("generated/icon-res"))
}

// Reuse the openly licensed EffectCraft app icon, not the restricted docs/brand marks.
// Generate a resource copy instead of keeping a second binary asset in source control.
val bundleLauncherIcon by tasks.registering(Sync::class) {
    val icon = rootProject.file("../../assets/app-icon/effectcraft-1024.png")
    doFirst { check(icon.isFile) { "Missing licensed EffectCraft launcher artwork: $icon" } }
    into(layout.buildDirectory.dir("generated/icon-res"))
    from(rootProject.file("launcher-res")) { exclude("**/*.attribution") }
    from(icon) { into("drawable-nodpi"); rename { "effectcraft_icon.png" } }
}

// Always package the editor built from THIS checkout, never a remote website or release zip.
val webDist = providers.gradleProperty("webDist").orElse("../../../target/web/dist")
val bundleEditor by tasks.registering(Sync::class) {
    val dist = file(webDist.get())
    doFirst {
        check(dist.resolve("effectcraft_web_bg.wasm").isFile) {
            "Missing web build: run `cargo xtask web` at the repository root first (or -PwebDist=/absolute/dist)."
        }
    }
    into(layout.buildDirectory.dir("generated/assets"))
    from(dist) { into("editor") }
    from(rootProject.file("../../")) {
        include("LICENSE-MIT", "LICENSE-APACHE", "NOTICE", "ATTRIBUTION.md")
        into("editor/licenses")
    }
    from(rootProject.file("../../assets")) {
        include("**/LICENSE*", "**/OFL*", "**/*.attribution")
        into("editor/licenses/assets")
    }
    from(rootProject.file("launcher-res")) {
        include("**/*.attribution")
        into("editor/licenses/android-launcher")
    }
}
tasks.named("preBuild") { dependsOn(bundleEditor, bundleLauncherIcon) }

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
