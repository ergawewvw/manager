package uz.dailydiary.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final int PICK_JSON = 100, SAVE_JSON = 101;
    private static final int MAX_BACKUP_CHARS = 10 * 1024 * 1024;
    private WebView web;
    private LinearLayout errorPanel;
    private ProgressBar progress;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingBackup;

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false);
        WebView.setWebContentsDebuggingEnabled(false);

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(Color.rgb(11,16,32));
        layout.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        TextView heading = new TextView(this);
        heading.setText("Daily Diary"); heading.setTextSize(18); heading.setTextColor(Color.WHITE);
        heading.setPadding(20,12,20,12);
        layout.addView(heading);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        layout.addView(progress, new LinearLayout.LayoutParams(-1, 5));
        errorPanel = new LinearLayout(this); errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setPadding(24,24,24,24); errorPanel.setVisibility(View.GONE);
        TextView error = new TextView(this);
        error.setText("Sahifa yuklanmadi. Internetni tekshirib, qayta urinib ko‘ring."); error.setTextColor(Color.WHITE);
        Button retry = new Button(this); retry.setText("Qayta urinish");
        retry.setOnClickListener(v -> {errorPanel.setVisibility(View.GONE);web.setVisibility(View.VISIBLE);web.loadUrl(NavigationPolicy.HOME);});
        errorPanel.addView(error); errorPanel.addView(retry); layout.addView(errorPanel);
        web = new WebView(this); web.setBackgroundColor(Color.rgb(11,16,32));
        layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(layout);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        // The system picker grants access to one explicitly selected JSON document.
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSupportMultipleWindows(false);
        settings.setSafeBrowsingEnabled(true); settings.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "DailyDiaryExport", Collections.singleton(NavigationPolicy.ORIGIN),
                (view, message, origin, mainFrame, reply) -> {
                    if (!mainFrame || !NavigationPolicy.ORIGIN.equals(origin.toString()) || !NavigationPolicy.trusted(view.getUrl()) || pendingBackup != null) return;
                    try {
                        String raw = message.getData();
                        if (raw == null || raw.length() > MAX_BACKUP_CHARS) throw new IllegalArgumentException();
                        JSONObject request = new JSONObject(raw);
                        String content = request.getString("content");
                        JSONObject backup = new JSONObject(content);
                        if (backup.getInt("version") != 1 || backup.optJSONArray("entries") == null) throw new IllegalArgumentException();
                        String filename = request.getString("filename");
                        if (!filename.matches("daily-diary-[0-9-]+\\.json")) throw new IllegalArgumentException();
                        pendingBackup = content;
                        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                            .setType("application/json").putExtra(Intent.EXTRA_TITLE, filename);
                        startActivityForResult(intent, SAVE_JSON);
                    } catch (Exception exception) {pendingBackup = null; toast("Zaxirani saqlash oynasi ochilmadi yoki fayl juda katta.");}
                });
        }
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (NavigationPolicy.trusted(request.getUrl().toString())) return false;
                // Never move an untrusted document into this WebView or leak auth URLs to another app.
                toast("Bu havolani tashqi brauzer orqali oching.");
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (!NavigationPolicy.trusted(url)) {view.stopLoading(); toast("Ruxsat etilmagan manzil.");}
                progress.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView view, String url) {progress.setVisibility(View.GONE);}
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {web.setVisibility(View.GONE);errorPanel.setVisibility(View.VISIBLE);progress.setVisibility(View.GONE);}
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {progress.setProgress(value);}
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!NavigationPolicy.trusted(view.getUrl()) || fileCallback != null) return false;
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json");
                try {startActivityForResult(intent, PICK_JSON);} catch (ActivityNotFoundException e) {fileCallback.onReceiveValue(null);fileCallback=null;toast("Fayl tanlash ilovasi topilmadi.");}
                return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, type, length) -> toast("Zaxira uchun «Zaxirani saqlash» tugmasidan foydalaning. Android System WebView yangilangan bo‘lsin."));
        web.loadUrl(NavigationPolicy.HOME);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_JSON && fileCallback != null) {
            Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            fileCallback.onReceiveValue(uri != null && "content".equals(uri.getScheme()) ? new Uri[]{uri} : null);
            fileCallback = null;
        }
        if (request == SAVE_JSON) {
            String content = pendingBackup; pendingBackup = null;
            if (result != RESULT_OK || data == null || data.getData() == null || content == null) return;
            Uri destination = data.getData();
            if (!"content".equals(destination.getScheme())) return;
            new Thread(() -> {
                try (OutputStream output = getContentResolver().openOutputStream(destination, "wt")) {
                    if (output == null) throw new java.io.IOException();
                    output.write(content.getBytes(StandardCharsets.UTF_8));
                    runOnUiThread(() -> toast("Zaxira saqlandi. Faylni xavfsiz joyda saqlang."));
                } catch (Exception exception) {runOnUiThread(() -> toast("Zaxira saqlanmadi. Qayta urinib ko‘ring."));}
            }).start();
        }
    }
    private void toast(String text) {Toast.makeText(this,text,Toast.LENGTH_LONG).show();}
    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
    @Override protected void onPause() {web.onPause();CookieManager.getInstance().flush();super.onPause();}
    @Override protected void onResume() {super.onResume();if (web != null) web.onResume();}
    @Override protected void onDestroy() {
        pendingBackup=null;
        if (fileCallback != null) {fileCallback.onReceiveValue(null);fileCallback=null;}
        web.destroy();super.onDestroy();
    }
}
