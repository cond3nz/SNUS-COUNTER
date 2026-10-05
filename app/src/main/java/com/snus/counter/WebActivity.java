package com.snus.counter;

import android.annotation.SuppressLint;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ImageButton;

import androidx.appcompat.app.AppCompatActivity;

/**
 * Встраиваемая веб-версия счётчика (WebView + assets/web).
 * Полностью автономна: index.html / style.css / app.js лежат в assets,
 * данные хранятся в localStorage WebView. Кнопка "Родной экран" возвращает в нативный UI.
 */
public class WebActivity extends AppCompatActivity {

    private static final String START_URL = "file:///android_asset/web/index.html";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_web);

        WebView webView = findViewById(R.id.webView);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // localStorage для хранения записей
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(false);
        s.setBuiltInZoomControls(false);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        webView.loadUrl(START_URL);

        ImageButton btnNative = findViewById(R.id.btnNative);
        btnNative.setOnClickListener(v -> finish());

        View btnHome = findViewById(R.id.btnGoNativeHome);
        btnHome.setOnClickListener(v -> {
            startActivity(new android.content.Intent(this, MainActivity.class)
                    .addFlags(android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP));
            finish();
        });
    }

    /** Кнопка "Назад" — сначала листаем историю WebView, а не закрываем экран */
    @Override
    public void onBackPressed() {
        WebView webView = findViewById(R.id.webView);
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
