//! Presentation-device limits must come from the actual WebGPU/WebGL adapter.

use effectcraft_gpu::wgpu::Limits;

/// Request only what the adapter advertises, with the same texture cap as the desktop shell.
/// In particular, WebView's WebGL2 fallback may offer 4096 rather than eframe's fixed 8192.
/// Keeping all other adapter limits also avoids requiring unavailable storage/compute limits.
fn device_limits(adapter: Limits) -> Limits {
    Limits { max_texture_dimension_2d: adapter.max_texture_dimension_2d.min(16384), ..adapter }
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn web_options() -> eframe::WebOptions {
    use eframe::egui_wgpu::WgpuSetup;

    let mut options = eframe::WebOptions::default();
    if let WgpuSetup::CreateNew(setup) = &mut options.wgpu_options.wgpu_setup {
        setup.device_descriptor = std::sync::Arc::new(|adapter| eframe::wgpu::DeviceDescriptor {
            label: Some("ECDroid browser presentation device"),
            required_limits: device_limits(adapter.limits()),
            ..Default::default()
        });
    }
    options
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webview_with_4096_textures_can_create_the_presentation_device() {
        let adapter = Limits { max_texture_dimension_2d: 4096, ..Limits::downlevel_webgl2_defaults() };
        // The old fixed request produces the reported 8192 > 4096 startup rejection.
        let old_request = Limits { max_texture_dimension_2d: 8192, ..adapter.clone() };
        assert!(!old_request.check_limits(&adapter));
        let required = device_limits(adapter.clone());
        assert_eq!(required.max_texture_dimension_2d, 4096);
        assert!(required.check_limits(&adapter));
    }

    #[test]
    fn requests_fit_downlevel_and_modern_adapters_including_alignment() {
        for adapter in [Limits::downlevel_webgl2_defaults(), Limits::downlevel_defaults(), Limits::default()] {
            let adapter = Limits { min_uniform_buffer_offset_alignment: 512, min_storage_buffer_offset_alignment: 512, ..adapter };
            assert!(device_limits(adapter.clone()).check_limits(&adapter));
        }
        let adapter = Limits { max_texture_dimension_2d: 32768, ..Limits::default() };
        let required = device_limits(adapter.clone());
        assert_eq!(required.max_texture_dimension_2d, 16384);
        assert!(required.check_limits(&adapter));
    }
}
