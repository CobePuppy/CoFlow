using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

internal static class CoFlowLauncher
{
    static string Root = AppDomain.CurrentDomain.BaseDirectory;
    static string LocalUrl()
    {
        string port = "8080";
        string env = Path.Combine(Root, ".env");
        if (File.Exists(env))
            foreach (string line in File.ReadAllLines(env))
                if (line.StartsWith("PORT=")) port = line.Substring(5).Trim().Trim('"', '\'');
        int number;
        if (!int.TryParse(port, out number) || number < 1 || number > 65535) port = "8080";
        return "http://127.0.0.1:" + port;
    }
    static bool Ready(string url)
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(url + "/api/v1/health");
            request.Timeout = 1500;
            using (var response = (HttpWebResponse)request.GetResponse())
                return response.StatusCode == HttpStatusCode.OK;
        }
        catch { return false; }
    }
    static void OpenBrowser(string url)
    {
        string config = Path.Combine(Root, ".env");
        if (File.Exists(config))
            foreach (string line in File.ReadAllLines(config))
                if (line.StartsWith("APP_ORIGIN="))
                {
                    Uri address;
                    string configured = line.Substring(11).Trim().Trim('"', '\'');
                    if (Uri.TryCreate(configured, UriKind.Absolute, out address) &&
                        (address.Scheme == "http" || address.Scheme == "https")) url = configured;
                }
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch { Console.WriteLine("请在浏览器访问：" + url); }
    }
    static int Main()
    {
        Console.OutputEncoding = Encoding.UTF8;
        Console.Title = "汇流 CoFlow";
        Directory.SetCurrentDirectory(Root);
        bool owns;
        using (var mutex = new Mutex(true, "Local\\CoFlowServerLauncher", out owns))
        {
            if (!owns)
            {
                if (Ready(LocalUrl())) OpenBrowser(LocalUrl());
                else Console.WriteLine("CoFlow 正在另一个窗口中初始化或启动，请查看该窗口。");
                return 0;
            }
            try
            {
                if (Ready(LocalUrl())) { OpenBrowser(LocalUrl()); return 0; }
                string script = File.Exists(Path.Combine(Root, ".env"))
                    ? "deploy\\windows\\Start-CoFlow.ps1" : "Install-From-Package.ps1";
                string path = Path.Combine(Root, script);
                if (!File.Exists(path)) throw new FileNotFoundException("缺少启动文件，请把 CoFlow.exe 放在完整部署目录中。", path);
                Console.WriteLine("汇流 CoFlow\n首次使用请按提示设置管理员账号；启动完成后将自动打开浏览器。\n运行期间请保持此窗口打开。\n");
                using (var process = Process.Start(new ProcessStartInfo("powershell.exe",
                    "-NoLogo -NoProfile -ExecutionPolicy Bypass -File \"" + path + "\"")
                    { UseShellExecute = false, WorkingDirectory = Root }))
                {
                    while (!process.WaitForExit(1000))
                    {
                        if (Ready(LocalUrl())) { OpenBrowser(LocalUrl()); break; }
                    }
                    process.WaitForExit();
                    Console.WriteLine("\nCoFlow 已停止，退出码：" + process.ExitCode);
                    Console.WriteLine("如有报错，请保留上面的信息。按回车关闭。");
                    Console.ReadLine();
                    return process.ExitCode;
                }
            }
            catch (Exception error)
            {
                Console.WriteLine("启动失败：" + error.Message + "\n按回车关闭。");
                Console.ReadLine();
                return 1;
            }
            finally { mutex.ReleaseMutex(); }
        }
    }
}
