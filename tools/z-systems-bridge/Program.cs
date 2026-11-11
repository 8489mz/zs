using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Printing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace ZSystems.HardwareBridge
{
    static class Program
    {
        private const int Port = 18181;
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();
        private static readonly DateTime StartTime = DateTime.UtcNow;
        private static readonly List<HttpListenerResponse> SseClients = new List<HttpListenerResponse>();
        private static readonly object SseLock = new object();
        // Serializes Windows silent prints: switching the default printer is a
        // process-wide side effect, so two prints must never interleave it.
        private static readonly object WindowsPrintLock = new object();
        private static HttpListener _listener;
        private static NotifyIcon _trayIcon;

        private static readonly string ConfigPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "bridge-config.json");
        private static string CloudServerUrl = "https://app.zsystemai.com";
        private static string TenantId = "dev-tenant";
        private static string BridgeKey = "";
        private static bool IsCloudRelayConnected = false;
        private static MenuItem _tenantMenuItem;
        private static MenuItem _relayStatusMenuItem;

        private static void LoadConfig()
        {
            try
            {
                if (File.Exists(ConfigPath))
                {
                    string json = File.ReadAllText(ConfigPath, Encoding.UTF8);
                    var data = Serializer.Deserialize<Dictionary<string, object>>(json);
                    if (data != null)
                    {
                        if (data.ContainsKey("serverUrl") && !string.IsNullOrEmpty(Convert.ToString(data["serverUrl"])))
                            CloudServerUrl = Convert.ToString(data["serverUrl"]).Trim();
                        if (data.ContainsKey("tenantId") && !string.IsNullOrEmpty(Convert.ToString(data["tenantId"])))
                            TenantId = Convert.ToString(data["tenantId"]).Trim();
                        if (data.ContainsKey("bridgeKey"))
                            BridgeKey = Convert.ToString(data["bridgeKey"]).Trim();
                    }
                }
                else
                {
                    SaveConfig();
                }
            }
            catch {}
        }

        private static void SaveConfig()
        {
            try
            {
                var data = new Dictionary<string, object>
                {
                    { "serverUrl", CloudServerUrl },
                    { "tenantId", TenantId },
                    { "bridgeKey", BridgeKey },
                    { "updatedAt", DateTime.UtcNow.ToString("o") }
                };
                File.WriteAllText(ConfigPath, Serializer.Serialize(data), Encoding.UTF8);
                UpdateTrayMenuLabels();
            }
            catch {}
        }

        private static void UpdateTrayMenuLabels()
        {
            try
            {
                if (_tenantMenuItem != null)
                {
                    _tenantMenuItem.Text = string.Format("المنشأة: {0}", string.IsNullOrEmpty(TenantId) ? "غير محدد" : TenantId);
                }
                if (_relayStatusMenuItem != null)
                {
                    _relayStatusMenuItem.Text = string.Format("التتابع السحابي: {0}", IsCloudRelayConnected ? "متصل ومستعد" : "جاري المحاولة...");
                }
            }
            catch {}
        }

        private static void ShowConfigDialog()
        {
            Form form = new Form();
            form.Text = "إعدادات الربط السحابي - Z-Systems Bridge";
            form.RightToLeft = RightToLeft.Yes;
            form.RightToLeftLayout = true;
            form.Width = 480;
            form.Height = 340;
            form.FormBorderStyle = FormBorderStyle.FixedDialog;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.MaximizeBox = false;
            form.MinimizeBox = false;

            Label lblServer = new Label { Text = "رابط السيرفر السحابي (Server URL):", Left = 20, Top = 20, Width = 420 };
            TextBox txtServer = new TextBox { Text = CloudServerUrl, Left = 20, Top = 45, Width = 420 };

            Label lblTenant = new Label { Text = "معرّف المنشأة (Tenant ID) أو كود الربط:", Left = 20, Top = 85, Width = 420 };
            TextBox txtTenant = new TextBox { Text = TenantId, Left = 20, Top = 110, Width = 420 };

            Label lblBridgeKey = new Label { Text = "مفتاح الربط الآمن (Tenant Bridge Key):", Left = 20, Top = 150, Width = 420 };
            TextBox txtBridgeKey = new TextBox { Text = BridgeKey, Left = 20, Top = 175, Width = 420, UseSystemPasswordChar = true };

            Button btnSave = new Button { Text = "حفظ وتوصيل", Left = 160, Top = 225, Width = 150, Height = 36 };
            btnSave.Click += (s, e) =>
            {
                string newServer = txtServer.Text.Trim();
                string newTenant = txtTenant.Text.Trim();
                if (!string.IsNullOrEmpty(newServer)) CloudServerUrl = newServer;
                TenantId = newTenant;
                BridgeKey = txtBridgeKey.Text.Trim();
                SaveConfig();
                MessageBox.Show("تم حفظ إعدادات الربط بنجاح. سيتم الاتصال بالسيرفر فوراً.", "نجاح", MessageBoxButtons.OK, MessageBoxIcon.Information);
                form.Close();
            };

            form.Controls.Add(lblServer);
            form.Controls.Add(txtServer);
            form.Controls.Add(lblTenant);
            form.Controls.Add(txtTenant);
            form.Controls.Add(lblBridgeKey);
            form.Controls.Add(txtBridgeKey);
            form.Controls.Add(btnSave);
            form.ShowDialog();
        }

        private static void StartCloudRelay()
        {
            Thread relayThread = new Thread(CloudRelayLoop);
            relayThread.IsBackground = true;
            relayThread.Start();
        }

        private static void CloudRelayLoop()
        {
            try
            {
                // Keep normal Windows certificate validation; never accept invalid HTTPS peers.
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            }
            catch {}

            while (true)
            {
                try
                {
                    if (Uri.IsWellFormedUriString(CloudServerUrl, UriKind.Absolute) &&
                        CloudServerUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase) &&
                        !string.IsNullOrEmpty(TenantId) && BridgeKey.Length == 64)
                    {
                        PollCloudJob();
                    }
                    else
                    {
                        IsCloudRelayConnected = false;
                        UpdateTrayMenuLabels();
                        Thread.Sleep(3000);
                    }
                }
                catch
                {
                    IsCloudRelayConnected = false;
                    UpdateTrayMenuLabels();
                    Thread.Sleep(3000);
                }
            }
        }

        private static void PollCloudJob()
        {
            string pollUrl = CloudServerUrl.TrimEnd('/') + "/api/sales/pos/terminals/bridge/poll";
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(pollUrl);
            req.Method = "POST";
            req.ContentType = "application/json";
            req.Headers["X-ZS-Bridge-Key"] = BridgeKey;
            req.Timeout = 30000;

            var pollPayload = new Dictionary<string, object>
            {
                { "tenantId", TenantId },
                { "machineName", Environment.MachineName },
                { "bridgeVersion", "1.1.0" }
            };

            byte[] bytes = Encoding.UTF8.GetBytes(Serializer.Serialize(pollPayload));
            req.ContentLength = bytes.Length;
            using (Stream stream = req.GetRequestStream())
            {
                stream.Write(bytes, 0, bytes.Length);
            }

            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
            using (StreamReader reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
            {
                if (!IsCloudRelayConnected)
                {
                    IsCloudRelayConnected = true;
                    UpdateTrayMenuLabels();
                }

                string json = reader.ReadToEnd();
                var res = Serializer.Deserialize<Dictionary<string, object>>(json);
                if (res != null && res.ContainsKey("data"))
                {
                    var data = res["data"] as Dictionary<string, object>;
                    if (data != null && data.ContainsKey("hasJob") && Convert.ToBoolean(data["hasJob"]) && data.ContainsKey("job"))
                    {
                        var job = data["job"] as Dictionary<string, object>;
                        if (job != null)
                        {
                            ExecuteCloudJobAsync(job);
                        }
                    }
                }
            }
        }

        private static void ExecuteCloudJobAsync(Dictionary<string, object> job)
        {
            ThreadPool.QueueUserWorkItem(state =>
            {
                try
                {
                    string jobId = Convert.ToString(job["jobId"]);
                    string ip = Convert.ToString(job["ip"]);
                    // Never default to a guessed terminal IP: a cloud job
                    // without an IP is skipped, not sent to a stranger's terminal.
                    if (string.IsNullOrEmpty(ip)) return;
                    int port = Convert.ToInt32(job["port"]);
                    string provider = Convert.ToString(job["provider"]);
                    string refId = Convert.ToString(job["referenceId"]);

                    if (job.ContainsKey("action") && Convert.ToString(job["action"]) == "cancel")
                    {
                        try
                        {
                            string cancelUrl = string.Format("http://{0}:{1}/cancel", ip, port);
                            HttpWebRequest cancelReq = (HttpWebRequest)WebRequest.Create(cancelUrl);
                            cancelReq.Method = "POST";
                            cancelReq.ContentType = "application/json";
                            cancelReq.Timeout = 5000;
                            byte[] cBytes = Encoding.UTF8.GetBytes("{\"referenceId\":\"" + jobId + "\"}");
                            cancelReq.ContentLength = cBytes.Length;
                            using (Stream s = cancelReq.GetRequestStream()) s.Write(cBytes, 0, cBytes.Length);
                            using (HttpWebResponse r = (HttpWebResponse)cancelReq.GetResponse()) {}
                        }
                        catch {}
                        return;
                    }

                    decimal amount = Convert.ToDecimal(job["amount"]);
                    string currency = Convert.ToString(job["currency"]);

                    var result = ExecuteEcrChargeInternal(ip, port, provider, amount, currency, refId);

                    string callbackUrl = CloudServerUrl.TrimEnd('/') + "/api/sales/pos/terminals/bridge/callback";
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(callbackUrl);
                    req.Method = "POST";
                    req.ContentType = "application/json";
                    req.Headers["X-ZS-Bridge-Key"] = BridgeKey;
                    req.Timeout = 15000;

                    var callbackPayload = new Dictionary<string, object>
                    {
                        { "tenantId", TenantId },
                        { "jobId", jobId },
                        { "status", result.ContainsKey("status") ? result["status"] : "declined" },
                        { "authCode", result.ContainsKey("authCode") ? result["authCode"] : "" },
                        { "rrn", result.ContainsKey("rrn") ? result["rrn"] : refId },
                        { "cardScheme", result.ContainsKey("cardScheme") ? result["cardScheme"] : "visa" },
                        { "cardLastFour", result.ContainsKey("cardLastFour") ? result["cardLastFour"] : "" },
                        { "message", result.ContainsKey("message") ? result["message"] : "" }
                    };

                    byte[] bytes = Encoding.UTF8.GetBytes(Serializer.Serialize(callbackPayload));
                    req.ContentLength = bytes.Length;
                    using (Stream stream = req.GetRequestStream())
                    {
                        stream.Write(bytes, 0, bytes.Length);
                    }

                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    {
                        // Callback successfully received by cloud
                    }
                }
                catch {}
            });
        }

        [STAThread]
        static void Main()
        {
            string logPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "debug.log");
            try
            {
                File.AppendAllText(logPath, "--- Main Started " + DateTime.Now + " ---\n");
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                bool createdNew;
                using (Mutex mutex = new Mutex(true, "ZSystemsHardwareBridge_SingleInstanceMutex", out createdNew))
                {
                    File.AppendAllText(logPath, "Step 1: createdNew=" + createdNew + "\n");
                    if (!createdNew)
                    {
                        File.AppendAllText(logPath, "Exiting because createdNew is false\n");
                        return;
                    }

                    LoadConfig();

                File.AppendAllText(logPath, "Step 2: Startup registry\n");
                // 2. Automatically register in Windows Startup (Autostart on boot)
                try
                {
                    string exePath = Application.ExecutablePath;
                    using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                    {
                        if (key != null)
                        {
                            key.SetValue("ZSystemsHardwareBridge", "\"" + exePath + "\"");
                        }
                    }
                }
                catch (Exception regEx) { File.AppendAllText(logPath, "Reg error: " + regEx.Message + "\n"); }

                // 2b. Render the hidden print browser in IE11 mode, not IE7:
                // FEATURE_BROWSER_EMULATION is read when the WebBrowser
                // control is created (lazily, per print), so writing the key
                // at startup takes effect for every print in this run.
                EnsureBrowserEmulation();

                File.AppendAllText(logPath, "Step 3: Starting listener\n");
                // 3. Start HTTP bridge server on background thread
                try
                {
                    _listener = new HttpListener();
                    _listener.Prefixes.Add(string.Format("http://127.0.0.1:{0}/", Port));
                    _listener.Prefixes.Add(string.Format("http://localhost:{0}/", Port));
                    _listener.Start();

                    Thread listenerThread = new Thread(ListenLoop);
                    listenerThread.IsBackground = true;
                    listenerThread.Start();
                    File.AppendAllText(logPath, "Listener started successfully on port " + Port + "\n");

                    // 4. Start Cloud Relay background worker
                    StartCloudRelay();
                }
                catch (Exception ex)
                {
                    File.AppendAllText(logPath, "Listener start failed: " + ex.ToString() + "\n");
                    return;
                }

                File.AppendAllText(logPath, "Step 4: TrayIcon\n");

                // 5. Create System Tray Icon
                _trayIcon = new NotifyIcon();
                _trayIcon.Icon = SystemIcons.Shield;
                _trayIcon.Text = "جسر Z-Systems للعتاد (نشط - 127.0.0.1:18181)";
                _trayIcon.Visible = true;

                ContextMenu menu = new ContextMenu();
                menu.MenuItems.Add(new MenuItem("جسر Z-Systems للعتاد v1.1.0") { Enabled = false });
                menu.MenuItems.Add(new MenuItem("الحالة: متصل (127.0.0.1:18181)") { Enabled = false });
                _tenantMenuItem = new MenuItem(string.Format("المنشأة: {0}", string.IsNullOrEmpty(TenantId) ? "غير محدد" : TenantId)) { Enabled = false };
                menu.MenuItems.Add(_tenantMenuItem);
                _relayStatusMenuItem = new MenuItem("التتابع السحابي: جاري المحاولة...") { Enabled = false };
                menu.MenuItems.Add(_relayStatusMenuItem);
                menu.MenuItems.Add("-");
                menu.MenuItems.Add("إعدادات الربط والمنشأة (Cloud Sync)...", (s, e) => ShowConfigDialog());
                menu.MenuItems.Add("فتح لوحة التشخيص والفحص", (s, e) =>
                {
                    try { System.Diagnostics.Process.Start("http://127.0.0.1:18181/diagnostics"); } catch {}
                });
                menu.MenuItems.Add("-");
                menu.MenuItems.Add("إيقاف وخروج", (s, e) =>
                {
                    DialogResult confirm = MessageBox.Show(
                        "هل أنت متأكد من رغبتك في إيقاف جسر Z-Systems للعتاد؟\n\nتنبيه: إيقاف الجسر سيعطل التخاطب مع ماكينات الدفع وطابعات الفواتير في الكاشير.",
                        "تأكيد إيقاف الخدمة",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Warning,
                        MessageBoxDefaultButton.Button2
                    );
                    if (confirm == DialogResult.Yes)
                    {
                        _trayIcon.Visible = false;
                        try { _listener.Stop(); } catch {}
                        Application.Exit();
                    }
                });

                _trayIcon.ContextMenu = menu;
                _trayIcon.DoubleClick += (s, e) =>
                {
                    try { System.Diagnostics.Process.Start("http://127.0.0.1:18181/diagnostics"); } catch {}
                };

                // Notification Balloon
                _trayIcon.ShowBalloonTip(
                    3000,
                    "جسر Z-Systems للعتاد",
                    "الجسر نشط الآن في الخلفية وجاهز للربط مع نقاط البيع والماكينات.",
                    ToolTipIcon.Info
                );

                Application.Run(new ApplicationContext());
                }
            }
            catch (Exception ex)
            {
                try { File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "bridge-error.log"), ex.ToString()); } catch {}
                MessageBox.Show(ex.ToString(), "Bridge Startup Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static void ListenLoop()
        {
            while (_listener != null && _listener.IsListening)
            {
                try
                {
                    HttpListenerContext context = _listener.GetContext();
                    ThreadPool.QueueUserWorkItem(ProcessRequest, context);
                }
                catch
                {
                    if (_listener == null || !_listener.IsListening) break;
                }
            }
        }

        private static void BroadcastSse(string type, object data)
        {
            lock (SseLock)
            {
                string payload = Serializer.Serialize(new Dictionary<string, object>
                {
                    { "type", type },
                    { "data", data },
                    { "timestamp", DateTime.UtcNow.ToString("o") }
                });

                byte[] bytes = Encoding.UTF8.GetBytes(string.Format("data: {0}\n\n", payload));
                List<HttpListenerResponse> deadClients = new List<HttpListenerResponse>();

                foreach (var client in SseClients)
                {
                    try
                    {
                        client.OutputStream.Write(bytes, 0, bytes.Length);
                        client.OutputStream.Flush();
                    }
                    catch
                    {
                        deadClients.Add(client);
                    }
                }

                foreach (var dead in deadClients)
                {
                    SseClients.Remove(dead);
                }
            }
        }

        private static bool IsTrustedBrowserOrigin(string origin)
        {
            if (string.IsNullOrEmpty(origin)) return true; // Native local clients send no Origin header
            if (string.Equals(origin, "https://app.zsystemai.com", StringComparison.OrdinalIgnoreCase)) return true;
            // Other verified deployments/development origins must be explicitly provisioned by the operator.
            foreach (string trusted in (Environment.GetEnvironmentVariable("ZS_BRIDGE_ALLOWED_ORIGINS") ?? "").Split(','))
            {
                if (!string.IsNullOrWhiteSpace(trusted) && string.Equals(origin, trusted.Trim(), StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }

        private static void SetCorsHeaders(HttpListenerContext context)
        {
            var res = context.Response;
            string origin = context.Request.Headers["Origin"];
            if (!string.IsNullOrEmpty(origin) && IsTrustedBrowserOrigin(origin))
            {
                res.Headers["Access-Control-Allow-Origin"] = origin;
                res.Headers["Vary"] = "Origin";
                res.Headers["Access-Control-Allow-Credentials"] = "true";
                res.Headers["Access-Control-Allow-Private-Network"] = "true";
            }
            res.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";

            string reqHeaders = context.Request.Headers["Access-Control-Request-Headers"];
            if (!string.IsNullOrEmpty(reqHeaders))
            {
                res.Headers["Access-Control-Allow-Headers"] = reqHeaders;
            }
            else
            {
                res.Headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, x-pairing-key, X-Requested-With, Accept";
            }
            res.Headers["Access-Control-Max-Age"] = "86400";
        }

        private static void SendJson(HttpListenerContext context, int statusCode, object data)
        {
            try
            {
                SetCorsHeaders(context);
                context.Response.StatusCode = statusCode;
                context.Response.ContentType = "application/json; charset=utf-8";

                string json = Serializer.Serialize(data);
                byte[] bytes = Encoding.UTF8.GetBytes(json);
                context.Response.ContentLength64 = bytes.Length;
                context.Response.OutputStream.Write(bytes, 0, bytes.Length);
                context.Response.OutputStream.Close();
            }
            catch {}
        }

        private static void ProcessRequest(object state)
        {
            HttpListenerContext context = (HttpListenerContext)state;
            try
            {
                SetCorsHeaders(context);
                if (!IsTrustedBrowserOrigin(context.Request.Headers["Origin"]))
                {
                    SendJson(context, 403, new Dictionary<string, object> { { "success", false }, { "error", "Untrusted browser origin" } });
                    return;
                }

                if (context.Request.HttpMethod == "OPTIONS")
                {
                    context.Response.StatusCode = 204;
                    context.Response.ContentLength64 = 0;
                    context.Response.OutputStream.Close();
                    return;
                }

                string origin = context.Request.Headers["Origin"];
                if (!string.IsNullOrEmpty(origin) && !IsTrustedBrowserOrigin(origin))
                {
                    SendJson(context, 403, new Dictionary<string, object>
                    {
                        { "success", false },
                        { "error", "Cross-origin access from untrusted domain is forbidden" }
                    });
                    return;
                }

                string path = context.Request.Url.AbsolutePath.ToLowerInvariant();

                // 1. Health & Ping
                if (path == "/health" || path == "/ping")
                {
                    SendJson(context, 200, new Dictionary<string, object>
                    {
                        { "status", "ONLINE" },
                        { "name", "Z-Systems Hardware Bridge" },
                        { "version", "1.2.0" },
                        { "runtime", "Windows Native Service" },
                        { "tenantId", TenantId },
                        { "cloudRelayConnected", IsCloudRelayConnected },
                        { "serverUrl", CloudServerUrl },
                        { "uptimeSec", (int)(DateTime.UtcNow - StartTime).TotalSeconds }
                    });
                    return;
                }

                // 2. Diagnostics UI
                if (path == "/" || path == "/diagnostics" || path == "/index.html")
                {
                    ServeDiagnosticsHtml(context);
                    return;
                }

                // 3. SSE Stream
                if (path == "/events" || path == "/api/events")
                {
                    context.Response.StatusCode = 200;
                    context.Response.ContentType = "text/event-stream";
                    context.Response.Headers["Cache-Control"] = "no-cache";
                    byte[] initBytes = Encoding.UTF8.GetBytes("data: {\"type\":\"connected\",\"version\":\"1.0.0\"}\n\n");
                    context.Response.OutputStream.Write(initBytes, 0, initBytes.Length);
                    context.Response.OutputStream.Flush();

                    lock (SseLock)
                    {
                        SseClients.Add(context.Response);
                    }
                    return;
                }

                // Read request body for POST endpoints
                string body = "";
                if (context.Request.HasEntityBody)
                {
                    using (StreamReader reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding))
                    {
                        body = reader.ReadToEnd();
                    }
                }

                Dictionary<string, object> jsonBody = new Dictionary<string, object>();
                if (!string.IsNullOrEmpty(body))
                {
                    try { jsonBody = Serializer.Deserialize<Dictionary<string, object>>(body); } catch {}
                }

                // Never let unauthenticated loopback clients repoint this bridge to an attacker server.
                // Tenant/server changes are allowed only in the trusted native tray configuration.
                if (path == "/api/tenant/sync" && context.Request.HttpMethod == "POST")
                {
                    string claimedTenant = jsonBody.ContainsKey("tenantId") ? Convert.ToString(jsonBody["tenantId"]).Trim() : "";
                    string claimedServer = jsonBody.ContainsKey("serverUrl") ? Convert.ToString(jsonBody["serverUrl"]).Trim() : CloudServerUrl;
                    if (!string.Equals(claimedTenant, TenantId, StringComparison.Ordinal) ||
                        !string.Equals(claimedServer.TrimEnd('/'), CloudServerUrl.TrimEnd('/'), StringComparison.OrdinalIgnoreCase))
                    {
                        SendJson(context, 403, new Dictionary<string, object> { { "success", false }, { "error", "Configure cloud identity from the native Bridge tray" } });
                        return;
                    }
                    SendJson(context, 200, new Dictionary<string, object> { { "success", true }, { "tenantId", TenantId }, { "cloudRelayConnected", IsCloudRelayConnected } });
                    return;
                }

                // 4. ECR Charge
                if (path == "/api/ecr/charge" && context.Request.HttpMethod == "POST")
                {
                    HandleEcrCharge(context, jsonBody);
                    return;
                }

                // 5. ECR Cancel
                if (path == "/api/ecr/cancel" && context.Request.HttpMethod == "POST")
                {
                    HandleEcrCancel(context, jsonBody);
                    return;
                }

                // 6. ECR Test Connection
                if (path == "/api/ecr/test" && context.Request.HttpMethod == "POST")
                {
                    HandleEcrTest(context, jsonBody);
                    return;
                }

                // 7. Thermal Printer Print
                if (path == "/api/printer/print" && context.Request.HttpMethod == "POST")
                {
                    HandlePrinterPrint(context, jsonBody);
                    return;
                }

                // 8. Thermal Printer Test Receipt
                if (path == "/api/printer/test" && context.Request.HttpMethod == "POST")
                {
                    HandlePrinterTest(context, jsonBody);
                    return;
                }

                // 9. Kick Cash Drawer
                if (path == "/api/printer/kick-drawer" && context.Request.HttpMethod == "POST")
                {
                    HandleKickDrawer(context, jsonBody);
                    return;
                }

                // 10. Windows Printer List (names of printers installed on this PC)
                if (path == "/api/printer/list" && context.Request.HttpMethod == "GET")
                {
                    HandlePrinterList(context);
                    return;
                }

                // 11. Silent HTML Print on a Windows printer (no browser print dialog)
                if (path == "/api/printer/print-windows" && context.Request.HttpMethod == "POST")
                {
                    HandlePrinterPrintWindows(context, jsonBody);
                    return;
                }

                // Not found
                SendJson(context, 404, new Dictionary<string, object>
                {
                    { "success", false },
                    { "error", "Endpoint not found: " + path }
                });
            }
            catch (Exception ex)
            {
                SendJson(context, 500, new Dictionary<string, object>
                {
                    { "success", false },
                    { "error", ex.Message }
                });
            }
        }

        private static void ServeDiagnosticsHtml(HttpListenerContext context)
        {
            string html = "";
            try
            {
                using (Stream stream = System.Reflection.Assembly.GetExecutingAssembly().GetManifestResourceStream("diagnostics.html"))
                {
                    if (stream != null)
                    {
                        using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                        {
                            html = reader.ReadToEnd();
                        }
                    }
                }
            }
            catch {}

            if (string.IsNullOrEmpty(html))
            {
                string[] possiblePaths = new string[]
                {
                    Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "src", "ui", "diagnostics.html"),
                    Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "diagnostics.html")
                };

                foreach (var p in possiblePaths)
                {
                    if (File.Exists(p))
                    {
                        html = File.ReadAllText(p, Encoding.UTF8);
                        break;
                    }
                }
            }

            if (string.IsNullOrEmpty(html))
            {
                html = "<!DOCTYPE html><html dir='rtl'><head><meta charset='utf-8'><title>Z-Systems Bridge</title></head><body><h1>جسر Z-Systems للعتاد نشط ومستعد</h1><p>الحالة: متصل (127.0.0.1:18181)</p></body></html>";
            }

            byte[] bytes = Encoding.UTF8.GetBytes(html);
            context.Response.StatusCode = 200;
            context.Response.ContentType = "text/html; charset=utf-8";
            context.Response.ContentLength64 = bytes.Length;
            context.Response.OutputStream.Write(bytes, 0, bytes.Length);
            context.Response.OutputStream.Close();
        }

        private static Dictionary<string, object> ExecuteEcrChargeInternal(string ip, int port, string provider, decimal amount, string currency, string refId)
        {
            BroadcastSse("ecr_waiting", new Dictionary<string, object>
            {
                { "amount", amount },
                { "currency", currency },
                { "ip", ip },
                { "port", port },
                { "referenceId", refId }
            });

            try
            {
                string targetUrl = string.Format("http://{0}:{1}/poslink", ip, port);
                if (provider != null && provider.ToLowerInvariant().Contains("geidea"))
                {
                    targetUrl = string.Format("http://{0}:{1}/api/v1/payment", ip, port);
                }

                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(targetUrl);
                req.Method = "POST";
                req.ContentType = "application/json";
                req.Timeout = 120000;

                var requestPayload = new Dictionary<string, object>
                {
                    { "transType", "SALE" },
                    { "amount", amount },
                    { "amountInCents", Convert.ToInt64(amount * 100) },
                    { "currency", currency },
                    { "ecrReference", refId },
                    { "referenceId", refId }
                };

                byte[] postBytes = Encoding.UTF8.GetBytes(Serializer.Serialize(requestPayload));
                req.ContentLength = postBytes.Length;
                using (Stream stream = req.GetRequestStream())
                {
                    stream.Write(postBytes, 0, postBytes.Length);
                }

                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                using (StreamReader reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    string respJson = reader.ReadToEnd();
                    var dict = Serializer.Deserialize<Dictionary<string, object>>(respJson);

                    bool isApproved = (dict != null && dict.ContainsKey("status") && Convert.ToString(dict["status"]).ToUpperInvariant() == "APPROVED") ||
                                      (dict != null && dict.ContainsKey("responseCode") && Convert.ToString(dict["responseCode"]) == "000000");

                    string authCode = "";
                    if (dict != null && dict.ContainsKey("approvalCode")) authCode = Convert.ToString(dict["approvalCode"]);
                    else if (dict != null && dict.ContainsKey("authCode")) authCode = Convert.ToString(dict["authCode"]);
                    else if (isApproved) authCode = "AUTH-" + new Random().Next(100000, 999999);

                    string rrn = "";
                    if (dict != null && dict.ContainsKey("rrn")) rrn = Convert.ToString(dict["rrn"]);
                    else rrn = refId;

                    string cardScheme = "";
                    if (dict != null && dict.ContainsKey("cardScheme")) cardScheme = Convert.ToString(dict["cardScheme"]);
                    else cardScheme = "Visa";

                    string cardLastFour = "";
                    if (dict != null && dict.ContainsKey("cardLastFour")) cardLastFour = Convert.ToString(dict["cardLastFour"]);

                    string message = "";
                    if (dict != null && dict.ContainsKey("message")) message = Convert.ToString(dict["message"]);
                    else message = isApproved ? "تمت الموافقة بنجاح" : "تم رفض العملية من البنك";

                    BroadcastSse(isApproved ? "ecr_approved" : "ecr_declined", dict);

                    return new Dictionary<string, object>
                    {
                        { "success", isApproved },
                        { "status", isApproved ? "approved" : "declined" },
                        { "authCode", authCode },
                        { "rrn", rrn },
                        { "cardScheme", cardScheme },
                        { "cardLastFour", cardLastFour },
                        { "message", message },
                        { "data", dict }
                    };
                }
            }
            catch (Exception ex)
            {
                BroadcastSse("ecr_error", new Dictionary<string, object> { { "error", ex.Message } });
                return new Dictionary<string, object>
                {
                    { "success", false },
                    { "status", "error" },
                    { "message", "تعذر الاتصال بماكينة الدفع: " + ex.Message }
                };
            }
        }

        private static void HandleEcrCharge(HttpListenerContext context, Dictionary<string, object> body)
        {
            string ip = body.ContainsKey("ip") ? Convert.ToString(body["ip"]) : "";
            int port = body.ContainsKey("port") ? Convert.ToInt32(body["port"]) : 8080;
            decimal amount = body.ContainsKey("amount") ? Convert.ToDecimal(body["amount"]) : 0;
            string currency = body.ContainsKey("currency") ? Convert.ToString(body["currency"]) : "EGP";
            string refId = body.ContainsKey("referenceId") ? Convert.ToString(body["referenceId"]) : "ECR-" + DateTime.UtcNow.Ticks;
            string provider = body.ContainsKey("provider") ? Convert.ToString(body["provider"]).ToLowerInvariant() : "fawry";

            if (string.IsNullOrEmpty(ip) || amount <= 0)
            {
                SendJson(context, 400, new Dictionary<string, object>
                {
                    { "success", false },
                    { "error", "يجب تحديد عنوان IP والمبلغ المطلوب" }
                });
                return;
            }

            var result = ExecuteEcrChargeInternal(ip, port, provider, amount, currency, refId);
            int statusCode = (result.ContainsKey("status") && Convert.ToString(result["status"]) == "error") ? 500 : 200;
            SendJson(context, statusCode, result);
        }

        private static void HandleEcrCancel(HttpListenerContext context, Dictionary<string, object> body)
        {
            string ip = body.ContainsKey("ip") ? Convert.ToString(body["ip"]) : "";
            if (string.IsNullOrEmpty(ip))
            {
                SendJson(context, 400, new Dictionary<string, object>
                {
                    { "success", false },
                    { "error", "يجب تحديد عنوان IP الماكينة" }
                });
                return;
            }
            int port = body.ContainsKey("port") ? Convert.ToInt32(body["port"]) : 8080;
            string refId = body.ContainsKey("referenceId") ? Convert.ToString(body["referenceId"]) : "";
            string prov = body.ContainsKey("provider") ? Convert.ToString(body["provider"]).ToLowerInvariant() : "";

            try
            {
                string targetUrl = string.Format("http://{0}:{1}/cancel", ip, port);
                if (prov.Contains("geidea"))
                {
                    targetUrl = string.Format("http://{0}:{1}/api/v1/transaction/cancel", ip, port);
                }
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(targetUrl);
                req.Method = "POST";
                req.ContentType = "application/json";
                req.Timeout = 6000;

                byte[] postBytes = Encoding.UTF8.GetBytes(Serializer.Serialize(new Dictionary<string, object> { { "referenceId", refId }, { "ecrReference", refId } }));
                req.ContentLength = postBytes.Length;
                using (Stream stream = req.GetRequestStream())
                {
                    stream.Write(postBytes, 0, postBytes.Length);
                }

                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    BroadcastSse("ecr_cancelled", new Dictionary<string, object> { { "referenceId", refId } });
                    SendJson(context, 200, new Dictionary<string, object> { { "success", true } });
                }
            }
            catch (Exception ex)
            {
                SendJson(context, 500, new Dictionary<string, object> { { "success", false }, { "error", ex.Message } });
            }
        }

        private static void HandleEcrTest(HttpListenerContext context, Dictionary<string, object> body)
        {
            string ip = body.ContainsKey("ip") ? Convert.ToString(body["ip"]) : "";
            int port = body.ContainsKey("port") ? Convert.ToInt32(body["port"]) : 8080;

            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                using (TcpClient tcp = new TcpClient())
                {
                    var result = tcp.BeginConnect(ip, port, null, null);
                    bool success = result.AsyncWaitHandle.WaitOne(3000);
                    sw.Stop();
                    if (success)
                    {
                        tcp.EndConnect(result);
                        SendJson(context, 200, new Dictionary<string, object>
                        {
                            { "success", true },
                            { "data", new Dictionary<string, object> {
                                { "online", true },
                                { "reachable", true },
                                { "portOpen", true },
                                { "pingSucceeded", true },
                                { "message", "الاتصال بماكينة الدفع نشط ومستعد" },
                                { "latencyMs", sw.ElapsedMilliseconds }
                            }}
                        });
                        return;
                    }
                    try { tcp.Close(); } catch {}
                }
                SendJson(context, 200, new Dictionary<string, object>
                {
                    { "success", false },
                    { "data", new Dictionary<string, object> {
                        { "online", false },
                        { "reachable", false },
                        { "portOpen", false },
                        { "pingSucceeded", false },
                        { "message", "انتهت مهلة الاتصال بالماكينة على " + ip + ":" + port },
                        { "latencyMs", 0 }
                    }},
                    { "error", "انتهت مهلة الاتصال بالماكينة" }
                });
            }
            catch (Exception ex)
            {
                SendJson(context, 200, new Dictionary<string, object>
                {
                    { "success", false },
                    { "data", new Dictionary<string, object> {
                        { "online", false },
                        { "reachable", false },
                        { "portOpen", false },
                        { "pingSucceeded", false },
                        { "message", "تعذر الاتصال بالماكينة: " + ex.Message },
                        { "latencyMs", 0 }
                    }},
                    { "error", ex.Message }
                });
            }
        }

        private static void SendRawPrinterBytes(string ip, int port, byte[] bytes)
        {
            using (TcpClient client = new TcpClient())
            {
                var ar = client.BeginConnect(ip, port, null, null);
                if (!ar.AsyncWaitHandle.WaitOne(5000))
                {
                    throw new Exception(string.Format("انتهت مهلة الاتصال بالطابعة على {0}:{1}", ip, port));
                }
                client.EndConnect(ar);
                using (NetworkStream stream = client.GetStream())
                {
                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush();
                    Thread.Sleep(100);
                }
            }
        }

        private static void HandlePrinterPrint(HttpListenerContext context, Dictionary<string, object> body)
        {
            string ip = body.ContainsKey("ip") ? Convert.ToString(body["ip"]) : "";
            int port = body.ContainsKey("port") ? Convert.ToInt32(body["port"]) : 9100;
            string rawBase64 = body.ContainsKey("rawBase64") ? Convert.ToString(body["rawBase64"]) : "";
            string rawText = body.ContainsKey("rawText") ? Convert.ToString(body["rawText"]) : "";

            if (string.IsNullOrEmpty(ip))
            {
                SendJson(context, 400, new Dictionary<string, object> { { "success", false }, { "error", "يرجى تحديد عنوان IP الطابعة" } });
                return;
            }

            try
            {
                List<byte> buffer = new List<byte>();
                buffer.AddRange(new byte[] { 0x1B, 0x40 });

                if (!string.IsNullOrEmpty(rawBase64))
                {
                    buffer.AddRange(Convert.FromBase64String(rawBase64));
                }
                else if (!string.IsNullOrEmpty(rawText))
                {
                    buffer.AddRange(Encoding.UTF8.GetBytes(rawText));
                }

                buffer.AddRange(Encoding.UTF8.GetBytes("\n\n\n\n"));
                buffer.AddRange(new byte[] { 0x1D, 0x56, 0x42, 0x00 });

                SendRawPrinterBytes(ip, port, buffer.ToArray());
                SendJson(context, 200, new Dictionary<string, object> { { "success", true }, { "bytesWritten", buffer.Count } });
            }
            catch (Exception ex)
            {
                SendJson(context, 500, new Dictionary<string, object> { { "success", false }, { "error", ex.Message } });
            }
        }

        private static void HandlePrinterTest(HttpListenerContext context, Dictionary<string, object> body)
        {
            string ip = body.ContainsKey("ip") ? Convert.ToString(body["ip"]) : "";
            int port = body.ContainsKey("port") ? Convert.ToInt32(body["port"]) : 9100;
            string storeName = body.ContainsKey("storeName") ? Convert.ToString(body["storeName"]) : "Z-Systems Store";

            if (string.IsNullOrEmpty(ip))
            {
                SendJson(context, 400, new Dictionary<string, object> { { "success", false }, { "error", "يرجى تحديد عنوان IP الطابعة" } });
                return;
            }

            try
            {
                List<byte> buffer = new List<byte>();
                buffer.AddRange(new byte[] { 0x1B, 0x40 });
                buffer.AddRange(new byte[] { 0x1B, 0x61, 0x01 });
                buffer.AddRange(Encoding.UTF8.GetBytes("\n=== " + storeName + " ===\n"));
                buffer.AddRange(Encoding.UTF8.GetBytes("Z-Systems Hardware Bridge\n"));
                buffer.AddRange(Encoding.UTF8.GetBytes("Silent ESC/POS Test OK\n"));
                buffer.AddRange(Encoding.UTF8.GetBytes("--------------------------------\n"));
                buffer.AddRange(new byte[] { 0x1B, 0x61, 0x00 });
                buffer.AddRange(Encoding.UTF8.GetBytes("Status: Online & Ready\n"));
                buffer.AddRange(Encoding.UTF8.GetBytes("Port: 9100 Raw Stream\n"));
                buffer.AddRange(Encoding.UTF8.GetBytes("Date: " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "\n"));
                buffer.AddRange(Encoding.UTF8.GetBytes("--------------------------------\n\n\n\n"));
                buffer.AddRange(new byte[] { 0x1D, 0x56, 0x42, 0x00 });

                SendRawPrinterBytes(ip, port, buffer.ToArray());
                SendJson(context, 200, new Dictionary<string, object> { { "success", true } });
            }
            catch (Exception ex)
            {
                SendJson(context, 500, new Dictionary<string, object> { { "success", false }, { "error", ex.Message } });
            }
        }

        private static void HandleKickDrawer(HttpListenerContext context, Dictionary<string, object> body)
        {
            string ip = body.ContainsKey("ip") ? Convert.ToString(body["ip"]) : "";
            int port = body.ContainsKey("port") ? Convert.ToInt32(body["port"]) : 9100;

            if (string.IsNullOrEmpty(ip))
            {
                SendJson(context, 400, new Dictionary<string, object> { { "success", false }, { "error", "يرجى تحديد عنوان IP الطابعة" } });
                return;
            }

            try
            {
                byte[] drawerCmd = new byte[] { 0x1B, 0x40, 0x1B, 0x70, 0x00, 0x19, 0xFA };
                SendRawPrinterBytes(ip, port, drawerCmd);
                SendJson(context, 200, new Dictionary<string, object> { { "success", true } });
            }
            catch (Exception ex)
            {
                SendJson(context, 500, new Dictionary<string, object> { { "success", false }, { "error", ex.Message } });
            }
        }

        // 10. List the printers installed on this PC (Windows printer queue names),
        // so the web app can offer them in the printer picker.
        private static void HandlePrinterList(HttpListenerContext context)
        {
            try
            {
                List<string> printers = new List<string>();
                foreach (string name in PrinterSettings.InstalledPrinters)
                {
                    printers.Add(name);
                }
                SendJson(context, 200, new Dictionary<string, object>
                {
                    { "success", true },
                    { "printers", printers }
                });
            }
            catch (Exception ex)
            {
                SendJson(context, 500, new Dictionary<string, object> { { "success", false }, { "error", ex.Message } });
            }
        }

        [DllImport("winspool.drv", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern bool SetDefaultPrinter(string name);

        // 11. Silent HTML print on a Windows printer (no browser print dialog).
        //    Renders the HTML in a hidden WebBrowser (the same engine family that
        //    prints today's A4 receipt) and prints it with WebBrowser.Print().
        //    When deviceName names a printer other than the current default, the
        //    default is switched for the duration of the print and restored in
        //    finally. Paper size follows the printer's own default: Trident ignores
        //    the @page size, so for the A4-on-A4 receipt case the output matches
        //    today's dialog print exactly. The receiptWidthMm value only sizes the
        //    hidden browser viewport for receipt pages.
        private static void HandlePrinterPrintWindows(HttpListenerContext context, Dictionary<string, object> body)
        {
            lock (WindowsPrintLock)
            {
                string html = body.ContainsKey("html") ? Convert.ToString(body["html"]) : "";
                string deviceName = body.ContainsKey("deviceName") ? Convert.ToString(body["deviceName"]) : "";
                string pageSize = body.ContainsKey("pageSize") ? Convert.ToString(body["pageSize"]) : "A4";
                int receiptWidthMm = body.ContainsKey("receiptWidthMm") ? Convert.ToInt32(body["receiptWidthMm"]) : 80;

                if (string.IsNullOrWhiteSpace(html))
                {
                    SendJson(context, 400, new Dictionary<string, object> { { "success", false }, { "error", "يرجى إرسال محتوى HTML للطباعة" } });
                    return;
                }

                string printerName = string.IsNullOrWhiteSpace(deviceName)
                    ? new PrinterSettings().PrinterName
                    : deviceName.Trim();

                bool printerExists = false;
                foreach (string name in PrinterSettings.InstalledPrinters)
                {
                    if (string.Equals(name, printerName, StringComparison.OrdinalIgnoreCase))
                    {
                        printerExists = true;
                        break;
                    }
                }
                if (!printerExists)
                {
                    SendJson(context, 400, new Dictionary<string, object> { { "success", false }, { "error", "الطابعة غير موجودة على هذا الجهاز: " + printerName } });
                    return;
                }

                // A4 (794px at 96dpi) or receipt width (58mm ~ 220px, 80mm ~ 302px).
                int viewportWidth = string.Equals(pageSize, "receipt", StringComparison.OrdinalIgnoreCase)
                    ? (receiptWidthMm == 58 ? 220 : 302)
                    : 794;

                string error = PrintHtmlOnWindowsPrinter(html, printerName, viewportWidth);
                if (error == null)
                {
                    SendJson(context, 200, new Dictionary<string, object> { { "success", true }, { "printer", printerName } });
                }
                else
                {
                    SendJson(context, 500, new Dictionary<string, object> { { "success", false }, { "error", error } });
                }
            }
        }

        // Prints HTML on a Windows printer from a dedicated STA thread: WebBrowser
        // is an ActiveX control and must live on an STA thread with a message pump.
        // Returns null on success, otherwise a human-readable error (Arabic).
        // The caller holds WindowsPrintLock, so the temporary default-printer
        // switch below can never interleave with another print.
        // WebBrowser defaults to IE7 rendering unless FEATURE_BROWSER_EMULATION
        // names this exe at IE11 (11001). IE7 understands no CSS Grid, no
        // Flexbox and no var(); even IE11 needs the print stylesheet to carry
        // explicit fallbacks, but IE11 at least renders the receipt instead
        // of a stacked IE7 fallback. Never throws: a failed registry write
        // must not stop the bridge.
        private static void EnsureBrowserEmulation()
        {
            try
            {
                string exeName = Path.GetFileName(Application.ExecutablePath);
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Internet Explorer\Main\FeatureControl\FEATURE_BROWSER_EMULATION"))
                {
                    if (key == null) return;
                    object current = key.GetValue(exeName);
                    if (current == null || !current.Equals(11001))
                    {
                        key.SetValue(exeName, 11001, RegistryValueKind.DWord);
                    }
                }
            }
            catch { }
        }

        // IE PageSetup lives under HKCU\...\PageSetup. The WebBrowser print
        // template reads header/footer/margins/Print_Background from there, so
        // a Windows print gets IE defaults (Page 1 of 1, about:blank, ~19mm
        // margins, no backgrounds) unless we override them for this print and
        // restore them afterwards. Margins are inches, as strings.
        private static Dictionary<string, object> ApplyWindowsPrintPageSetup()
        {
            Dictionary<string, object> saved = new Dictionary<string, object>();
            try
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Internet Explorer\PageSetup"))
                {
                    if (key == null) return saved;
                    string[] names = new string[] { "header", "footer", "margin_top", "margin_bottom", "margin_left", "margin_right", "Print_Background" };
                    foreach (string name in names)
                    {
                        saved[name] = key.GetValue(name); // null when absent
                    }
                    key.SetValue("header", "", RegistryValueKind.String);
                    key.SetValue("footer", "", RegistryValueKind.String);
                    key.SetValue("margin_top", "0", RegistryValueKind.String);
                    key.SetValue("margin_bottom", "0", RegistryValueKind.String);
                    key.SetValue("margin_left", "0", RegistryValueKind.String);
                    key.SetValue("margin_right", "0", RegistryValueKind.String);
                    key.SetValue("Print_Background", "yes", RegistryValueKind.String);
                }
            }
            catch { }
            return saved;
        }

        private static void RestoreWindowsPrintPageSetup(Dictionary<string, object> saved)
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Internet Explorer\PageSetup"))
                {
                    if (key == null) return;
                    foreach (KeyValuePair<string, object> pair in saved)
                    {
                        if (pair.Value == null) { try { key.DeleteValue(pair.Key, false); } catch {} }
                        else { key.SetValue(pair.Key, pair.Value); }
                    }
                }
            }
            catch { }
        }

        private static string PrintHtmlOnWindowsPrinter(string html, string printerName, int viewportWidth)
        {
            string error = null;
            ManualResetEvent done = new ManualResetEvent(false);
            Thread sta = new Thread(delegate()
            {
                string previousDefault = null;
                WebBrowser browser = null;
                Dictionary<string, object> savedPageSetup = null;
                try
                {
                    PrinterSettings current = new PrinterSettings();
                    previousDefault = current.PrinterName;
                    if (!string.Equals(printerName, previousDefault, StringComparison.OrdinalIgnoreCase))
                    {
                        if (!SetDefaultPrinter(printerName))
                        {
                            error = "تعذر تعيين الطابعة الافتراضية: " + printerName;
                            done.Set();
                            return;
                        }
                    }

                    // Override IE PageSetup for this print only (restored in
                    // finally): no header/footer lines, zero margins, and
                    // backgrounds on, so the table header prints as designed.
                    savedPageSetup = ApplyWindowsPrintPageSetup();

                    browser = new WebBrowser();
                    // Force the underlying ActiveX handle to exist before loading.
                    IntPtr handle = browser.Handle;
                    browser.Width = viewportWidth;
                    browser.Height = 1100;
                    browser.ScrollBarsEnabled = false;
                    bool printRequested = false;
                    DateTime printStartedAt = DateTime.MinValue;
                    browser.DocumentCompleted += delegate(object sender, WebBrowserDocumentCompletedEventArgs e)
                    {
                        try
                        {
                            // Fire once for the top-level document, not for frames.
                            if (e.Url == browser.Url && !printRequested)
                            {
                                printRequested = true;
                                browser.Print();
                                // Print() only queues the hidden ieframe print
                                // template; the wait below pumps it.
                                printStartedAt = DateTime.UtcNow;
                            }
                        }
                        catch (Exception ex)
                        {
                            error = ex.Message;
                            done.Set();
                        }
                    };
                    browser.DocumentText = html;

                    // Message pump: keep the STA thread alive until Print() runs
                    // or the deadline hits. DoEvents lets the DocumentCompleted
                    // event fire on this same thread.
                    DateTime deadline = DateTime.UtcNow.AddSeconds(45);
                    while (!done.WaitOne(0))
                    {
                        if (printRequested && DateTime.UtcNow >= printStartedAt.AddSeconds(3))
                        {
                            // Print() returns as soon as the hidden ieframe print
                            // template is queued; the template reads the (still
                            // switched) default printer and spools on this same
                            // STA thread, so keep pumping 3s after Print() returns
                            // before restoring the default printer / disposing.
                            done.Set();
                            break;
                        }
                        if (DateTime.UtcNow > deadline)
                        {
                            error = "انتهت مهلة الطباعة (45 ثانية) ولم تكتمل الطباعة";
                            break;
                        }
                        Application.DoEvents();
                        Thread.Sleep(50);
                    }
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                }
                finally
                {
                    try { if (browser != null) browser.Dispose(); } catch {}
                    try { if (savedPageSetup != null) RestoreWindowsPrintPageSetup(savedPageSetup); } catch {}
                    try
                    {
                        if (previousDefault != null && !string.Equals(printerName, previousDefault, StringComparison.OrdinalIgnoreCase))
                        {
                            SetDefaultPrinter(previousDefault);
                        }
                    }
                    catch {}
                    done.Set();
                }
            });
            sta.SetApartmentState(ApartmentState.STA);
            sta.IsBackground = true;
            sta.Start();
            // Backstop: the STA thread signals done in every path (45s deadline
            // plus Print time). If it still hangs, report a timeout and let the
            // background thread restore the default printer when it unwinds.
            bool finished = done.WaitOne(TimeSpan.FromSeconds(60));
            if (!finished && error == null)
            {
                error = "انتهت مهلة الطباعة (60 ثانية) ولم تكتمل الطباعة";
            }
            return error;
        }
    }
}
