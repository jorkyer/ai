package com.jorkyer.progcalc;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.util.Log;
import android.view.KeyEvent;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;

/**
 * Обёртка над веб-приложением калькулятора (calculator/ в корне репозитория).
 *
 * <p>Содержимое приложения копируется в assets на этапе сборки (задача Gradle
 * {@code copyWebApp}) и открывается как file:///android_asset/index.html.
 *
 * <p>Класс берёт на себя то, чего WebView сам не умеет:
 * <ul>
 *   <li>{@code prompt()} / {@code confirm()} / {@code alert()} — нативные диалоги
 *       (в калькуляторе через prompt выбирается регистр, метка, константа, имя программы);</li>
 *   <li>выбор файла для «ИМПОРТ JSON»;</li>
 *   <li>сохранение «ЭКСПОРТ JSON» в файл (blob-скачивание в WebView не работает).</li>
 * </ul>
 */
public class MainActivity extends Activity {

    private static final String TAG = "ProgCalc";
    private static final String START_URL = "file:///android_asset/index.html";
    private static final int REQUEST_IMPORT_FILE = 1001;

    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF10131A);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage: библиотека программ и настройки
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);            // доступ к file:///android_asset
        s.setAllowContentAccess(true);
        s.setTextZoom(100);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        webView.setBackgroundColor(0xFF10131A);
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        webView.addJavascriptInterface(new AndroidBridge(), "Android");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // внешние ссылки (если появятся) открываем в браузере, а не в калькуляторе
                if (url != null && url.startsWith("http")) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception ignored) {
                        // браузера нет — просто игнорируем
                    }
                    return true;
                }
                return false;
            }
        });
        webView.setWebChromeClient(new UiChromeClient());

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }
    }

    // -----------------------------------------------------------------------
    // Диалоги для prompt/confirm/alert из JavaScript
    // -----------------------------------------------------------------------

    private class UiChromeClient extends WebChromeClient {

        @Override
        public boolean onJsPrompt(WebView view, String url, String message,
                                  String defaultValue, final JsPromptResult result) {
            final EditText input = new EditText(MainActivity.this);
            input.setText(defaultValue == null ? "" : defaultValue);
            input.setInputType(InputType.TYPE_CLASS_TEXT);
            input.setSelectAllOnFocus(true);
            input.setSingleLine(true);

            new AlertDialog.Builder(MainActivity.this)
                    .setTitle(message)
                    .setView(input)
                    .setPositiveButton(android.R.string.ok, (d, w) ->
                            result.confirm(input.getText().toString()))
                    .setNegativeButton(android.R.string.cancel, (d, w) -> result.cancel())
                    .setOnCancelListener(d -> result.cancel())
                    .show();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                    .setTitle(message)
                    .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                    .setNegativeButton(android.R.string.cancel, (d, w) -> result.cancel())
                    .setOnCancelListener(d -> result.cancel())
                    .show();
            return true;
        }

        @Override
        public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                    .setTitle(message)
                    .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                    .setOnCancelListener(d -> result.cancel())
                    .show();
            return true;
        }

        /** «ИМПОРТ JSON»: <input type="file"> внутри WebView. */
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (fileChooserCallback != null) {
                fileChooserCallback.onReceiveValue(null);
            }
            fileChooserCallback = callback;
            Intent intent = params.createIntent();
            intent.setType("*/*");
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            try {
                startActivityForResult(intent, REQUEST_IMPORT_FILE);
            } catch (Exception e) {
                fileChooserCallback = null;
                toast("Не удалось открыть выбор файла");
                return false;
            }
            return true;
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage m) {
            Log.d(TAG, m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
            return true;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_IMPORT_FILE) {
            if (fileChooserCallback == null) {
                return;
            }
            Uri[] result = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                String clip = data.getDataString();
                if (clip != null) {
                    result = new Uri[]{Uri.parse(clip)};
                }
            }
            fileChooserCallback.onReceiveValue(result);
            fileChooserCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    // -----------------------------------------------------------------------
    // Мост JS → Android: сохранение файла программы
    // -----------------------------------------------------------------------

    private class AndroidBridge {

        /**
         * Сохранить текст в файл во внешнем каталоге приложения.
         * Вызывается из JS как Android.saveText('program.json', json).
         *
         * @return полный путь к файлу или сообщение об ошибке
         */
        @JavascriptInterface
        public String saveText(String fileName, String content) {
            try {
                String safe = fileName.replaceAll("[^A-Za-z0-9._-]", "_");
                File dir = getExternalFilesDir(null);
                if (dir == null) {
                    dir = getFilesDir();
                }
                File out = new File(dir, safe);
                try (OutputStreamWriter w = new OutputStreamWriter(
                        new FileOutputStream(out), StandardCharsets.UTF_8)) {
                    w.write(content);
                }
                final String path = out.getAbsolutePath();
                runOnUiThread(() -> toast("Сохранено: " + path));
                return path;
            } catch (Exception e) {
                Log.e(TAG, "saveText failed", e);
                runOnUiThread(() -> toast("Не удалось сохранить: " + e.getMessage()));
                return "";
            }
        }

        /** Версия обёртки — приложение может понять, что оно внутри APK. */
        @JavascriptInterface
        public String version() {
            return "1.0";
        }
    }

    private void toast(final String text) {
        Toast.makeText(this, text, Toast.LENGTH_LONG).show();
    }

    // -----------------------------------------------------------------------
    // Жизненный цикл
    // -----------------------------------------------------------------------

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onPause() {
        webView.onPause();
        super.onPause();
    }

    /** Аппаратная кнопка «Назад»: сначала история WebView, потом выход. */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
