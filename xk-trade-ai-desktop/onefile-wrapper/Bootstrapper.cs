using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class Bootstrapper
{
    private const string Magic = "XKTAI001";
    private const int FooterSize = 16;

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string tempRoot = Path.Combine(Path.GetTempPath(), "XK-Trade-AI-OneFile-" + Guid.NewGuid().ToString("N"));
        try
        {
            string self = Process.GetCurrentProcess().MainModule.FileName;
            string zipPath = ExtractAppendedPayload(self, tempRoot);
            string installer = Path.Combine(tempRoot, "XK-Trade-AI-Setup.exe");
            string seedScript = Path.Combine(tempRoot, "Connect-Keys.bat");
            if (!File.Exists(installer) || !File.Exists(seedScript))
                throw new InvalidDataException("ملف التثبيت أو إعداد الاتصال غير موجود داخل الحزمة.");

            DialogResult start = MessageBox.Show(
                "سيتم تثبيت XK Trade AI ثم إعداد مفاتيح Finnhub وToken Harbor تلقائيًا على هذا الحساب.\n\nاضغط موافق للمتابعة.",
                "XK Trade AI — التثبيت المتكامل",
                MessageBoxButtons.OKCancel,
                MessageBoxIcon.Information);
            if (start != DialogResult.OK) return;

            Process install = Process.Start(new ProcessStartInfo
            {
                FileName = installer,
                UseShellExecute = true,
                WorkingDirectory = tempRoot
            });
            if (install == null) throw new InvalidOperationException("تعذر تشغيل مثبت Windows.");
            install.WaitForExit();

            string appExe = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", "XK Trade AI", "XK Trade AI.exe");
            if (!File.Exists(appExe))
                throw new FileNotFoundException("لم يُعثر على التطبيق في مسار التثبيت الافتراضي. أعد تشغيل ملف التثبيت واستخدم المسار الافتراضي.", appExe);

            string marker = Path.Combine(Path.GetTempPath(), "XK-Trade-AI-keys-installed.flag");
            try { if (File.Exists(marker)) File.Delete(marker); } catch {}
            Process seed = Process.Start(new ProcessStartInfo
            {
                FileName = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe",
                Arguments = "/d /c \"\"" + seedScript + "\""",
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = tempRoot
            });
            if (seed == null) throw new InvalidOperationException("تعذر تشغيل إعداد مفاتيح الخدمة.");
            seed.WaitForExit(35000);

            DateTime deadline = DateTime.UtcNow.AddSeconds(8);
            while (!File.Exists(marker) && DateTime.UtcNow < deadline) Thread.Sleep(250);
            if (File.Exists(marker))
            {
                try { File.Delete(marker); } catch {}
                MessageBox.Show(
                    "اكتمل التثبيت وإعداد المفاتيح. حُفظت المفاتيح مشفّرة محليًا في Windows.\n\nيمكنك الآن تشغيل XK Trade AI من سطح المكتب.",
                    "XK Trade AI — جاهز",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            else
            {
                MessageBox.Show(
                    "تم تثبيت التطبيق، لكن لم نتلقَّ تأكيدًا بأن إعداد المفاتيح اكتمل. افتح التطبيق وتحقق من حالة المفاتيح في الإعدادات.\n\nلم يتم عرض المفاتيح على الشاشة.",
                    "XK Trade AI — يلزم التحقق",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show("تعذر إكمال التثبيت.\n\n" + ex.Message, "XK Trade AI", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            try { if (Directory.Exists(tempRoot)) Directory.Delete(tempRoot, true); } catch {}
        }
    }

    private static string ExtractAppendedPayload(string exePath, string tempRoot)
    {
        using (FileStream source = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            if (source.Length < FooterSize) throw new InvalidDataException("ملف الحزمة غير مكتمل.");
            source.Position = source.Length - FooterSize;
            byte[] footer = new byte[FooterSize];
            ReadExactly(source, footer, 0, footer.Length);
            string magic = Encoding.ASCII.GetString(footer, 0, 8);
            if (magic != Magic) throw new InvalidDataException("هذه النسخة لا تحتوي على بيانات التثبيت المضمّنة.");

            long payloadLength = BitConverter.ToInt64(footer, 8);
            long start = source.Length - FooterSize - payloadLength;
            if (payloadLength <= 0 || payloadLength > 250L * 1024L * 1024L || start < 0)
                throw new InvalidDataException("حجم بيانات التثبيت غير صالح.");

            Directory.CreateDirectory(tempRoot);
            string zipPath = Path.Combine(tempRoot, "payload.zip");
            source.Position = start;
            using (FileStream output = new FileStream(zipPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                byte[] buffer = new byte[1024 * 128];
                long remaining = payloadLength;
                while (remaining > 0)
                {
                    int read = source.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
                    if (read <= 0) throw new EndOfStreamException("بيانات التثبيت مبتورة.");
                    output.Write(buffer, 0, read);
                    remaining -= read;
                }
            }
            ZipFile.ExtractToDirectory(zipPath, tempRoot);
            File.Delete(zipPath);
            return Path.Combine(tempRoot, "payload.zip");
        }
    }

    private static void ReadExactly(Stream stream, byte[] buffer, int offset, int count)
    {
        while (count > 0)
        {
            int read = stream.Read(buffer, offset, count);
            if (read <= 0) throw new EndOfStreamException("تعذر قراءة نهاية ملف الحزمة.");
            offset += read;
            count -= read;
        }
    }
}