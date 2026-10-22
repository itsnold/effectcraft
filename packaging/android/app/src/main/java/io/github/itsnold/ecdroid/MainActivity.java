package io.github.itsnold.ecdroid;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Android platform glue only. Editing, media codecs and rendering remain the Rust engine. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String PAGE = "https://" + HOST + "/assets/editor/index.html?android&nosw&frameworkers=1&nogpuworkers";
    private static final int PICK = 1;
    private static final int SAVE = 2;
    private WebView web;
    private ValueCallback<Uri[]> filePicker;
    private ExportStore exports;
    private boolean saving;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        exports = new ExportStore(getCacheDir());
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(27, 28, 31));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        try { web = new WebView(this); }
        catch (RuntimeException e) {
            setContentView(root);
            new AlertDialog.Builder(this).setTitle("Android WebView unavailable")
                .setMessage("Install or update Android System WebView, then reopen ECDroid.\n" + e.getMessage())
                .setPositiveButton("Close", (dialog, which) -> finish()).show();
            return;
        }
        web.setBackgroundColor(Color.rgb(27, 28, 31));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Only URIs explicitly granted by the system picker.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        web.addJavascriptInterface(new ExportBridge(), "ECDroidNative");
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                WebResourceResponse response = local(uri) ? loader.shouldInterceptRequest(uri) : null;
                if (response == null) return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                // wasm MIME is not recognised on every Android release.
                if (uri.getPath() != null && uri.getPath().endsWith(".wasm")) response.setMimeType("application/wasm");
                Map<String, String> headers = new HashMap<>();
                headers.put("Cross-Origin-Opener-Policy", "same-origin");
                headers.put("Cross-Origin-Embedder-Policy", "require-corp");
                headers.put("X-Content-Type-Options", "nosniff");
                response.setResponseHeaders(headers);
                return response;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (local(request.getUrl())) return !request.getUrl().getPath().startsWith("/assets/editor/");
                if (request.isForMainFrame() && request.hasGesture()
                    && ("https".equals(request.getUrl().getScheme()) || "http".equals(request.getUrl().getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); }
                    catch (ActivityNotFoundException e) { message("No browser installed"); }
                }
                return true; // Never let remote content access the native bridge.
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                root.removeView(view);
                view.destroy();
                web = null;
                if (!isFinishing() && !isDestroyed()) {
                    new AlertDialog.Builder(MainActivity.this).setTitle("Editor process stopped")
                        .setMessage("Android stopped the editor (possibly low memory or a GPU error). Reopen to try restoring the last stored session. Unsaved changes since the last snapshot may be lost. Try smaller media or compositions.")
                        .setPositiveButton("Reopen", (dialog, which) -> recreate())
                        .setNegativeButton("Close", (dialog, which) -> finish()).show();
                }
                return true; // Do not crash the entire app when Chromium's renderer dies.
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePicker != null) filePicker.onReceiveValue(null);
                filePicker = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE);
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(intent, PICK); }
                catch (ActivityNotFoundException | SecurityException e) {
                    filePicker.onReceiveValue(null);
                    filePicker = null;
                    message("No system file picker installed");
                }
                return true;
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        web.loadUrl(PAGE);
    }

    private static boolean local(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPort() == -1;
    }

    private void message(String text) { runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show()); }

    public final class ExportBridge {
        @JavascriptInterface public String begin(String name, String mime, long bytes) {
            try { exports.begin(name, mime, bytes); return ""; }
            catch (IOException | RuntimeException e) { return "Cannot start export: " + e.getMessage(); }
        }
        @JavascriptInterface public String chunk(String base64) {
            try {
                if (base64 == null || base64.length() > 262144) return "Export chunk too large";
                exports.append(Base64.decode(base64, Base64.NO_WRAP));
                return "";
            } catch (IOException | RuntimeException e) { return "Cannot write export: " + e.getMessage(); }
        }
        @JavascriptInterface public String finish() {
            try {
                exports.finish();
                runOnUiThread(() -> offerSave());
                return "";
            } catch (IOException | RuntimeException e) { return "Cannot finish export: " + e.getMessage(); }
        }
        @JavascriptInterface public void abort() {
            try { exports.abort(); } catch (IOException e) { message("Export cleanup failed: " + e.getMessage()); }
        }
    }

    private void offerSave() {
        if (saving || isFinishing() || isDestroyed()) return;
        ExportStore.Export pending = exports.peek();
        if (pending == null) return;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(pending.mime()).putExtra(Intent.EXTRA_TITLE, pending.name());
        saving = true;
        try { startActivityForResult(intent, SAVE); }
        catch (ActivityNotFoundException | SecurityException e) {
            saving = false;
            saveFailed("No system file picker installed");
        }
    }

    private void saveFailed(String reason) {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this).setTitle("Export not saved").setMessage(reason + "\nThe export is retained until you close the app.")
            .setPositiveButton("Retry", (dialog, which) -> offerSave())
            .setNegativeButton("Discard export", (dialog, which) -> { exports.discardFirst(); offerSave(); }).show();
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK && filePicker != null) {
            filePicker.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            filePicker = null;
        }
        if (request == SAVE) {
            ExportStore.Export pending = exports.peek();
            Uri uri = data == null ? null : data.getData();
            if (result != RESULT_OK || uri == null || pending == null) {
                saving = false;
                if (pending != null) saveFailed("Saving was cancelled.");
                return;
            }
            io.execute(() -> {
                try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new IOException("The document provider did not open the file");
                    Files.copy(pending.file().toPath(), output);
                    output.flush();
                } catch (IOException | RuntimeException e) {
                    runOnUiThread(() -> { saving = false; saveFailed("Write failed: " + e.getMessage()); });
                    return;
                }
                runOnUiThread(() -> { exports.discardFirst(); saving = false; message("Saved " + pending.name()); offerSave(); });
            });
        }
    }

    @Override public void onBackPressed() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript("window.effectcraft?.request('ui.key',{key:'Escape'}).catch(console.warn)", null);
        new AlertDialog.Builder(this).setTitle("Close ECDroid?")
            .setMessage("Save important work with Save first. Session recovery is best effort, not a backup.")
            .setNegativeButton("Keep editing", null)
            .setPositiveButton("Save session & close", (dialog, which) -> {
                if (web == null) return;
                web.evaluateJavascript("delete window.ECDroidCloseResult;(async()=>{try{await effectcraft.saveToBrowser();await effectcraft.flush();return 'ok'}catch(e){return String(e)}})().then(r=>window.ECDroidCloseResult=r)", null);
                // JS promises cannot be awaited by evaluateJavascript: close only after a separate callback below.
                checkClose(0);
            }).show();
    }

    private void checkClose(int attempts) {
        if (web == null || isFinishing() || isDestroyed()) return;
        web.evaluateJavascript("window.ECDroidCloseResult ?? null", result -> {
            if (web == null || isFinishing() || isDestroyed()) return;
            if ("\"ok\"".equals(result)) { finish(); return; }
            if (!"null".equals(result) || attempts >= 30) {
                message("Session could not be saved. Use Save before closing.");
                web.evaluateJavascript("delete window.ECDroidCloseResult", null);
                return;
            }
            web.postDelayed(() -> checkClose(attempts + 1), 100);
        });
    }

    @Override protected void onPause() {
        if (web != null) web.evaluateJavascript("window.effectcraft?.flush().catch(console.warn)", null);
        super.onPause();
    }

    @Override protected void onDestroy() {
        if (filePicker != null) filePicker.onReceiveValue(null);
        if (web != null) { web.removeJavascriptInterface("ECDroidNative"); web.destroy(); }
        // Queue cleanup after any in-flight file copy, never delete its source during the copy.
        io.execute(() -> { try { exports.close(); } catch (IOException e) { android.util.Log.w("ECDroid", "Export cleanup failed", e); } });
        io.shutdown();
        super.onDestroy();
    }
}
