package com.zsystems.poslite;

import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.ConsoleMessage;
import android.widget.ProgressBar;
import android.widget.FrameLayout;
import android.graphics.Color;
import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.webkit.PermissionRequest;
import android.view.MotionEvent;
import android.view.inputmethod.InputMethodManager;
import org.json.JSONObject;
import org.json.JSONException;

public class MainActivity extends Activity {
    private BroadcastReceiver scannerReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null) return;
            String code = intent.getStringExtra("data");
            if (code == null) {
                Bundle bundle = intent.getExtras();
                if (bundle != null) {
                    code = bundle.getString("data");
                }
            }
            if (code != null && !code.trim().isEmpty()) {
                final String safeCode = code.trim().replace("\\", "\\\\").replace("'", "\\'");
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (webView != null) {
                            String js = "if (typeof window.onHardwareBarcodeScanned === 'function') { window.onHardwareBarcodeScanned('" + safeCode + "'); }" +
                                        "else if (typeof window.onBarcodeScanned === 'function') { window.onBarcodeScanned('" + safeCode + "'); }" +
                                        "else { window.dispatchEvent(new CustomEvent('hardware-barcode-scan', { detail: { barcode: '" + safeCode + "' } })); }";
                            if (Build.VERSION.SDK_INT >= 19) {
                                webView.evaluateJavascript(js, null);
                            } else {
                                webView.loadUrl("javascript:" + js);
                            }
                        }
                    }
                });
            }
        }
    };

    private WebView webView;
    private ProgressBar progressBar;
    private static final String APP_URL = "https://app.zsystemai.com/pos?standalone=pos&kiosk=1";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= 19) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        // Start Dedicated Lightweight Background Print Server (Port 8080 & 9100 for PC PDF Printing)
        try {
            Intent serviceIntent = new Intent(this, PrintServerService.class);
            if (Build.VERSION.SDK_INT >= 26) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (Exception ignored) {}

        requestWindowFeature(Window.FEATURE_NO_TITLE);

        // 1. Force Hardware Acceleration on Window level for smooth 60fps
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        );

        if (Build.VERSION.SDK_INT >= 21) {
            Window window = getWindow();
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.parseColor("#170e5e"));
        }

        FrameLayout layout = new FrameLayout(this);
        layout.setBackgroundColor(Color.parseColor("#f8fafc"));

        webView = new WebView(this);

        // 2. Disable overscroll bounce and hardware-costly scrollbars for low-spec CPU/GPU
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);

        layout.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, 
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgress(0);
        FrameLayout.LayoutParams pbParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, 
            8
        );
        layout.addView(progressBar, pbParams);

        setContentView(layout);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        // 3. Zero double-tap delay (instant tap response)
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        // 4. Pre-rasterize offscreen tiles for stutter-free scrolling (Android 6.0+)
        if (Build.VERSION.SDK_INT >= 23) {
            settings.setOffscreenPreRaster(true);
        }

        // 5. Intelligent caching & DOM storage
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // 6. Allow mixed content for local silent printing on port 9100 / 8080
        if (Build.VERSION.SDK_INT >= 21) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        // Initialize Sunmi hardware service
        SunmiPrinterHelper.init(this);

        try {
            IntentFilter filter = new IntentFilter();
            filter.addAction("com.sunmi.scanner.ACTION_DATA_CODE_RECEIVED");
            registerReceiver(scannerReceiver, filter);
        } catch (Exception ignored) {}

        // 7. Inject JavascriptInterface for Direct Sunmi Thermal Hardware Printing
        Object bridge = new Object() {
            @android.webkit.JavascriptInterface
            public boolean isSunmiPrinter() {
                return true;
            }

            @android.webkit.JavascriptInterface
            public boolean isPosLite() {
                return true;
            }

            @android.webkit.JavascriptInterface
            public void printReceipt(String printData) {
                SunmiPrinterHelper.printRawText(printData);
            }

            @android.webkit.JavascriptInterface
            public void scan() {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            Intent intent = new Intent("com.sunmi.scan");
                            intent.setPackage("com.sunmi.sunmiqrcodescanner");
                            startActivityForResult(intent, 1001);
                        } catch (Exception e) {
                            try {
                                Intent intent2 = new Intent("com.google.zxing.client.android.SCAN");
                                startActivityForResult(intent2, 1001);
                            } catch (Exception ignored) {}
                        }
                    }
                });
            }

            public void printHtmlInvoice(String html) {
                SunmiPrinterHelper.printHtmlInvoice(html);
            }

            @android.webkit.JavascriptInterface
            public void hideKeyboard() {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                            if (imm != null && webView != null) {
                                imm.hideSoftInputFromWindow(webView.getWindowToken(), 0);
                            }
                        } catch (Exception ignored) {}
                    }
                });
            }

            @android.webkit.JavascriptInterface
            public void showKeyboard() {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                            if (imm != null && webView != null) {
                                imm.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT);
                            }
                        } catch (Exception ignored) {}
                    }
                });
            }

            @android.webkit.JavascriptInterface
            public void requestPayment(final String jsonPayload) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            JSONObject obj = new JSONObject(jsonPayload != null ? jsonPayload : "{}");
                            double amount = obj.optDouble("amount", 0.0);
                            String currency = obj.optString("currency", "KWD");
                            String referenceId = obj.optString("referenceId", "POS-" + System.currentTimeMillis());
                            String packageName = obj.optString("packageName", "");
                            String intentAction = obj.optString("intentAction", "");

                            Intent intent = null;
                            if (!intentAction.isEmpty()) {
                                intent = new Intent(intentAction);
                            } else if (!packageName.isEmpty()) {
                                intent = getPackageManager().getLaunchIntentForPackage(packageName);
                            }

                            if (intent != null && !packageName.isEmpty()) {
                                intent.setPackage(packageName);
                            }

                            if (intent != null) {
                                intent.putExtra("amount", amount);
                                intent.putExtra("currency", currency);
                                intent.putExtra("referenceId", referenceId);
                                intent.putExtra("transactionId", referenceId);
                                intent.putExtra("trans_amount", (long)(amount * 1000));
                            }

                            if (intent != null && intent.resolveActivity(getPackageManager()) != null) {
                                startActivityForResult(intent, 2001);
                            } else {
                                JSONObject res = new JSONObject();
                                res.put("success", false);
                                res.put("status", "manual");
                                res.put("referenceId", referenceId);
                                res.put("message", "لا يوجد تطبيق بنكي مثبت على الماكينة، يرجى اعتماد الإيصال يدوياً");
                                sendPaymentResultToWeb(res.toString());
                            }
                        } catch (Exception e) {
                            try {
                                JSONObject res = new JSONObject();
                                res.put("success", false);
                                res.put("status", "error");
                                res.put("message", "خطأ في استدعاء الدفع: " + e.getMessage());
                                sendPaymentResultToWeb(res.toString());
                            } catch (Exception ignored) {}
                        }
                    }
                });
            }

            @android.webkit.JavascriptInterface
            public void cancelPayment(String targetRef) {
                // Cancellation placeholder
            }
        };

        webView.addJavascriptInterface(bridge, "SunmiPrinter");
        webView.addJavascriptInterface(bridge, "AndroidBridge");
        webView.addJavascriptInterface(bridge, "SmartPos");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null || url.startsWith("about:blank") || url.startsWith("javascript:")) {
                    return true;
                }
                if (url.contains("/login") || url.contains("/auth") || url.contains("/pos") || url.contains("/cash-drawer") || url.contains("/api/")) {
                    return false;
                }
                if (url.startsWith("https://app.zsystemai.com")) {
                    view.loadUrl(APP_URL);
                    return true;
                }
                view.loadUrl(url);
                return true;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request == null || request.getUrl() == null) return false;
                String url = request.getUrl().toString();
                if (url.startsWith("about:blank") || url.startsWith("javascript:")) {
                    return true;
                }
                if (url.contains("/login") || url.contains("/auth") || url.contains("/pos") || url.contains("/cash-drawer") || url.contains("/api/")) {
                    return false;
                }
                if (url.startsWith("https://app.zsystemai.com")) {
                    view.loadUrl(APP_URL);
                    return true;
                }
                view.loadUrl(url);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
                injectSunmiHook(view);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress < 100) {
                    progressBar.setVisibility(View.VISIBLE);
                    progressBar.setProgress(newProgress);
                } else {
                    progressBar.setVisibility(View.GONE);
                }
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                if (request != null && Build.VERSION.SDK_INT >= 21) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                request.grant(request.getResources());
                            } catch (Exception ignored) {}
                        }
                    });
                }
            }

            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                android.util.Log.d("WebConsole", consoleMessage.message() + " -- Line " + consoleMessage.lineNumber());
                return true;
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                return false;
            }
        });

        webView.loadUrl(APP_URL);
        checkTestPrint(getIntent());
        checkEvalJs(getIntent());
    }

    private void injectSunmiHook(WebView view) {
        if (view == null) return;
        String js = "(function() {" +
            "try { localStorage.setItem('zsystems.pos.standalone', 'true'); } catch(e) {}" +
            "var css = '.mobile-bottom-nav, .app-header, .mobile-sidebar-toggle, .sidebar-mobile-overlay, .sidebar-fixed, aside.sidebar-fixed { display: none !important; } ' +" +
            "'.app-layout, .main-col, .content-wrap, .content-wrap-pos, .content-wrap-pos-focus, main.page-stack, .page-stack-pos, [dir=\\\"rtl\\\"] .content-wrap, [dir=\\\"ltr\\\"] .content-wrap, [dir=\\\"rtl\\\"] .content-wrap:has(.pos-workspace), [dir=\\\"ltr\\\"] .content-wrap:has(.pos-workspace), html[dir=\\\"rtl\\\"] .content-wrap, html[dir=\\\"ltr\\\"] .content-wrap { padding-left: 0 !important; padding-right: 0 !important; padding-inline: 0 !important; padding-top: 0 !important; margin-left: 0 !important; margin-right: 0 !important; margin-inline: 0 !important; width: 100% !important; max-width: 100% !important; box-sizing: border-box !important; } ' +" +
            "'.pos-workspace { padding: 4px 6px !important; width: 100% !important; max-width: 100% !important; margin: 0 !important; box-sizing: border-box !important; } ' +" +
            "'.pos-workspace .pos-page-header { padding: 6px 8px !important; margin-bottom: 6px !important; border-radius: 10px !important; } ' +" +
            "'.pos-workspace .pos-mobile-tab-switcher { margin-bottom: 6px !important; } ' +" +
            "'.pos-workspace .pos-products-card { padding: 6px 6px !important; margin: 0 !important; border-radius: 10px !important; width: 100% !important; box-sizing: border-box !important; } ' +" +
            "'.pos-workspace .pos-products-static, .pos-workspace .pos-products-viewport-wrapper, .pos-workspace .pos-products-scroll { width: 100% !important; box-sizing: border-box !important; } ' +" +
            "'.pos-product-group-grid, .product-pick-grid { gap: 6px !important; width: 100% !important; box-sizing: border-box !important; }';" +
            "function applyPosStyles() {" +
            "  var s = document.getElementById('__pos_lite_clean');" +
            "  if (!s) {" +
            "    s = document.createElement('style');" +
            "    s.id = '__pos_lite_clean';" +
            "    (document.head || document.documentElement).appendChild(s);" +
            "  }" +
            "  if (s.textContent !== css) s.textContent = css;" +
            "}" +
            "applyPosStyles();" +
            "if (!window.__pos_style_interval) {" +
            "  window.__pos_style_interval = setInterval(applyPosStyles, 500);" +
            "}" +
            "if (window.__sunmi_hooked) return;" +
            "window.__sunmi_hooked = true;" +
            "var origOpen = window.open;" +
            "window.open = function(u, t, f) {" +
            "  var buf = '';" +
            "  return {" +
            "    document: {" +
            "      open: function() {}," +
            "      write: function(s) { if(s) buf += s; }," +
            "      close: function() { if(buf && window.SunmiPrinter) window.SunmiPrinter.printHtmlInvoice(buf); }" +
            "    }," +
            "    focus: function() {}," +
            "    print: function() { if(buf && window.SunmiPrinter) window.SunmiPrinter.printHtmlInvoice(buf); }," +
            "    close: function() {}" +
            "  };" +
            "};" +
            "var origFetch = window.fetch ? window.fetch.bind(window) : null;" +
            "if (origFetch) {" +
            "  window.fetch = function(url, opts) {" +
            "    try {" +
            "      var u = (typeof url === 'string') ? url : (url && url.url) ? url.url : '';" +
            "      if (u && (u.indexOf('9100') !== -1 || u.indexOf('8080/print') !== -1)) {" +
            "        if (opts && opts.body && window.SunmiPrinter) {" +
            "          try {" +
            "            var b = JSON.parse(opts.body);" +
            "            if (b && b.printData) {" +
            "              window.SunmiPrinter.printReceipt(b.printData);" +
            "              return Promise.resolve(new Response(JSON.stringify({success:true}), {status:200, headers:{'Content-Type':'application/json'}}));" +
            "            }" +
            "          } catch(e) {}" +
            "        }" +
            "        return Promise.resolve(new Response(JSON.stringify({success:true}), {status:200, headers:{'Content-Type':'application/json'}}));" +
            "      }" +
            "    } catch(e) {}" +
            "    return origFetch.apply(window, arguments);" +
            "  };" +
            "}" +
            "document.addEventListener('focusin', function(e) {" +
            "  var el = e.target;" +
            "  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {" +
            "    if (!el.dataset.kbUnlocked) {" +
            "      el.setAttribute('inputmode', 'none');" +
            "    }" +
            "  }" +
            "}, true);" +
            "document.addEventListener('dblclick', function(e) {" +
            "  var el = e.target;" +
            "  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {" +
            "    el.dataset.kbUnlocked = 'true';" +
            "    el.setAttribute('inputmode', 'text');" +
            "    el.focus();" +
            "    if (window.SunmiPrinter && window.SunmiPrinter.showKeyboard) window.SunmiPrinter.showKeyboard();" +
            "  }" +
            "}, true);" +
            "var __lastTap = 0, __lastEl = null;" +
            "document.addEventListener('touchend', function(e) {" +
            "  var el = e.target;" +
            "  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {" +
            "    var now = Date.now();" +
            "    if (__lastEl === el && (now - __lastTap) < 350 && (now - __lastTap) > 50) {" +
            "      el.dataset.kbUnlocked = 'true';" +
            "      el.setAttribute('inputmode', 'text');" +
            "      el.focus();" +
            "      if (window.SunmiPrinter && window.SunmiPrinter.showKeyboard) window.SunmiPrinter.showKeyboard();" +
            "      __lastTap = 0; __lastEl = null;" +
            "      return;" +
            "    }" +
            "    __lastTap = now; __lastEl = el;" +
            "  } else {" +
            "    __lastTap = 0; __lastEl = null;" +
            "  }" +
            "}, true);" +
            "document.addEventListener('focusout', function(e) {" +
            "  var el = e.target;" +
            "  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {" +
            "    delete el.dataset.kbUnlocked;" +
            "    el.setAttribute('inputmode', 'none');" +
            "    if (window.SunmiPrinter && window.SunmiPrinter.hideKeyboard) window.SunmiPrinter.hideKeyboard();" +
            "  }" +
            "}, true);" +
            "document.addEventListener('click', function(e) {" +
            "  var el = e.target;" +
            "  var isInput = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');" +
            "  if (!isInput) {" +
            "    var active = document.activeElement;" +
            "    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {" +
            "      delete active.dataset.kbUnlocked;" +
            "      active.setAttribute('inputmode', 'none');" +
            "      active.blur();" +
            "      if (window.SunmiPrinter && window.SunmiPrinter.hideKeyboard) window.SunmiPrinter.hideKeyboard();" +
            "    }" +
            "  }" +
            "}, true);" +
            "document.addEventListener('keydown', function(e) {" +
            "  if (e.key === 'Enter') {" +
            "    var active = document.activeElement;" +
            "    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {" +
            "      delete active.dataset.kbUnlocked;" +
            "      active.setAttribute('inputmode', 'none');" +
            "      active.blur();" +
            "      if (window.SunmiPrinter && window.SunmiPrinter.hideKeyboard) window.SunmiPrinter.hideKeyboard();" +
            "    }" +
            "  }" +
            "}, true);" +
            "})();";
        if (Build.VERSION.SDK_INT >= 19) {
            view.evaluateJavascript(js, null);
        } else {
            view.loadUrl("javascript:" + js);
        }
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        checkTestPrint(intent);
        checkEvalJs(intent);
    }

    private void checkTestPrint(android.content.Intent intent) {
        if (intent != null && intent.hasExtra("test_print")) {
            String test = intent.getStringExtra("test_print");
            SunmiPrinterHelper.printRawText(test != null ? test : "اختبار طباعة زد سيستمز");
        }
    }

    private void checkEvalJs(android.content.Intent intent) {
        if (intent == null) return;
        if (intent.hasExtra("eval_b64")) {
            try {
                String b64 = intent.getStringExtra("eval_b64");
                if (b64 != null) {
                    byte[] data = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                    String script = new String(data, "UTF-8");
                    if (webView != null) {
                        if (Build.VERSION.SDK_INT >= 19) {
                            webView.evaluateJavascript(script, null);
                        } else {
                            webView.loadUrl("javascript:" + script);
                        }
                    }
                }
            } catch (Exception e) {
                android.util.Log.e("WebConsole", "eval_b64 error", e);
            }
        } else if (intent.hasExtra("eval_js")) {
            String script = intent.getStringExtra("eval_js");
            if (webView != null && script != null) {
                if (Build.VERSION.SDK_INT >= 19) {
                    webView.evaluateJavascript(script, null);
                } else {
                    webView.loadUrl("javascript:" + script);
                }
            }
        }
    }

    private void sendPaymentResultToWeb(final String json) {
        if (webView != null) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    final String safeJson = json.replace("\\", "\\\\").replace("'", "\\'");
                    String js = "if (typeof window.__onPosPaymentResult === 'function') { window.__onPosPaymentResult(JSON.parse('" + safeJson + "')); }";
                    if (Build.VERSION.SDK_INT >= 19) {
                        webView.evaluateJavascript(js, null);
                    } else {
                        webView.loadUrl("javascript:" + js);
                    }
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 1001 && resultCode == RESULT_OK && data != null) {
            Bundle bundle = data.getExtras();
            if (bundle != null) {
                String result = bundle.getString("result");
                if (result != null && !result.trim().isEmpty()) {
                    final String safeResult = result.trim().replace("\\", "\\\\").replace("'", "\\'");
                    if (webView != null) {
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                String js = "if (typeof window.onHardwareBarcodeScanned === 'function') { window.onHardwareBarcodeScanned('" + safeResult + "'); }";
                                if (Build.VERSION.SDK_INT >= 19) {
                                    webView.evaluateJavascript(js, null);
                                } else {
                                    webView.loadUrl("javascript:" + js);
                                }
                            }
                        });
                    }
                }
            }
        } else if (requestCode == 2001) {
            if (resultCode == RESULT_OK && data != null) {
                Bundle extras = data.getExtras();
                String authCode = "APPROVED";
                String rrn = "";
                String cardScheme = "K-NET";
                String last4 = "";
                if (extras != null) {
                    if (extras.containsKey("authCode")) authCode = String.valueOf(extras.get("authCode"));
                    else if (extras.containsKey("approvalCode")) authCode = String.valueOf(extras.get("approvalCode"));
                    else if (extras.containsKey("AuthCode")) authCode = String.valueOf(extras.get("AuthCode"));

                    if (extras.containsKey("rrn")) rrn = String.valueOf(extras.get("rrn"));
                    else if (extras.containsKey("RRN")) rrn = String.valueOf(extras.get("RRN"));
                    else if (extras.containsKey("referenceNumber")) rrn = String.valueOf(extras.get("referenceNumber"));

                    if (extras.containsKey("cardScheme")) cardScheme = String.valueOf(extras.get("cardScheme"));
                    else if (extras.containsKey("scheme")) cardScheme = String.valueOf(extras.get("scheme"));

                    if (extras.containsKey("last4")) last4 = String.valueOf(extras.get("last4"));
                    else if (extras.containsKey("cardLastFour")) last4 = String.valueOf(extras.get("cardLastFour"));
                }
                try {
                    JSONObject res = new JSONObject();
                    res.put("success", true);
                    res.put("status", "approved");
                    res.put("authCode", authCode);
                    res.put("rrn", rrn);
                    res.put("cardScheme", cardScheme);
                    res.put("cardLastFour", last4);
                    res.put("message", "تم الدفع بنجاح");
                    sendPaymentResultToWeb(res.toString());
                } catch (Exception ignored) {}
            } else if (resultCode == RESULT_CANCELED) {
                try {
                    JSONObject res = new JSONObject();
                    res.put("success", false);
                    res.put("status", "cancelled");
                    res.put("message", "تم إلغاء عملية الدفع");
                    sendPaymentResultToWeb(res.toString());
                } catch (Exception ignored) {}
            } else {
                try {
                    JSONObject res = new JSONObject();
                    res.put("success", false);
                    res.put("status", "declined");
                    res.put("message", "تم رفض العملية من البنك");
                    sendPaymentResultToWeb(res.toString());
                } catch (Exception ignored) {}
            }
        }
    }

    @Override
    protected void onDestroy() {
        try {
            unregisterReceiver(scannerReceiver);
        } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
