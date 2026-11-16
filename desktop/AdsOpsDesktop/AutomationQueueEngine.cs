using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace AdsOpsDesktop;

public enum QueuePhase
{
    Idle,
    Running,
    Paused,
    NightPaused,
    Syncing,
    Completed,
}

public enum QueueKind
{
    KeepAlive,
    PageCreation,
}

public sealed record QueueTaskItem(
    string ViaId,
    string ViaLabel,
    string BrowserProfile,
    string NetworkLabel,
    string TargetUrl,
    string TaskTitle,
    string ViaTier,
    string ClientGroup = "",
    bool IsInSoakQuarantine = false,
    DateTimeOffset? CooldownUntilUtc = null,
    bool HasSiloConflict = false,
    string SiloConflictDetail = "");

public sealed record QueueSnapshot(
    QueuePhase Phase,
    QueueKind Kind,
    int CurrentIndex,
    int TotalCount,
    int LaunchedCount,
    int SkippedCount,
    int CountdownSeconds,
    int LastJitterSeconds,
    string CurrentViaLabel,
    string CurrentTaskTitle,
    bool CheckingProxy,
    string LastNotice);

/// <summary>Multi-Via safe automation queue runner with IP Cluster Guard, Proxy Pre-flight check, Human Jitter Rest &amp; Daytime Guard.</summary>
public sealed class AutomationQueueEngine : IDisposable
{
    private readonly Func<QueueTaskItem, Task<(bool Live, string Reason)>> _proxyPreCheck;
    private readonly Func<QueueTaskItem, Task> _launchChrome;
    private readonly Func<QueueKind, Task> _onQueueSync;
    private readonly Func<DateTime> _clockNow;
    private readonly Func<int>? _getActiveBrowserCount;
    private readonly Action<string> _log;
    private readonly Random _rng = new();
    private readonly object _gate = new();

    private CancellationTokenSource? _cts;
    private Task? _runnerTask;
    private List<QueueTaskItem> _items = new();
    private readonly List<QueueTaskItem> _launchedItems = new();
    private QueueSnapshot _snapshot = new(QueuePhase.Idle, QueueKind.KeepAlive, 0, 0, 0, 0, 0, 0, "", "", false, "");
    private readonly Dictionary<string, int> _proxyBatchUseCounts = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string> _proxyClientGroupOwners = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string> _profileClientGroupOwners = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string> _usedProfilesInBatch = new(StringComparer.OrdinalIgnoreCase);

    private int _baseStaggerSec = 48;
    private int _sameProxyMinStaggerSec = 55;
    private bool _preCheckProxy = true;
    private int _maxViasPerProxy = 4;
    private int _maxDirectIpVias = 3;
    private int _directIpBatchUseCount = 0;
    private string? _resumeFilePath;
    private int _maxConcurrentBrowsers = 6;
    private int _startHour = 8;
    private int _endHour = 22;
    private int _tickIntervalMs = 1000;
    private int _syncWaitSeconds = 22;
    private bool _enforceSoakQuarantine = true;
    private bool _enforceClientSilo = true;
    private bool _skipRequested;

    public event Action<QueueSnapshot>? SnapshotChanged;

    public AutomationQueueEngine(
        Func<QueueTaskItem, Task<(bool Live, string Reason)>> proxyPreCheck,
        Func<QueueTaskItem, Task> launchChrome,
        Func<QueueKind, Task> onQueueSync,
        Action<string> log,
        Func<DateTime>? clockNow = null,
        Func<int>? getActiveBrowserCount = null)
    {
        _proxyPreCheck = proxyPreCheck;
        _launchChrome = launchChrome;
        _onQueueSync = onQueueSync;
        _log = log;
        _clockNow = clockNow ?? (() => DateTime.Now);
        _getActiveBrowserCount = getActiveBrowserCount;
    }

    public QueueSnapshot Current => _snapshot;

    public IReadOnlyList<QueueTaskItem> LastLaunchedItems
    {
        get
        {
            lock (_gate)
            {
                return _launchedItems.ToList();
            }
        }
    }

    public void ConfigureTiming(int tickIntervalMs, int syncWaitSeconds)
    {
        _tickIntervalMs = Math.Clamp(tickIntervalMs, 10, 2000);
        _syncWaitSeconds = Math.Clamp(syncWaitSeconds, 1, 90);
    }

    public static string ExtractProxyHostPort(string? rawProxy)
    {
        var parsed = ExtensionProvisioner.ParseProxy(rawProxy);
        if (parsed != null && !string.IsNullOrEmpty(parsed.Host))
        {
            return $"{parsed.Host}:{parsed.Port}".ToLowerInvariant();
        }
        return (rawProxy ?? "").Trim().ToLowerInvariant();
    }

    public int ComputeHumanRestSeconds(int baseSeconds, out int jitterExtraSeconds)
    {
        if (baseSeconds <= 2)
        {
            jitterExtraSeconds = 0;
            return Math.Max(1, baseSeconds);
        }
        var minExtra = Math.Max(2, (int)Math.Round(baseSeconds * 0.12));
        var maxExtra = Math.Max(minExtra + 2, (int)Math.Round(baseSeconds * 0.28));
        jitterExtraSeconds = _rng.Next(minExtra, maxExtra + 1);
        return baseSeconds + jitterExtraSeconds;
    }

    public static List<QueueTaskItem> InterleaveByProxy(IReadOnlyList<QueueTaskItem> items)
    {
        if (items == null || items.Count <= 1) return items?.ToList() ?? new List<QueueTaskItem>();
        var bucketOrder = new List<string>();
        var buckets = new Dictionary<string, Queue<QueueTaskItem>>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in items)
        {
            var key = ExtractProxyHostPort(item.NetworkLabel);
            if (!buckets.TryGetValue(key, out var q))
            {
                q = new Queue<QueueTaskItem>();
                buckets[key] = q;
                bucketOrder.Add(key);
            }
            q.Enqueue(item);
        }

        var result = new List<QueueTaskItem>(items.Count);
        while (result.Count < items.Count)
        {
            foreach (var key in bucketOrder)
            {
                if (buckets[key].Count > 0)
                {
                    result.Add(buckets[key].Dequeue());
                }
            }
        }
        return result;
    }

    public void StartQueue(
        QueueKind kind,
        IReadOnlyList<QueueTaskItem> items,
        int baseStaggerSeconds,
        bool preCheckProxy,
        int maxViasPerProxy = 4,
        int daytimeStartHour = 8,
        int daytimeEndHour = 22,
        bool enforceDaytimeWindow = true,
        bool enforceSoakQuarantine = false,
        bool enforceClientSilo = false,
        bool interleaveByProxy = false,
        int sameProxyMinStaggerSeconds = 55,
        int maxConcurrentBrowsers = 6,
        int maxDirectIpVias = 3,
        string? resumeStateFilePath = null)
    {
        if (items == null || items.Count == 0) return;

        Stop();

        _items = interleaveByProxy ? InterleaveByProxy(items) : items.ToList();
        _baseStaggerSec = Math.Max(1, baseStaggerSeconds);
        _sameProxyMinStaggerSec = Math.Clamp(sameProxyMinStaggerSeconds, 15, 300);
        _preCheckProxy = preCheckProxy;
        _maxViasPerProxy = Math.Max(1, maxViasPerProxy);
        _maxDirectIpVias = Math.Clamp(maxDirectIpVias, 1, 20);
        _directIpBatchUseCount = 0;
        _resumeFilePath = resumeStateFilePath;
        _maxConcurrentBrowsers = Math.Clamp(maxConcurrentBrowsers, 1, 30);
        _startHour = Math.Clamp(daytimeStartHour, 0, 23);
        _endHour = Math.Clamp(daytimeEndHour, 0, 23);
        _enforceSoakQuarantine = enforceSoakQuarantine;
        _enforceClientSilo = enforceClientSilo;
        _proxyBatchUseCounts.Clear();
        _proxyClientGroupOwners.Clear();
        _profileClientGroupOwners.Clear();
        _usedProfilesInBatch.Clear();
        lock (_gate)
        {
            _launchedItems.Clear();
        }
        _skipRequested = false;

        _cts = new CancellationTokenSource();
        var token = _cts.Token;
        UpdateSnapshot(new QueueSnapshot(
            QueuePhase.Running,
            kind,
            0,
            _items.Count,
            0,
            0,
            0,
            0,
            _items[0].ViaLabel,
            _items[0].TaskTitle,
            false,
            $"Bắt đầu hàng đợi {items.Count} Via..."));

        _runnerTask = Task.Run(() => RunLoopAsync(kind, enforceDaytimeWindow, token), token);
    }

    public void Pause()
    {
        lock (_gate)
        {
            if (_snapshot.Phase == QueuePhase.Running)
            {
                UpdateSnapshot(_snapshot with { Phase = QueuePhase.Paused, LastNotice = "Đã tạm dừng hàng đợi." });
            }
        }
    }

    public void Resume()
    {
        lock (_gate)
        {
            if (_snapshot.Phase == QueuePhase.Paused)
            {
                UpdateSnapshot(_snapshot with { Phase = QueuePhase.Running, LastNotice = "Đã tiếp tục hàng đợi." });
            }
        }
    }

    public void SkipCurrentWait()
    {
        _skipRequested = true;
    }

    public void Stop()
    {
        try { _cts?.Cancel(); } catch { }
        try { _runnerTask?.Wait(800); } catch { }
        _cts?.Dispose();
        _cts = null;
        _runnerTask = null;
        UpdateSnapshot(new QueueSnapshot(QueuePhase.Idle, _snapshot.Kind, 0, 0, 0, 0, 0, 0, "", "", false, "Đã dừng hàng đợi."));
    }

    private async Task RunLoopAsync(QueueKind kind, bool enforceDaytimeWindow, CancellationToken ct)
    {
        int launched = 0;
        int skipped = 0;

        for (int i = 0; i < _items.Count && !ct.IsCancellationRequested; i++)
        {
            while (!ct.IsCancellationRequested && _snapshot.Phase == QueuePhase.Paused)
            {
                await Task.Delay(Math.Min(300, _tickIntervalMs), ct).ConfigureAwait(false);
            }
            if (ct.IsCancellationRequested) break;

            if (enforceDaytimeWindow && _items.Count >= 3 && kind == QueueKind.PageCreation && _baseStaggerSec >= 300)
            {
                while (!ct.IsCancellationRequested && IsOutsideDaytimeWindow(_clockNow()))
                {
                    UpdateSnapshot(_snapshot with
                    {
                        Phase = QueuePhase.NightPaused,
                        CurrentIndex = i,
                        CurrentViaLabel = _items[i].ViaLabel,
                        CurrentTaskTitle = _items[i].TaskTitle,
                        LastNotice = $"Tạm nghỉ ban đêm (chỉ chạy {_startHour:00}:00–{_endHour:00}:30).",
                    });
                    await Task.Delay(Math.Min(2000, _tickIntervalMs * 2), ct).ConfigureAwait(false);
                }
            }

            var item = _items[i];
            var hostPort = ExtractProxyHostPort(item.NetworkLabel);
            var itemClientGroup = (item.ClientGroup ?? "").Trim();
            var itemProfile = (item.BrowserProfile ?? "").Trim();

            // Guard A: Cooldown 24h freeze after Safety Challenge or IP Leak Kill-Switch
            if (item.CooldownUntilUtc.HasValue && item.CooldownUntilUtc.Value > DateTimeOffset.UtcNow)
            {
                skipped++;
                var msg = $"Bỏ qua «{item.ViaLabel}»: Đang đóng băng Cooldown an toàn đến {item.CooldownUntilUtc.Value.ToLocalTime():dd/MM HH:mm}.";
                _log($"❄️ {msg}");
                UpdateSnapshot(_snapshot with
                {
                    Phase = QueuePhase.Running,
                    CurrentIndex = i,
                    LaunchedCount = launched,
                    SkippedCount = skipped,
                    CurrentViaLabel = item.ViaLabel,
                    CurrentTaskTitle = item.TaskTitle,
                    CheckingProxy = false,
                    LastNotice = msg,
                });
                continue;
            }

            // Guard B: 72h New-Device / New-Proxy Soak Quarantine (blocks batch PageCreation, permits KeepAlive soak)
            if (_enforceSoakQuarantine && kind == QueueKind.PageCreation && item.IsInSoakQuarantine)
            {
                skipped++;
                var msg = $"Bỏ qua Tạo Page «{item.ViaLabel}»: Đang ngâm thiết bị mới 72h (chỉ cho phép Đảo Ấm thụ động).";
                _log($"🛡️ {msg}");
                UpdateSnapshot(_snapshot with
                {
                    Phase = QueuePhase.Running,
                    CurrentIndex = i,
                    LaunchedCount = launched,
                    SkippedCount = skipped,
                    CurrentViaLabel = item.ViaLabel,
                    CurrentTaskTitle = item.TaskTitle,
                    CheckingProxy = false,
                    LastNotice = msg,
                });
                continue;
            }

            // Universal Duplicate Chrome Profile Guard (prevents cookie overwrite even within same ClientGroup)
            if (!string.IsNullOrEmpty(itemProfile) &&
                _usedProfilesInBatch.TryGetValue(itemProfile, out var prevViaForProf))
            {
                skipped++;
                var msg = $"Bỏ qua «{item.ViaLabel}»: Hồ sơ Chrome «{itemProfile}» đã mở cho «{prevViaForProf}» trong lô (chống đè Cookie).";
                _log($"🛑 {msg}");
                UpdateSnapshot(_snapshot with
                {
                    Phase = QueuePhase.Running,
                    CurrentIndex = i,
                    LaunchedCount = launched,
                    SkippedCount = skipped,
                    CurrentViaLabel = item.ViaLabel,
                    CurrentTaskTitle = item.TaskTitle,
                    CheckingProxy = false,
                    LastNotice = msg,
                });
                continue;
            }

            // Guard C: Multi-Client Silo Isolation (forbid cross-client proxy/profile collisions)
            if (_enforceClientSilo)
            {
                string siloViolation = item.HasSiloConflict
                    ? (string.IsNullOrWhiteSpace(item.SiloConflictDetail) ? "Xung đột cách ly Silo khách hàng." : item.SiloConflictDetail)
                    : "";

                if (string.IsNullOrEmpty(siloViolation) &&
                    !string.IsNullOrEmpty(hostPort) &&
                    _proxyClientGroupOwners.TryGetValue(hostPort, out var prevProxyClient) &&
                    !string.Equals(prevProxyClient, itemClientGroup, StringComparison.OrdinalIgnoreCase) &&
                    (!string.IsNullOrEmpty(prevProxyClient) || !string.IsNullOrEmpty(itemClientGroup)))
                {
                    var peerDesc = string.IsNullOrEmpty(prevProxyClient) ? "(Chưa gắn Silo)" : $"Khách {prevProxyClient}";
                    siloViolation = $"Proxy {hostPort} đã dùng cho {peerDesc} trong lô.";
                }

                if (string.IsNullOrEmpty(siloViolation) &&
                    !string.IsNullOrEmpty(itemProfile) &&
                    _profileClientGroupOwners.TryGetValue(itemProfile, out var prevProfClient) &&
                    !string.Equals(prevProfClient, itemClientGroup, StringComparison.OrdinalIgnoreCase) &&
                    (!string.IsNullOrEmpty(prevProfClient) || !string.IsNullOrEmpty(itemClientGroup)))
                {
                    var peerDesc = string.IsNullOrEmpty(prevProfClient) ? "(Chưa gắn Silo)" : $"Khách {prevProfClient}";
                    siloViolation = $"Chrome Profile «{itemProfile}» đã dùng cho {peerDesc} trong lô.";
                }

                if (!string.IsNullOrEmpty(siloViolation))
                {
                    skipped++;
                    var msg = $"Bỏ qua «{item.ViaLabel}» (Silo Guard): {siloViolation}";
                    _log($"🔒 {msg}");
                    UpdateSnapshot(_snapshot with
                    {
                        Phase = QueuePhase.Running,
                        CurrentIndex = i,
                        LaunchedCount = launched,
                        SkippedCount = skipped,
                        CurrentViaLabel = item.ViaLabel,
                        CurrentTaskTitle = item.TaskTitle,
                        CheckingProxy = false,
                        LastNotice = msg,
                    });
                    continue;
                }
            }

            if (!string.IsNullOrEmpty(hostPort) &&
                (kind == QueueKind.PageCreation || _items.Count > 1) &&
                _proxyBatchUseCounts.TryGetValue(hostPort, out var usedCount) &&
                usedCount >= _maxViasPerProxy)
            {
                skipped++;
                var msg = $"Bỏ qua «{item.ViaLabel}»: Proxy {hostPort} đã gánh {usedCount}/{_maxViasPerProxy} Via trong lô.";
                _log($"⚠️ {msg}");
                UpdateSnapshot(_snapshot with
                {
                    Phase = QueuePhase.Running,
                    CurrentIndex = i,
                    LaunchedCount = launched,
                    SkippedCount = skipped,
                    CurrentViaLabel = item.ViaLabel,
                    CurrentTaskTitle = item.TaskTitle,
                    CheckingProxy = false,
                    LastNotice = msg,
                });
                continue;
            }

            if (string.IsNullOrEmpty(hostPort) &&
                (kind == QueueKind.PageCreation || _items.Count > 1) &&
                _directIpBatchUseCount >= _maxDirectIpVias)
            {
                skipped++;
                var msg = $"Bỏ qua «{item.ViaLabel}»: Mạng gốc (Direct IP) đã mở tối đa {_directIpBatchUseCount}/{_maxDirectIpVias} Via trong ca này (chống liên đới IP). Hãy gắn Proxy Dân cư.";
                _log($"⚠️ {msg}");
                UpdateSnapshot(_snapshot with
                {
                    Phase = QueuePhase.Running,
                    CurrentIndex = i,
                    LaunchedCount = launched,
                    SkippedCount = skipped,
                    CurrentViaLabel = item.ViaLabel,
                    CurrentTaskTitle = item.TaskTitle,
                    CheckingProxy = false,
                    LastNotice = msg,
                });
                continue;
            }

            if (_preCheckProxy && !string.IsNullOrWhiteSpace(item.NetworkLabel))
            {
                UpdateSnapshot(_snapshot with
                {
                    Phase = QueuePhase.Running,
                    CurrentIndex = i,
                    LaunchedCount = launched,
                    SkippedCount = skipped,
                    CurrentViaLabel = item.ViaLabel,
                    CurrentTaskTitle = item.TaskTitle,
                    CheckingProxy = true,
                    LastNotice = $"Đang kiểm tra Proxy của {item.ViaLabel}...",
                });

                var (isLive, reason) = await _proxyPreCheck(item).ConfigureAwait(false);
                if (ct.IsCancellationRequested) break;

                if (!isLive)
                {
                    skipped++;
                    var skipMsg = $"Bỏ qua «{item.ViaLabel}»: Proxy lỗi ({reason}).";
                    _log($"🛑 {skipMsg}");
                    UpdateSnapshot(_snapshot with
                    {
                        Phase = QueuePhase.Running,
                        CurrentIndex = i,
                        LaunchedCount = launched,
                        SkippedCount = skipped,
                        CheckingProxy = false,
                        LastNotice = skipMsg,
                    });
                    continue;
                }
            }

            if (_getActiveBrowserCount != null && _maxConcurrentBrowsers > 0)
            {
                while (!ct.IsCancellationRequested && !_skipRequested)
                {
                    var activeCount = _getActiveBrowserCount();
                    if (activeCount < _maxConcurrentBrowsers) break;
                    UpdateSnapshot(_snapshot with
                    {
                        Phase = QueuePhase.Running,
                        CurrentIndex = i,
                        LaunchedCount = launched,
                        SkippedCount = skipped,
                        CurrentViaLabel = item.ViaLabel,
                        CurrentTaskTitle = item.TaskTitle,
                        CheckingProxy = false,
                        LastNotice = $"⏳ Chờ giải phóng RAM ({activeCount}/{_maxConcurrentBrowsers} trình duyệt đang mở)...",
                    });
                    await Task.Delay(Math.Min(1500, _tickIntervalMs * 2), ct).ConfigureAwait(false);
                }
                if (ct.IsCancellationRequested) break;
            }

            if (!string.IsNullOrEmpty(hostPort))
            {
                _proxyBatchUseCounts[hostPort] = _proxyBatchUseCounts.GetValueOrDefault(hostPort) + 1;
                if (!_proxyClientGroupOwners.ContainsKey(hostPort))
                {
                    _proxyClientGroupOwners[hostPort] = itemClientGroup;
                }
            }
            else
            {
                _directIpBatchUseCount++;
            }
            if (!string.IsNullOrEmpty(itemProfile))
            {
                _usedProfilesInBatch[itemProfile] = item.ViaLabel;
                if (!_profileClientGroupOwners.ContainsKey(itemProfile))
                {
                    _profileClientGroupOwners[itemProfile] = itemClientGroup;
                }
            }

            await _launchChrome(item).ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(item.ViaId))
            {
                QueueResumeStateStore.RecordItemLaunched(kind, item.ViaId, _resumeFilePath);
            }
            lock (_gate)
            {
                _launchedItems.Add(item);
            }
            launched++;

            if (i < _items.Count - 1)
            {
                var effectiveBase = _baseStaggerSec;
                var nextHostPort = ExtractProxyHostPort(_items[i + 1].NetworkLabel);
                if (_baseStaggerSec >= 15 &&
                    ((!string.IsNullOrEmpty(hostPort) && string.Equals(hostPort, nextHostPort, StringComparison.OrdinalIgnoreCase)) ||
                     (string.IsNullOrEmpty(hostPort) && string.IsNullOrEmpty(nextHostPort))))
                {
                    effectiveBase = Math.Max(_baseStaggerSec, _sameProxyMinStaggerSec);
                }
                var waitSec = ComputeHumanRestSeconds(effectiveBase, out var jitterExtra);
                _skipRequested = false;
                for (int rem = waitSec; rem > 0 && !ct.IsCancellationRequested && !_skipRequested; rem--)
                {
                    while (!ct.IsCancellationRequested && !_skipRequested && _snapshot.Phase == QueuePhase.Paused)
                    {
                        await Task.Delay(Math.Min(300, _tickIntervalMs), ct).ConfigureAwait(false);
                    }
                    UpdateSnapshot(_snapshot with
                    {
                        Phase = QueuePhase.Running,
                        CurrentIndex = i,
                        LaunchedCount = launched,
                        SkippedCount = skipped,
                        CountdownSeconds = rem,
                        LastJitterSeconds = jitterExtra,
                        CurrentViaLabel = item.ViaLabel,
                        CurrentTaskTitle = item.TaskTitle,
                        CheckingProxy = false,
                        LastNotice = $"Đã mở {item.ViaLabel} · Nghỉ an toàn {rem}s (+{jitterExtra}s jitter) trước Via tiếp.",
                    });
                    await Task.Delay(_tickIntervalMs, ct).ConfigureAwait(false);
                }
                _skipRequested = false;
            }
        }

        if (ct.IsCancellationRequested) return;

        if (launched > 0)
        {
            for (int rem = _syncWaitSeconds; rem > 0 && !ct.IsCancellationRequested; rem--)
            {
                UpdateSnapshot(_snapshot with
                {
                    Phase = QueuePhase.Syncing,
                    LaunchedCount = launched,
                    SkippedCount = skipped,
                    CountdownSeconds = rem,
                    CheckingProxy = false,
                    LastNotice = $"Đang chờ Chrome hoàn tất thao tác & đồng bộ Cloud ({rem}s)...",
                });
                await Task.Delay(_tickIntervalMs, ct).ConfigureAwait(false);
            }
            if (!ct.IsCancellationRequested)
            {
                try { await _onQueueSync(kind).ConfigureAwait(false); } catch { }
            }
        }

        QueueResumeStateStore.Clear(_resumeFilePath);
        UpdateSnapshot(_snapshot with
        {
            Phase = QueuePhase.Completed,
            LaunchedCount = launched,
            SkippedCount = skipped,
            CountdownSeconds = 0,
            CheckingProxy = false,
            LastNotice = $"Hoàn tất lô: đã mở {launched}/{_items.Count} Via (bỏ qua {skipped}).",
        });
    }

    private bool IsOutsideDaytimeWindow(DateTime localNow)
    {
        var mins = localNow.Hour * 60 + localNow.Minute;
        return mins < (_startHour * 60) || mins > (_endHour * 60 + 30);
    }

    private void UpdateSnapshot(QueueSnapshot next)
    {
        lock (_gate)
        {
            _snapshot = next;
        }
        SnapshotChanged?.Invoke(next);
    }

    public void Dispose()
    {
        Stop();
    }
}
