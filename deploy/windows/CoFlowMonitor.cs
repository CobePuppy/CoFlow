using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using System.ComponentModel;
using System.Management;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

internal sealed class CoFlowMonitor : Form
{
    readonly string root;
    readonly Label summary = new Label(), details = new Label(), stamp = new Label();
    readonly TextBox logs = new TextBox();
    readonly Timer timer = new Timer();
    readonly BackgroundWorker worker = new BackgroundWorker();
    string lastState = "";
    int failures;
    sealed class Snapshot
    {
        public bool healthy, database;
        public string state, details, logs;
    }
    CoFlowMonitor(string directory)
    {
        root = Path.GetFullPath(directory);
        Text = "CoFlow 服务器监控台";
        Size = new Size(1060, 760); MinimumSize = new Size(850, 620);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Microsoft YaHei UI", 10);
        BackColor = Color.FromArgb(242, 245, 249);
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(22), ColumnCount = 1, RowCount = 6 };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 108));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 45));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
        summary.Dock = DockStyle.Fill; summary.Font = new Font(Font.FontFamily, 21, FontStyle.Bold); summary.Text = "正在检查服务…";
        details.Dock = DockStyle.Fill; details.Font = new Font(Font.FontFamily, 10); details.Text = root;
        layout.Controls.Add(summary, 0, 0); layout.Controls.Add(details, 0, 1);
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill };
        AddButton(buttons, "立即刷新", delegate { RefreshStatus(); });
        AddButton(buttons, "打开网站", delegate { Open(Website()); });
        AddButton(buttons, "打开安装目录", delegate { Open(root); });
        AddButton(buttons, "打开日志目录", delegate { Open(Path.Combine(root, "updates")); });
        layout.Controls.Add(buttons, 0, 2);
        layout.Controls.Add(new Label { Text = "最近日志 · API 标准输出 / 错误 / PostgreSQL（仅展示尾部）", Dock = DockStyle.Fill }, 0, 3);
        logs.Multiline = true; logs.ReadOnly = true; logs.ScrollBars = ScrollBars.Both; logs.WordWrap = false;
        logs.Dock = DockStyle.Fill; logs.Font = new Font("Consolas", 10); logs.BackColor = Color.FromArgb(23, 31, 45); logs.ForeColor = Color.FromArgb(224, 232, 242);
        layout.Controls.Add(logs, 0, 4); stamp.Dock = DockStyle.Fill; layout.Controls.Add(stamp, 0, 5);
        Controls.Add(layout);
        worker.DoWork += delegate(object sender, DoWorkEventArgs e) { e.Result = Inspect(root); };
        worker.RunWorkerCompleted += delegate(object sender, RunWorkerCompletedEventArgs e) {
            if (IsDisposed) return;
            if (e.Error != null) { summary.Text = "监控检查失败"; summary.ForeColor = Color.Firebrick; stamp.Text = e.Error.Message; return; }
            var s = (Snapshot)e.Result;
            failures = s.healthy ? 0 : failures + 1;
            summary.Text = s.state; summary.ForeColor = s.healthy ? Color.FromArgb(18, 123, 79) : Color.Firebrick;
            details.Text = s.details;
            if (logs.Text != s.logs) { logs.Text = s.logs; logs.SelectionStart = logs.TextLength; logs.ScrollToCaret(); }
            stamp.Text = "更新于 " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  ·  每 3 秒自动刷新  ·  连续异常 " + failures + " 次";
            if (lastState != s.state) { lastState = s.state; Text = "CoFlow 监控台 · " + s.state; }
        };
        timer.Interval = 3000; timer.Tick += delegate { RefreshStatus(); };
        Shown += delegate { timer.Start(); RefreshStatus(); };
        FormClosed += delegate { timer.Stop(); timer.Dispose(); };
    }
    void AddButton(FlowLayoutPanel panel, string text, Action action)
    {
        var button = new Button { Text = text, AutoSize = true, Height = 32, Margin = new Padding(0, 0, 12, 0) };
        button.Click += delegate { try { action(); } catch (Exception e) { MessageBox.Show(e.Message, "CoFlow"); } }; panel.Controls.Add(button);
    }
    void RefreshStatus() { if (!worker.IsBusy) worker.RunWorkerAsync(); }
    static void Open(string target) { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); }
    static string Config(string root, string key, string fallback)
    {
        string file = Path.Combine(root, ".env");
        if (!File.Exists(file)) return fallback;
        foreach (string line in File.ReadAllLines(file)) {
            var match = Regex.Match(line, @"^\s*" + Regex.Escape(key) + @"\s*=\s*(.*)$");
            if (match.Success) return match.Groups[1].Value.Trim().Trim('"', '\'');
        }
        return fallback;
    }
    string Website() { return Config(root, "APP_ORIGIN", "http://127.0.0.1:" + Port(root)); }
    static int Port(string root) { int port; return int.TryParse(Config(root, "PORT", "3001"), out port) && port > 0 && port < 65536 ? port : 3001; }
    static string Http(string url)
    {
        var req = (HttpWebRequest)WebRequest.Create(url); req.Proxy = null; req.Timeout = 1800; req.ReadWriteTimeout = 1800;
        using (var res = req.GetResponse()) using (var reader = new StreamReader(res.GetResponseStream())) return reader.ReadToEnd();
    }
    static bool Tcp(string host, int port)
    {
        using (var client = new TcpClient()) {
            var pending = client.BeginConnect(host, port, null, null);
            using (pending.AsyncWaitHandle) { if (!pending.AsyncWaitHandle.WaitOne(900)) return false; }
            try { client.EndConnect(pending); return client.Connected; } catch { return false; }
        }
    }
    static Snapshot Inspect(string root)
    {
        var result = new Snapshot(); var serializer = new JavaScriptSerializer();
        int port = Port(root); string url = "http://127.0.0.1:" + port;
        string healthError = ""; var watch = Stopwatch.StartNew();
        try { var health = serializer.DeserializeObject(Http(url + "/api/v1/health")) as System.Collections.Generic.Dictionary<string, object>; result.healthy = health != null && health.ContainsKey("ok") && health["ok"] is bool && (bool)health["ok"]; }
        catch (Exception e) { healthError = e.Message; }
        watch.Stop();
        string version = "未知";
        try { var release = serializer.DeserializeObject(File.ReadAllText(Path.Combine(root, "apps/web/dist/release.json"))) as System.Collections.Generic.Dictionary<string, object>; version = Convert.ToString(release["id"]); } catch {}
        try { var db = new Uri(Config(root, "DATABASE_URL", "")); result.database = Tcp(db.Host, db.Port > 0 ? db.Port : 5432); } catch {}
        string processText = "未找到本实例 API 进程";
        int count = 0;
        try {
            using (var search = new ManagementObjectSearcher("SELECT ProcessId, ExecutablePath, CommandLine FROM Win32_Process WHERE Name='node.exe'"))
            using (var items = search.Get()) foreach (ManagementObject item in items) using (item) {
                string exe = Convert.ToString(item["ExecutablePath"]), command = Convert.ToString(item["CommandLine"]);
                if (!string.Equals(exe, Path.GetFullPath(Path.Combine(root, "runtime/node.exe")), StringComparison.OrdinalIgnoreCase) || !Regex.IsMatch(command, @"apps[\\/]api[\\/]dist[\\/]main\.js")) continue;
                using (var p = Process.GetProcessById(Convert.ToInt32(item["ProcessId"]))) {
                    count++; var uptime = DateTime.Now - p.StartTime;
                    processText = "PID " + p.Id + "  ·  内存 " + (p.WorkingSet64 / 1048576) + " MB  ·  运行 " + (int)uptime.TotalDays + "天 " + uptime.ToString(@"hh\:mm\:ss");
                }
            }
        } catch (Exception e) { processText = "进程信息不可用：" + e.Message; }
        result.state = result.healthy ? "运行正常 · API 与数据库查询通过" : "服务异常 · " + (result.database ? "健康检查未通过" : "数据库端口不可达");
        if (count > 1) result.state += " · 检测到多个 API 进程";
        result.details = "本机端口 " + port + "  ·  健康检查 " + watch.ElapsedMilliseconds + " ms  ·  数据库 TCP " + (result.database ? "可连接" : "不可连接") + Environment.NewLine + processText + Environment.NewLine + "版本 " + version + Environment.NewLine + (result.healthy ? root : "诊断：" + healthError);
        var output = new StringBuilder();
        string updates = Path.Combine(root, "updates");
        foreach (string pattern in new[] { "*stdout.log", "*stderr.log" }) {
            try {
                var candidates = Directory.GetFiles(updates, pattern, SearchOption.AllDirectories).Where(f => !Path.GetFileName(f).StartsWith("pg-", StringComparison.OrdinalIgnoreCase)).OrderByDescending(File.GetLastWriteTimeUtc).Take(2);
                foreach (string file in candidates) output.AppendLine("--- " + file.Substring(root.Length).TrimStart('\\') + " ---").AppendLine(Tail(file));
            } catch (Exception e) { output.AppendLine("日志读取失败：" + e.Message); }
        }
        output.AppendLine("--- PostgreSQL ---").AppendLine(Tail(Path.Combine(root, ".data/postgres.log")));
        result.logs = Regex.Replace(output.ToString(), @"(?i)(postgres(?:ql)?://)[^\s]+", "$1[连接信息已隐藏]");
        result.logs = Regex.Replace(result.logs, @"(?im)((?:password|token|secret|api[_-]?key|SETTINGS_ENCRYPTION_KEY)\s*[=:]\s*)[^\s,;]+", "$1[已隐藏]");
        return result;
    }
    static string Tail(string file)
    {
        try {
            using (var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) {
                bool truncated = stream.Length > 12000; stream.Seek(Math.Max(0, stream.Length - 12000), SeekOrigin.Begin);
                using (var reader = new StreamReader(stream, Encoding.UTF8)) {
                    if (truncated) reader.ReadLine();
                    return string.Join(Environment.NewLine, reader.ReadToEnd().Split(new[] { '\n' }).Reverse().Take(24).Reverse());
                }
            }
        } catch (Exception e) { return "暂不可读：" + e.Message; }
    }
    [STAThread] static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        int index = Array.IndexOf(args, "--root"); if (index >= 0 && index + 1 < args.Length) root = args[index + 1];
        if (args.Contains("--check")) {
            var snapshot = Inspect(root);
            File.WriteAllText(Path.Combine(root, "updates/monitor-check.json"), new JavaScriptSerializer().Serialize(new { healthy = snapshot.healthy, database = snapshot.database, state = snapshot.state, details = snapshot.details }), Encoding.UTF8);
            return snapshot.healthy ? 0 : 1;
        }
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        index = Array.IndexOf(args, "--preview");
        if (index >= 0 && index + 1 < args.Length) {
            using (var form = new CoFlowMonitor(root)) {
                form.summary.Text = "CoFlow 服务器监控台";
                form.details.Text = "API 健康检查 · 数据库连接 · 进程 PID / 内存 / 运行时间\n每 3 秒自动刷新\n打开监控台即可连接现有服务，无需重复启动";
                form.logs.Text = "API 与 PostgreSQL 最近日志将在这里自动刷新。";
                form.stamp.Text = "关闭监控台不会停止服务器程序。";
                form.Show(); Application.DoEvents();
                using (var bitmap = new Bitmap(form.Width, form.Height)) { form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size)); bitmap.Save(args[index + 1]); }
            }
            return 0;
        }
        Application.Run(new CoFlowMonitor(root)); return 0;
    }
}
