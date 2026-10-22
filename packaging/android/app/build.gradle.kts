plugins { id("com.android.application") }

android {
    namespace = "io.github.itsnold.ecdroid"
    compileSdk = 35
    defaultConfig {
        applicationId = "io.github.itsnold.ecdroid"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-alpha"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    androidResources { noCompress += "wasm" }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/assets"))
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
}
tasks.named("preBuild") { dependsOn(bundleEditor) }

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
