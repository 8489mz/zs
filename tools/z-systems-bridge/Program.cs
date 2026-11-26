using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Printing;
using System.Drawing.Text;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Win32;

[assembly: AssemblyTitle("أداة ربط أجهزة Z-Systems")]
[assembly: AssemblyDescription("أداة ربط الطابعات وأجهزة نقاط البيع بنظام Z-Systems")]
[assembly: AssemblyCompany("Z-Systems")]
[assembly: AssemblyProduct("أداة ربط أجهزة Z-Systems")]
[assembly: AssemblyCopyright("Z-Systems — www.zsystemai.com")]
[assembly: AssemblyVersion("1.2.0.0")]
[assembly: AssemblyFileVersion("1.2.0.0")]

namespace ZSystems.HardwareBridge
{
    static class Program
    {
        private const int Port = 18181;
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer() { MaxJsonLength = int.MaxValue };
        private static readonly DateTime StartTime = DateTime.UtcNow;
        private static readonly List<HttpListenerResponse> SseClients = new List<HttpListenerResponse>();
        private static readonly object SseLock = new object();
        // Serializes Windows silent prints: switching the default printer is a
        // process-wide side effect, so two prints must never interleave it.
        private static readonly object WindowsPrintLock = new object();
        private static readonly object PrinterCacheLock = new object();
        private static readonly object PrintDocLock = new object();
        private static readonly HashSet<string> _verifiedPrinterNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private static readonly Dictionary<string, byte[]> _inMemoryPrintDocs = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        private static Form _warmPrintForm = null;
        private static WebBrowser _warmPrintBrowser = null;
        private static System.Windows.Forms.Timer _postPrintRestoreTimer = null;
        private static Dictionary<string, object> _pendingRestorePageSetup = null;
        private static string _pendingRestoreDefaultPrinter = null;
        private static HttpListener _listener;
        private static NotifyIcon _trayIcon;
        private static Control _uiDispatcher;

        private static readonly string ConfigPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "bridge-config.json");
        private const string AppDisplayName = "أداة ربط أجهزة Z-Systems";
        private const string AppVersion = "1.2.0";
        private const string DeveloperWebsiteUrl = "https://www.zsystemai.com";
        private const string DeveloperWebsiteDisplay = "www.zsystemai.com";
        private static string CloudServerUrl = "https://app.zsystemai.com";
        private static string TenantId = "dev-tenant";
        private static string BridgeKey = "";
        private static bool IsCloudRelayConnected = false;
        private static ContextMenuStrip _trayMenu;
        private static ToolStripMenuItem _tenantMenuItem;
        private static ToolStripMenuItem _relayStatusMenuItem;

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern bool DestroyIcon(IntPtr handle);

        private static Icon CreateBrandTrayIcon()
        {
            try
            {
                using (Bitmap bmp = new Bitmap(32, 32))
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
                    g.Clear(Color.Transparent);

                    // Rounded squircle background in Z-Systems Royal Navy (#170e5e)
                    using (GraphicsPath path = new GraphicsPath())
                    {
                        int radius = 14;
                        Rectangle rect = new Rectangle(1, 1, 29, 29);
                        path.AddArc(rect.X, rect.Y, radius, radius, 180, 90);
                        path.AddArc(rect.Right - radius, rect.Y, radius, radius, 270, 90);
                        path.AddArc(rect.Right - radius, rect.Bottom - radius, radius, radius, 0, 90);
                        path.AddArc(rect.X, rect.Bottom - radius, radius, radius, 90, 90);
                        path.CloseFigure();

                        using (LinearGradientBrush bgBrush = new LinearGradientBrush(
                            rect,
                            Color.FromArgb(255, 34, 21, 122),
                            Color.FromArgb(255, 23, 14, 94),
                            45f))
                        {
                            g.FillPath(bgBrush, path);
                        }

                        using (Pen borderPen = new Pen(Color.FromArgb(180, 99, 102, 241), 1.2f))
                        {
                            g.DrawPath(borderPen, path);
                        }
                    }

                    // Bold white "Z" monogram centered
                    using (Font font = new Font("Segoe UI", 15.5f, FontStyle.Bold, GraphicsUnit.Pixel))
                    using (StringFormat sf = new StringFormat())
                    using (Brush textBrush = new SolidBrush(Color.White))
                    {
                        sf.Alignment = StringAlignment.Center;
                        sf.LineAlignment = StringAlignment.Center;
                        g.DrawString("Z", font, textBrush, new RectangleF(1f, 1.5f, 29f, 28f), sf);
                    }

                    // Emerald green online status indicator dot at bottom-right
                    using (Brush ringBrush = new SolidBrush(Color.White))
                    using (Brush dotBrush = new SolidBrush(Color.FromArgb(255, 16, 185, 129)))
                    {
                        g.FillEllipse(ringBrush, 20, 20, 11, 11);
                        g.FillEllipse(dotBrush, 21.5f, 21.5f, 8f, 8f);
                    }

                    IntPtr hIcon = bmp.GetHicon();
                    Icon cloned = (Icon)Icon.FromHandle(hIcon).Clone();
                    DestroyIcon(hIcon);
                    return cloned;
                }
            }
            catch
            {
                return SystemIcons.Application;
            }
        }

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

        private static string GetTenantMenuText()
        {
            if (string.IsNullOrWhiteSpace(TenantId))
            {
                return "حساب المنشأة: غير محدد";
            }
            if (BridgeKey.Length == 64)
            {
                return "حساب المنشأة: مرتبط بالنظام";
            }
            return "حساب المنشأة: وضع التشغيل المحلي";
        }

        private static string GetCloudStatusMenuText()
        {
            if (IsCloudRelayConnected)
            {
                return "الاتصال بالسحابة: متصل";
            }
            if (string.IsNullOrWhiteSpace(TenantId) || BridgeKey.Length != 64)
            {
                return "الاتصال بالسحابة: غير مُفعّل (يعمل محلياً)";
            }
            return "الاتصال بالسحابة: جارٍ الاتصال...";
        }

        private static void OpenDeveloperWebsite()
        {
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = DeveloperWebsiteUrl,
                    UseShellExecute = true
                });
            }
            catch {}
        }

        private static void UpdateTrayMenuLabels()
        {
            try
            {
                if (_trayMenu != null && _trayMenu.InvokeRequired)
                {
                    _trayMenu.BeginInvoke((MethodInvoker)UpdateTrayMenuLabels);
                    return;
                }
                if (_tenantMenuItem != null)
                {
                    _tenantMenuItem.Text = GetTenantMenuText();
                }
                if (_relayStatusMenuItem != null)
                {
                    _relayStatusMenuItem.Text = GetCloudStatusMenuText();
                }
            }
            catch {}
        }

        private static void ShowAboutDialog()
        {
            using (Form form = new Form())
            using (Icon dialogIcon = CreateBrandTrayIcon())
            using (Bitmap logoBitmap = dialogIcon.ToBitmap())
            {
                form.Text = "حول البرنامج — " + AppDisplayName;
                form.Icon = dialogIcon;
                form.BackColor = Color.White;
                form.ForeColor = Color.FromArgb(15, 23, 42);
                form.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
                form.RightToLeft = RightToLeft.Yes;
                form.RightToLeftLayout = true;
                form.ClientSize = new Size(460, 328);
                form.FormBorderStyle = FormBorderStyle.FixedDialog;
                form.StartPosition = FormStartPosition.CenterScreen;
                form.MaximizeBox = false;
                form.MinimizeBox = false;

                PictureBox picLogo = new PictureBox
                {
                    Image = logoBitmap,
                    SizeMode = PictureBoxSizeMode.Zoom,
                    Left = 22,
                    Top = 20,
                    Width = 40,
                    Height = 40
                };

                Label lblTitle = new Label
                {
                    Text = AppDisplayName,
                    Font = new Font("Segoe UI", 12f, FontStyle.Bold),
                    ForeColor = Color.FromArgb(23, 14, 94),
                    Left = 74,
                    Top = 18,
                    Width = 364,
                    Height = 26
                };

                Label lblVersion = new Label
                {
                    Text = "الإصدار " + AppVersion,
                    Font = new Font("Segoe UI", 9f, FontStyle.Regular),
                    ForeColor = Color.FromArgb(100, 116, 139),
                    Left = 74,
                    Top = 45,
                    Width = 364,
                    Height = 20
                };

                Panel sep1 = new Panel
                {
                    BackColor = Color.FromArgb(226, 232, 240),
                    Left = 22,
                    Top = 74,
                    Width = 416,
                    Height = 1
                };

                Label lblDesc = new Label
                {
                    Text = "أداة مساعدة لتشغيل طابعات الفواتير وأجهزة الدفع وربطها مباشرة بنظام Z-Systems.",
                    ForeColor = Color.FromArgb(51, 65, 85),
                    Left = 22,
                    Top = 88,
                    Width = 416,
                    Height = 42
                };

                Label lblDevHeader = new Label
                {
                    Text = "تطوير: فريق Z-Systems",
                    Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                    ForeColor = Color.FromArgb(15, 23, 42),
                    Left = 22,
                    Top = 138,
                    Width = 416,
                    Height = 22
                };

                LinkLabel lnkWebsite = new LinkLabel
                {
                    Text = "الموقع الرسمي: \u200E" + DeveloperWebsiteDisplay + "\u200E",
                    Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                    LinkColor = Color.FromArgb(23, 14, 94),
                    ActiveLinkColor = Color.FromArgb(37, 99, 235),
                    VisitedLinkColor = Color.FromArgb(23, 14, 94),
                    LinkBehavior = LinkBehavior.HoverUnderline,
                    Left = 22,
                    Top = 164,
                    Width = 416,
                    Height = 24
                };
                lnkWebsite.LinkClicked += (s, e) => OpenDeveloperWebsite();

                Panel sep2 = new Panel
                {
                    BackColor = Color.FromArgb(226, 232, 240),
                    Left = 22,
                    Top = 200,
                    Width = 416,
                    Height = 1
                };

                Label lblTechTitle = new Label
                {
                    Text = "بيانات الدعم الفني:",
                    Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                    ForeColor = Color.FromArgb(100, 116, 139),
                    Left = 22,
                    Top = 212,
                    Width = 416,
                    Height = 18
                };

                Label lblTechInfo = new Label
                {
                    Text = string.Format(
                        "المنفذ المحلي: \u200E127.0.0.1:{0}\u200E\nرمز المنشأة: \u200E{1}\u200E",
                        Port,
                        string.IsNullOrWhiteSpace(TenantId) ? "غير محدد" : TenantId
                    ),
                    Font = new Font("Segoe UI", 8.25f, FontStyle.Regular),
                    ForeColor = Color.FromArgb(100, 116, 139),
                    Left = 22,
                    Top = 232,
                    Width = 416,
                    Height = 34
                };

                Panel sep3 = new Panel
                {
                    BackColor = Color.FromArgb(226, 232, 240),
                    Left = 0,
                    Top = 272,
                    Width = 460,
                    Height = 1
                };

                Button btnWebsite = new Button
                {
                    Text = "زيارة الموقع الرسمي",
                    BackColor = Color.FromArgb(23, 14, 94),
                    ForeColor = Color.White,
                    FlatStyle = FlatStyle.Flat,
                    Font = new Font("Segoe UI", 9.25f, FontStyle.Bold),
                    Cursor = Cursors.Hand,
                    Left = 22,
                    Top = 282,
                    Width = 160,
                    Height = 34
                };
                btnWebsite.FlatAppearance.BorderSize = 0;
                btnWebsite.Click += (s, e) => OpenDeveloperWebsite();

                Button btnClose = new Button
                {
                    Text = "إغلاق",
                    BackColor = Color.White,
                    ForeColor = Color.FromArgb(51, 65, 85),
                    FlatStyle = FlatStyle.Flat,
                    Font = new Font("Segoe UI", 9.25f, FontStyle.Regular),
                    Cursor = Cursors.Hand,
                    Left = 192,
                    Top = 282,
                    Width = 96,
                    Height = 34
                };
                btnClose.FlatAppearance.BorderColor = Color.FromArgb(203, 213, 225);
                btnClose.Click += (s, e) => form.Close();

                form.CancelButton = btnClose;
                form.Controls.Add(picLogo);
                form.Controls.Add(lblTitle);
                form.Controls.Add(lblVersion);
                form.Controls.Add(sep1);
                form.Controls.Add(lblDesc);
                form.Controls.Add(lblDevHeader);
                form.Controls.Add(lnkWebsite);
                form.Controls.Add(sep2);
                form.Controls.Add(lblTechTitle);
                form.Controls.Add(lblTechInfo);
                form.Controls.Add(sep3);
                form.Controls.Add(btnWebsite);
                form.Controls.Add(btnClose);
                form.ShowDialog();
            }
        }

        private static void ShowConfigDialog()
        {
            using (Form form = new Form())
            using (Icon dialogIcon = CreateBrandTrayIcon())
            {
                form.Text = "إعدادات الاتصال والحساب — " + AppDisplayName;
                form.Icon = dialogIcon;
                form.BackColor = Color.White;
                form.ForeColor = Color.FromArgb(15, 23, 42);
                form.Font = new Font("Segoe UI", 9.25f, FontStyle.Regular);
                form.RightToLeft = RightToLeft.Yes;
                form.RightToLeftLayout = true;
                form.ClientSize = new Size(460, 296);
                form.FormBorderStyle = FormBorderStyle.FixedDialog;
                form.StartPosition = FormStartPosition.CenterScreen;
                form.MaximizeBox = false;
                form.MinimizeBox = false;

                Label lblServer = new Label { Text = "رابط النظام السحابي:", Left = 22, Top = 20, Width = 416, Height = 20, ForeColor = Color.FromArgb(51, 65, 85) };
                TextBox txtServer = new TextBox { Text = CloudServerUrl, Left = 22, Top = 44, Width = 416, RightToLeft = RightToLeft.No };

                Label lblTenant = new Label { Text = "رمز المنشأة:", Left = 22, Top = 82, Width = 416, Height = 20, ForeColor = Color.FromArgb(51, 65, 85) };
                TextBox txtTenant = new TextBox { Text = TenantId, Left = 22, Top = 106, Width = 416, RightToLeft = RightToLeft.No };

                Label lblBridgeKey = new Label { Text = "مفتاح الربط الآمن:", Left = 22, Top = 144, Width = 416, Height = 20, ForeColor = Color.FromArgb(51, 65, 85) };
                TextBox txtBridgeKey = new TextBox { Text = BridgeKey, Left = 22, Top = 168, Width = 416, RightToLeft = RightToLeft.No, UseSystemPasswordChar = true };

                Label lblHint = new Label
                {
                    Text = "تُستخدم هذه البيانات عند الحاجة لربط الأجهزة بحسابك السحابي في Z-Systems.",
                    Font = new Font("Segoe UI", 8.25f, FontStyle.Regular),
                    ForeColor = Color.FromArgb(100, 116, 139),
                    Left = 22,
                    Top = 202,
                    Width = 416,
                    Height = 24
                };

                Panel sep = new Panel
                {
                    BackColor = Color.FromArgb(226, 232, 240),
                    Left = 0,
                    Top = 236,
                    Width = 460,
                    Height = 1
                };

                Button btnSave = new Button
                {
                    Text = "حفظ الإعدادات",
                    BackColor = Color.FromArgb(23, 14, 94),
                    ForeColor = Color.White,
                    FlatStyle = FlatStyle.Flat,
                    Font = new Font("Segoe UI", 9.25f, FontStyle.Bold),
                    Cursor = Cursors.Hand,
                    Left = 22,
                    Top = 248,
                    Width = 140,
                    Height = 34
                };
                btnSave.FlatAppearance.BorderSize = 0;
                btnSave.Click += (s, e) =>
                {
                    string newServer = txtServer.Text.Trim();
                    string newTenant = txtTenant.Text.Trim();
                    if (!string.IsNullOrEmpty(newServer)) CloudServerUrl = newServer;
                    TenantId = newTenant;
                    BridgeKey = txtBridgeKey.Text.Trim();
                    SaveConfig();
                    MessageBox.Show(
                        "تم حفظ الإعدادات بنجاح، وسيتم تحديث الاتصال تلقائياً.",
                        "تم الحفظ",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information,
                        MessageBoxDefaultButton.Button1,
                        MessageBoxOptions.RightAlign | MessageBoxOptions.RtlReading
                    );
                    form.Close();
                };

                Button btnCancel = new Button
                {
                    Text = "إغلاق",
                    BackColor = Color.White,
                    ForeColor = Color.FromArgb(51, 65, 85),
                    FlatStyle = FlatStyle.Flat,
                    Cursor = Cursors.Hand,
                    Left = 172,
                    Top = 248,
                    Width = 96,
                    Height = 34
                };
                btnCancel.FlatAppearance.BorderColor = Color.FromArgb(203, 213, 225);
                btnCancel.Click += (s, e) => form.Close();

                form.AcceptButton = btnSave;
                form.CancelButton = btnCancel;
                form.Controls.Add(lblServer);
                form.Controls.Add(txtServer);
                form.Controls.Add(lblTenant);
                form.Controls.Add(txtTenant);
                form.Controls.Add(lblBridgeKey);
                form.Controls.Add(txtBridgeKey);
                form.Controls.Add(lblHint);
                form.Controls.Add(sep);
                form.Controls.Add(btnSave);
                form.Controls.Add(btnCancel);
                form.ShowDialog();
            }
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
                { "bridgeVersion", "1.2.0" }
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
                Icon brandIcon = CreateBrandTrayIcon();
                _trayIcon = new NotifyIcon();
                _trayIcon.Icon = brandIcon;
                _trayIcon.Text = AppDisplayName + " — تعمل بنجاح";
                _trayIcon.Visible = true;

                _trayMenu = new ContextMenuStrip();
                _trayMenu.RightToLeft = RightToLeft.Yes;
                _trayMenu.ShowImageMargin = false;
                _trayMenu.Font = new Font("Segoe UI", 9.25f, FontStyle.Regular);

                ToolStripMenuItem headerItem = new ToolStripMenuItem(AppDisplayName + " — الإصدار " + AppVersion)
                {
                    Enabled = false,
                    Font = new Font("Segoe UI", 9.5f, FontStyle.Bold)
                };
                _trayMenu.Items.Add(headerItem);

                ToolStripMenuItem statusItem = new ToolStripMenuItem("الحالة: تعمل وجاهزة للاتصال") { Enabled = false };
                _trayMenu.Items.Add(statusItem);

                _tenantMenuItem = new ToolStripMenuItem(GetTenantMenuText()) { Enabled = false };
                _trayMenu.Items.Add(_tenantMenuItem);

                _relayStatusMenuItem = new ToolStripMenuItem(GetCloudStatusMenuText()) { Enabled = false };
                _trayMenu.Items.Add(_relayStatusMenuItem);

                _trayMenu.Items.Add(new ToolStripSeparator());
                _trayMenu.Items.Add("إعدادات الاتصال والحساب...", null, (s, e) => ShowConfigDialog());
                _trayMenu.Items.Add("حالة الطابعات والأجهزة", null, (s, e) =>
                {
                    try { System.Diagnostics.Process.Start("http://127.0.0.1:18181/diagnostics"); } catch {}
                });
                _trayMenu.Items.Add(new ToolStripSeparator());
                _trayMenu.Items.Add("حول البرنامج...", null, (s, e) => ShowAboutDialog());
                _trayMenu.Items.Add("عن المطوّر — \u200E" + DeveloperWebsiteDisplay + "\u200E", null, (s, e) => OpenDeveloperWebsite());
                _trayMenu.Items.Add(new ToolStripSeparator());
                _trayMenu.Items.Add("إيقاف الخدمة وإغلاق", null, (s, e) =>
                {
                    DialogResult confirm = MessageBox.Show(
                        "هل تريد إيقاف " + AppDisplayName + "؟\n\nتنبيه: إيقاف الخدمة سيؤدي إلى توقف الطباعة المباشرة وأجهزة الدفع المرتبطة بنقطة البيع حتى إعادة تشغيلها.",
                        "تأكيد إيقاف الخدمة",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Warning,
                        MessageBoxDefaultButton.Button2,
                        MessageBoxOptions.RightAlign | MessageBoxOptions.RtlReading
                    );
                    if (confirm == DialogResult.Yes)
                    {
                        _trayIcon.Visible = false;
                        try { _listener.Stop(); } catch {}
                        Application.Exit();
                    }
                });

                _trayIcon.ContextMenuStrip = _trayMenu;
                _trayIcon.DoubleClick += (s, e) =>
                {
                    try { System.Diagnostics.Process.Start("http://127.0.0.1:18181/diagnostics"); } catch {}
                };

                // Notification Balloon
                _trayIcon.ShowBalloonTip(
                    3000,
                    AppDisplayName,
                    "الخدمة تعمل الآن وجاهزة لتشغيل الطابعات وأجهزة نقاط البيع.",
                    ToolTipIcon.Info
                );

                _uiDispatcher = new Control();
                IntPtr dispatcherHandle = _uiDispatcher.Handle;

                // Pre-warm the hidden IE11 print WebBrowser on the STA thread so the very
                // first POS receipt prints with zero ActiveX cold-start delay. Never scan
                // Windows printers at startup or during silent print — target only the
                // configured printer directly.
                EnsureWarmPrintBrowser(302, 1100);

                Application.Run(new ApplicationContext());
                }
            }
            catch (Exception ex)
            {
                try { File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "bridge-error.log"), ex.ToString()); } catch {}
                MessageBox.Show(
                    "تعذر تشغيل " + AppDisplayName + ":\n\n" + ex.Message,
                    "تعذر التشغيل",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error,
                    MessageBoxDefaultButton.Button1,
                    MessageBoxOptions.RightAlign | MessageBoxOptions.RtlReading
                );
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
            if (string.Equals(origin, "http://127.0.0.1:18181", StringComparison.OrdinalIgnoreCase)) return true;
            if (string.Equals(origin, "http://localhost:18181", StringComparison.OrdinalIgnoreCase)) return true;
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

                // 0. Internal RAM-backed print document endpoint (serves HTML to the local
                // IE11 print host in <0.2ms without touching disk or triggering Windows Defender).
                if (path == "/internal/print-doc" && context.Request.HttpMethod == "GET")
                {
                    string docId = context.Request.QueryString["id"] ?? "";
                    byte[] htmlBytes = null;
                    lock (PrintDocLock)
                    {
                        if (!string.IsNullOrEmpty(docId) && _inMemoryPrintDocs.ContainsKey(docId))
                        {
                            htmlBytes = _inMemoryPrintDocs[docId];
                        }
                    }
                    if (htmlBytes == null)
                    {
                        context.Response.StatusCode = 404;
                        context.Response.ContentLength64 = 0;
                        context.Response.OutputStream.Close();
                        return;
                    }
                    context.Response.StatusCode = 200;
                    context.Response.ContentType = "text/html; charset=utf-8";
                    context.Response.Headers["Cache-Control"] = "no-store, no-cache";
                    context.Response.ContentLength64 = htmlBytes.Length;
                    context.Response.OutputStream.Write(htmlBytes, 0, htmlBytes.Length);
                    context.Response.OutputStream.Close();
                    return;
                }

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
                    byte[] initBytes = Encoding.UTF8.GetBytes("data: {\"type\":\"connected\",\"version\":\"1.2.0\"}\n\n");
                    context.Response.OutputStream.Write(initBytes, 0, initBytes.Length);
                    context.Response.OutputStream.Flush();

                    lock (SseLock)
                    {
                        SseClients.Add(context.Response);
                    }
                    return;
                }

                // Read request body for POST endpoints (always UTF-8: browsers omit charset on application/json)
                string body = "";
                if (context.Request.HasEntityBody)
                {
                    using (StreamReader reader = new StreamReader(context.Request.InputStream, Encoding.UTF8))
                    {
                        body = reader.ReadToEnd();
                    }
                }

                Dictionary<string, object> jsonBody = new Dictionary<string, object>();
                if (!string.IsNullOrEmpty(body))
                {
                    try
                    {
                        jsonBody = Serializer.Deserialize<Dictionary<string, object>>(body);
                    }
                    catch {}
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

                // 10b. Pre-warm / Pre-stage target printer & viewport while POS sale is in flight
                if (path == "/api/printer/warm" && context.Request.HttpMethod == "POST")
                {
                    HandlePrinterWarm(context, jsonBody);
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
                html = "<!DOCTYPE html><html dir='rtl'><head><meta charset='utf-8'><title>" + AppDisplayName + "</title></head><body><h1>" + AppDisplayName + " تعمل بنجاح</h1><p>الخدمة جاهزة لتشغيل الطابعات وأجهزة نقاط البيع. — <a href='" + DeveloperWebsiteUrl + "' target='_blank' rel='noopener'>" + DeveloperWebsiteDisplay + "</a></p></body></html>";
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
                client.NoDelay = true;
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
                }
                try { client.Client.Shutdown(SocketShutdown.Both); } catch {}
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

        [DllImport("winspool.drv", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

        [DllImport("winspool.drv", SetLastError = true)]
        private static extern bool ClosePrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern bool GetDefaultPrinter(StringBuilder pszBuffer, ref int pcchBuffer);

        private static string GetFastDefaultPrinterName()
        {
            try
            {
                int size = 260;
                StringBuilder sb = new StringBuilder(size);
                if (GetDefaultPrinter(sb, ref size))
                {
                    return sb.ToString();
                }
                if (size > 260)
                {
                    sb = new StringBuilder(size);
                    if (GetDefaultPrinter(sb, ref size))
                    {
                        return sb.ToString();
                    }
                }
            }
            catch { }
            try { return new PrinterSettings().PrinterName; } catch { return ""; }
        }

        // Verifies ONLY the single target printer directly via winspool OpenPrinter
        // without enumerating or touching any other Windows/network printers.
        private static bool VerifyTargetPrinterDirect(string printerName)
        {
            if (string.IsNullOrWhiteSpace(printerName)) return false;
            string trimmed = printerName.Trim();
            lock (PrinterCacheLock)
            {
                if (_verifiedPrinterNames.Contains(trimmed)) return true;
            }
            IntPtr hPrinter = IntPtr.Zero;
            try
            {
                if (OpenPrinter(trimmed, out hPrinter, IntPtr.Zero))
                {
                    lock (PrinterCacheLock)
                    {
                        _verifiedPrinterNames.Add(trimmed);
                    }
                    return true;
                }
            }
            catch { }
            finally
            {
                if (hPrinter != IntPtr.Zero)
                {
                    try { ClosePrinter(hPrinter); } catch { }
                }
            }
            return false;
        }

        // 10. List the printers installed on this PC (Windows printer queue names),
        // ONLY when the user explicitly opens Settings (/api/printer/list).
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
                int receiptWidthMm = 80;
                if (body.ContainsKey("receiptWidthMm") && body["receiptWidthMm"] != null)
                {
                    try { receiptWidthMm = Convert.ToInt32(body["receiptWidthMm"]); } catch { receiptWidthMm = 80; }
                }

                if (string.IsNullOrWhiteSpace(html))
                {
                    SendJson(context, 400, new Dictionary<string, object> { { "success", false }, { "error", "يرجى إرسال محتوى HTML للطباعة" } });
                    return;
                }

                string printerName = string.IsNullOrWhiteSpace(deviceName)
                    ? GetFastDefaultPrinterName()
                    : deviceName.Trim();

                if (!VerifyTargetPrinterDirect(printerName))
                {
                    SendJson(context, 400, new Dictionary<string, object> { { "success", false }, { "error", "الطابعة غير موجودة على هذا الجهاز: " + printerName } });
                    return;
                }

                // A4 (794px at 96dpi), receipt width (58mm ~ 220px, 80mm ~ 302px), or explicit pageSizeMm.
                int viewportWidth = string.Equals(pageSize, "receipt", StringComparison.OrdinalIgnoreCase)
                    ? (receiptWidthMm == 58 ? 220 : 302)
                    : 794;
                int viewportHeight = 1100;
                Dictionary<string, object> sizeMm = body.ContainsKey("pageSizeMm") ? body["pageSizeMm"] as Dictionary<string, object> : null;
                if (sizeMm != null)
                {
                    try
                    {
                        double wMm = sizeMm.ContainsKey("widthMm") && sizeMm["widthMm"] != null ? Convert.ToDouble(sizeMm["widthMm"]) : 0;
                        double hMm = sizeMm.ContainsKey("heightMm") && sizeMm["heightMm"] != null ? Convert.ToDouble(sizeMm["heightMm"]) : 0;
                        if (wMm > 0) viewportWidth = Math.Max(80, (int)Math.Round(wMm * 96.0 / 25.4));
                        if (hMm > 0) viewportHeight = Math.Max(60, (int)Math.Round(hMm * 96.0 / 25.4));
                    }
                    catch { }
                }

                BroadcastSse("printer_status", new Dictionary<string, object>
                {
                    { "status", "printing" },
                    { "printer", printerName },
                    { "message", "جاري إرسال المستند إلى طابعة ويندوز: " + printerName }
                });

                string error = PrintHtmlOnWindowsPrinter(html, printerName, viewportWidth, viewportHeight);
                if (error == null)
                {
                    BroadcastSse("printer_status", new Dictionary<string, object>
                    {
                        { "status", "printed" },
                        { "printer", printerName },
                        { "message", "تمت الطباعة الصامتة بنجاح على: " + printerName }
                    });
                    SendJson(context, 200, new Dictionary<string, object> { { "success", true }, { "printer", printerName } });
                }
                else
                {
                    BroadcastSse("printer_status", new Dictionary<string, object>
                    {
                        { "status", "error" },
                        { "printer", printerName },
                        { "message", "فشلت الطباعة الصامتة: " + error }
                    });
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

        private static void HandlePrinterWarm(HttpListenerContext context, Dictionary<string, object> body)
        {
            try
            {
                System.Collections.IEnumerable printerList = (body.ContainsKey("printers") && !(body["printers"] is string))
                    ? (body["printers"] as System.Collections.IEnumerable)
                    : null;
                if (printerList != null)
                {
                    foreach (object item in printerList)
                    {
                        string pName = Convert.ToString(item);
                        if (!string.IsNullOrWhiteSpace(pName))
                        {
                            VerifyTargetPrinterDirect(pName.Trim());
                        }
                    }
                }
                else if (body.ContainsKey("deviceName"))
                {
                    string dName = Convert.ToString(body["deviceName"]);
                    if (!string.IsNullOrWhiteSpace(dName))
                    {
                        VerifyTargetPrinterDirect(dName.Trim());
                    }
                }

                string pageSize = body.ContainsKey("pageSize") ? Convert.ToString(body["pageSize"]) : "receipt";
                int receiptWidthMm = 80;
                if (body.ContainsKey("receiptWidthMm") && body["receiptWidthMm"] != null)
                {
                    try { receiptWidthMm = Convert.ToInt32(body["receiptWidthMm"]); } catch { receiptWidthMm = 80; }
                }
                int targetWidth = string.Equals(pageSize, "receipt", StringComparison.OrdinalIgnoreCase)
                    ? (receiptWidthMm == 58 ? 220 : 302)
                    : 794;

                if (_uiDispatcher != null && _uiDispatcher.IsHandleCreated)
                {
                    _uiDispatcher.BeginInvoke((MethodInvoker)delegate
                    {
                        EnsureWarmPrintBrowser(targetWidth, 1100);
                    });
                }
                SendJson(context, 200, new Dictionary<string, object> { { "success", true } });
            }
            catch (Exception ex)
            {
                SendJson(context, 200, new Dictionary<string, object> { { "success", false }, { "error", ex.Message } });
            }
        }

        private static WebBrowser EnsureWarmPrintBrowser(int viewportWidth, int viewportHeight)
        {
            try
            {
                if (_warmPrintForm == null || _warmPrintForm.IsDisposed || _warmPrintBrowser == null || _warmPrintBrowser.IsDisposed)
                {
                    try { if (_warmPrintBrowser != null && !_warmPrintBrowser.IsDisposed) _warmPrintBrowser.Dispose(); } catch {}
                    try { if (_warmPrintForm != null && !_warmPrintForm.IsDisposed) _warmPrintForm.Dispose(); } catch {}

                    lock (PrintDocLock)
                    {
                        if (!_inMemoryPrintDocs.ContainsKey("__warmup__"))
                        {
                            _inMemoryPrintDocs["__warmup__"] = new UTF8Encoding(true).GetBytes(
                                "<!doctype html><html dir=\"rtl\"><head><meta charset=\"utf-8\"><style>@page{margin:0}body{margin:0}</style></head><body></body></html>"
                            );
                        }
                    }

                    _warmPrintForm = new Form();
                    _warmPrintForm.FormBorderStyle = FormBorderStyle.None;
                    _warmPrintForm.ShowInTaskbar = false;
                    _warmPrintForm.StartPosition = FormStartPosition.Manual;
                    _warmPrintForm.Location = new Point(-32000, -32000);
                    _warmPrintForm.Size = new Size(viewportWidth, viewportHeight);

                    _warmPrintBrowser = new WebBrowser();
                    _warmPrintBrowser.Dock = DockStyle.Fill;
                    _warmPrintBrowser.Width = viewportWidth;
                    _warmPrintBrowser.Height = viewportHeight;
                    _warmPrintBrowser.ScrollBarsEnabled = false;
                    _warmPrintBrowser.ScriptErrorsSuppressed = true;
                    _warmPrintForm.Controls.Add(_warmPrintBrowser);

                    IntPtr formHandle = _warmPrintForm.Handle;
                    IntPtr browserHandle = _warmPrintBrowser.Handle;
                    _warmPrintBrowser.Navigate(string.Format("http://127.0.0.1:{0}/internal/print-doc?id=__warmup__", Port));
                }
                else if (_warmPrintForm.Width != viewportWidth || _warmPrintForm.Height != viewportHeight)
                {
                    _warmPrintForm.Size = new Size(viewportWidth, viewportHeight);
                    _warmPrintBrowser.Width = viewportWidth;
                    _warmPrintBrowser.Height = viewportHeight;
                }
                return _warmPrintBrowser;
            }
            catch
            {
                return null;
            }
        }

        private static void FlushPendingPrintRestoreImmediate()
        {
            if (_postPrintRestoreTimer != null)
            {
                try { _postPrintRestoreTimer.Stop(); } catch {}
                try { _postPrintRestoreTimer.Dispose(); } catch {}
                _postPrintRestoreTimer = null;
            }
            if (_pendingRestorePageSetup != null)
            {
                try { RestoreWindowsPrintPageSetup(_pendingRestorePageSetup); } catch {}
                _pendingRestorePageSetup = null;
            }
            if (_pendingRestoreDefaultPrinter != null)
            {
                try { SetDefaultPrinter(_pendingRestoreDefaultPrinter); } catch {}
                _pendingRestoreDefaultPrinter = null;
            }
        }

        private static string PrintHtmlOnWindowsPrinter(string html, string printerName, int viewportWidth, int viewportHeight = 1100)
        {
            string error = null;
            string docId = Guid.NewGuid().ToString("N");
            byte[] utf8HtmlBytes = new UTF8Encoding(true).GetBytes(html);
            lock (PrintDocLock)
            {
                _inMemoryPrintDocs[docId] = utf8HtmlBytes;
            }

            MethodInvoker doPrint = delegate()
            {
                string previousDefault = null;
                bool switchedDefaultPrinter = false;
                Form transientForm = null;
                WebBrowser transientBrowser = null;
                Dictionary<string, object> savedPageSetup = null;
                bool printDispatched = false;
                try
                {
                    // If a previous job's deferred restore is still pending on the STA thread,
                    // finalize it first so we capture the true user default printer & PageSetup.
                    FlushPendingPrintRestoreImmediate();

                    previousDefault = GetFastDefaultPrinterName();
                    if (!string.Equals(printerName, previousDefault, StringComparison.OrdinalIgnoreCase))
                    {
                        if (!SetDefaultPrinter(printerName))
                        {
                            error = "تعذر تعيين الطابعة الافتراضية: " + printerName;
                            return;
                        }
                        switchedDefaultPrinter = true;
                    }

                    savedPageSetup = ApplyWindowsPrintPageSetup();

                    bool useSharedWarmHost = (_uiDispatcher != null && !_uiDispatcher.InvokeRequired);
                    WebBrowser browser = useSharedWarmHost ? EnsureWarmPrintBrowser(viewportWidth, viewportHeight) : null;
                    if (browser == null)
                    {
                        transientForm = new Form();
                        transientForm.FormBorderStyle = FormBorderStyle.None;
                        transientForm.ShowInTaskbar = false;
                        transientForm.StartPosition = FormStartPosition.Manual;
                        transientForm.Location = new Point(-32000, -32000);
                        transientForm.Size = new Size(viewportWidth, viewportHeight);

                        transientBrowser = new WebBrowser();
                        transientBrowser.Dock = DockStyle.Fill;
                        transientBrowser.Width = viewportWidth;
                        transientBrowser.Height = viewportHeight;
                        transientBrowser.ScrollBarsEnabled = false;
                        transientBrowser.ScriptErrorsSuppressed = true;
                        transientForm.Controls.Add(transientBrowser);

                        IntPtr formHandle = transientForm.Handle;
                        IntPtr handle = transientBrowser.Handle;
                        browser = transientBrowser;
                    }

                    string ramUrl = string.Format("http://127.0.0.1:{0}/internal/print-doc?id={1}", Port, docId);
                    browser.Navigate(ramUrl);

                    // Zero Thread.Sleep on the STA thread: Thread.Sleep(1..15) blocks for a full
                    // 15.6ms Windows clock tick and stalls ieframe.dll itself. Yielding CPU slices
                    // while pumping DoEvents completes loopback RAM navigation in ~1-3ms!
                    DateTime loadDeadline = DateTime.UtcNow.AddSeconds(20);
                    while (browser.ReadyState != WebBrowserReadyState.Complete || browser.IsBusy)
                    {
                        if (DateTime.UtcNow > loadDeadline)
                        {
                            error = "انتهت مهلة تجهيز قالب الطباعة (20 ثانية)";
                            return;
                        }
                        Application.DoEvents();
                        Thread.Yield();
                    }

                    // One synchronous layout flush without sleeping the STA thread.
                    Application.DoEvents();

                    browser.Print();
                    Application.DoEvents();
                    printDispatched = true;

                    // When running on a transient fallback thread (not the persistent _uiDispatcher),
                    // pump briefly before the thread exits; on _uiDispatcher, Application.Run()
                    // pumps Win32 messages continuously at native C++ speed with 0ms sleep!
                    if (!useSharedWarmHost)
                    {
                        DateTime fallbackUntil = DateTime.UtcNow.AddMilliseconds(150);
                        while (DateTime.UtcNow < fallbackUntil)
                        {
                            Application.DoEvents();
                            Thread.Yield();
                        }
                    }
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                }
                finally
                {
                    if (printDispatched && (_uiDispatcher != null && !_uiDispatcher.InvokeRequired))
                    {
                        // Defer PageSetup & DefaultPrinter restore for 250ms on the non-blocking
                        // WinForms UI timer so HTTP 200 returns immediately and Application.Run()
                        // feeds ieframe.dll -> winspool.drv at full native speed.
                        _pendingRestorePageSetup = savedPageSetup;
                        _pendingRestoreDefaultPrinter = switchedDefaultPrinter ? previousDefault : null;
                        _postPrintRestoreTimer = new System.Windows.Forms.Timer();
                        _postPrintRestoreTimer.Interval = 250;
                        _postPrintRestoreTimer.Tick += delegate(object s, EventArgs ev)
                        {
                            FlushPendingPrintRestoreImmediate();
                        };
                        _postPrintRestoreTimer.Start();
                    }
                    else
                    {
                        try { if (savedPageSetup != null) RestoreWindowsPrintPageSetup(savedPageSetup); } catch {}
                        try
                        {
                            if (switchedDefaultPrinter && previousDefault != null)
                            {
                                SetDefaultPrinter(previousDefault);
                            }
                        }
                        catch {}
                    }

                    WebBrowser browserToDispose = transientBrowser;
                    Form formToDispose = transientForm;
                    string idToRemove = docId;
                    System.Windows.Forms.Timer cleanupTimer = new System.Windows.Forms.Timer();
                    cleanupTimer.Interval = 4000;
                    cleanupTimer.Tick += delegate(object s, EventArgs ev)
                    {
                        cleanupTimer.Stop();
                        cleanupTimer.Dispose();
                        try { if (browserToDispose != null) browserToDispose.Dispose(); } catch {}
                        try { if (formToDispose != null) formToDispose.Dispose(); } catch {}
                        lock (PrintDocLock)
                        {
                            _inMemoryPrintDocs.Remove(idToRemove);
                        }
                    };
                    cleanupTimer.Start();
                }
            };

            if (_uiDispatcher != null && _uiDispatcher.IsHandleCreated)
            {
                _uiDispatcher.Invoke(doPrint);
            }
            else
            {
                ManualResetEvent done = new ManualResetEvent(false);
                Thread sta = new Thread(delegate()
                {
                    try { doPrint(); } finally { done.Set(); }
                });
                sta.SetApartmentState(ApartmentState.STA);
                sta.IsBackground = true;
                sta.Start();
                bool finished = done.WaitOne(TimeSpan.FromSeconds(60));
                if (!finished && error == null)
                {
                    error = "انتهت مهلة الطباعة (60 ثانية) ولم تكتمل الطباعة";
                }
            }
            return error;
        }
    }
}
