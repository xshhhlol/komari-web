import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DropdownMenu, Switch } from "@radix-ui/themes";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  ListFilter,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import NodeSelector from "@/components/NodeSelector";
import { GroupFilterPills } from "@/components/admin/GroupFilterPills";
import {
  NodeDetailsProvider,
  useNodeDetails,
  type NodeDetail,
} from "@/contexts/NodeDetailsContext";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import {
  GROUP_ALL,
  GROUP_UNGROUPED,
  getGroups,
  orderGroups,
} from "@/utils/nodeGroups";
import {
  nodeMatchesKeywords,
  parseKeywords,
  pasteAsKeywords,
} from "@/utils/nodeSearch";

type Result = {
  client: string;
  result: string;
  exit_code: number | null;
  created_at: string;
  finished_at: string | null;
};
type Benchmark = { task_id: string; results: Result[] };
type Row = Result & { task: string };

type Settings = {
  hardware: "y" | "f" | "v" | "n";
  ip: boolean;
  network: "y" | "l" | "n";
  backroute: boolean;
};

type StatusKind = "all" | "run" | "ok" | "warn" | "err";

const defaults: Settings = {
  hardware: "f",
  ip: true,
  network: "y",
  backroute: false,
};

const HARDWARE_OPTIONS: { value: Settings["hardware"]; label: string }[] = [
  { value: "f", label: "快速" },
  { value: "y", label: "标准" },
  { value: "v", label: "深度" },
  { value: "n", label: "关闭" },
];

const NETWORK_OPTIONS: { value: Settings["network"]; label: string }[] = [
  { value: "y", label: "标准" },
  { value: "l", label: "低流量" },
  { value: "n", label: "关闭" },
];

const SECTION_LABELS: Record<string, string> = {
  "header_info.log": "基础信息",
  "hardware_quality.log": "硬件质量",
  "ip_quality.log": "IP 质量",
  "net_quality.log": "网络质量",
  "backroute_trace.log": "回程路由",
};

const clean = (s: string) =>
  s
    .replace(
      new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g"),
      ""
    )
    .replace(/\r/g, "");

const reportLink = (s: string) =>
  clean(s).match(/https:\/\/nodequality\.com\/r\/[A-Za-z0-9]+/)?.[0];

const formatDate = (s: string | null) =>
  s ? new Date(s).toLocaleString() : "—";

const formatDuration = (start: string, end: string | null) => {
  if (!end) return null;
  const sec = Math.max(
    0,
    Math.round((Date.parse(end) - Date.parse(start)) / 1000)
  );
  if (!Number.isFinite(sec)) return null;
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
};

const shortV6 = (ip: string) => {
  const segments = ip.split(":");
  return ip.length > 20 && segments.length > 3
    ? `${segments.slice(0, 2).join(":")}:…${segments[segments.length - 1]}`
    : ip;
};

const getStatusInfo = (
  r: Result
): { tone: Exclude<StatusKind, "all">; label: string } => {
  if (!r.finished_at) {
    return { tone: "run", label: "测评进行中" };
  }
  const hasEnd = r.result.includes("--- KOMARI NODEQUALITY REPORT END ---");
  if (hasEnd && (r.exit_code === 1 || r.exit_code === 0)) {
    if (r.result.includes("[结果文件缺失或为空]")) {
      return { tone: "warn", label: "报告不完整" };
    }
    if (reportLink(r.result)) {
      return { tone: "ok", label: "报告已生成" };
    }
    return { tone: "warn", label: "仅本地报告" };
  }
  return { tone: "err", label: "未完成" };
};

type ReportSection = { key: string; label: string; content: string };

const parseReportSections = (raw: string): ReportSection[] => {
  const text = clean(raw);
  const beginMarker = "--- KOMARI NODEQUALITY REPORT BEGIN ---";
  const endMarker = "--- KOMARI NODEQUALITY REPORT END ---";
  const bIdx = text.indexOf(beginMarker);
  const eIdx = text.indexOf(endMarker);

  const sections: ReportSection[] = [];
  if (bIdx !== -1 && eIdx !== -1 && eIdx > bIdx) {
    const body = text.slice(bIdx + beginMarker.length, eIdx);
    const re = /\n--- ([a-zA-Z0-9_.-]+) ---\n/g;
    const matches: { file: string; start: number; contentStart: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      matches.push({
        file: m[1],
        start: m.index,
        contentStart: m.index + m[0].length,
      });
    }
    for (let i = 0; i < matches.length; i++) {
      const cur = matches[i];
      const nextStart =
        i + 1 < matches.length ? matches[i + 1].start : body.length;
      const content = body.slice(cur.contentStart, nextStart).trim();
      sections.push({
        key: cur.file,
        label: SECTION_LABELS[cur.file] || cur.file,
        content: content || "（空）",
      });
    }
  }
  sections.push({
    key: "raw",
    label: sections.length > 0 ? "完整日志" : "输出内容",
    content: text.trim() || "等待节点输出…",
  });
  return sections;
};

const summarizeSettings = (s: Settings) => {
  const parts: string[] = [];
  const hw = HARDWARE_OPTIONS.find((o) => o.value === s.hardware)?.label;
  if (s.hardware !== "n" && hw) parts.push(`硬件(${hw})`);
  if (s.ip) parts.push("IP质量");
  const net = NETWORK_OPTIONS.find((o) => o.value === s.network)?.label;
  if (s.network !== "n" && net) parts.push(`网络(${net})`);
  if (s.backroute) parts.push("回程路由");
  return parts.length > 0 ? parts.join(" · ") : "未选测试项";
};

function BenchmarkContent() {
  const { nodeDetail } = useNodeDetails();
  const { publicInfo } = usePublicInfo();
  const [nodes, setNodes] = useState<string[]>([]);
  const [items, setItems] = useState<Benchmark[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<{
    task: string;
    client: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [twoFa, setTwoFa] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<Settings>(defaults);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>(GROUP_ALL);
  const [statusFilter, setStatusFilter] = useState<StatusKind>("all");

  const nodeMap = useMemo(
    () => new Map(nodeDetail.map((n) => [n.uuid, n])),
    [nodeDetail]
  );

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/task/benchmarks", {
        cache: "no-store",
      });
      const payload = await response.json();
      if (
        !response.ok ||
        payload.status !== "success" ||
        !Array.isArray(payload.data)
      )
        throw new Error(payload.message || "读取报告失败");
      setItems(payload.data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取报告失败");
    }
  }, []);

  useEffect(() => {
    void refresh();
    fetch("/api/admin/task/benchmark-settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.status === "success") setSettings(data.data);
      })
      .catch(() => toast.error("读取测评参数失败"));
    const timer = setInterval(() => void refresh(), 5000);
    fetch("/api/me")
      .then((r) => r.json())
      .then((data) => setTwoFa(Boolean(data?.["2fa_enabled"])))
      .catch(() => {});
    return () => clearInterval(timer);
  }, [refresh]);

  const start = async () => {
    if (!nodes.length || (twoFa && !code.trim())) return;
    setBusy(true);
    try {
      const commandResponse = await fetch("/api/admin/task/benchmark-command", {
        cache: "no-store",
      });
      const commandData = await commandResponse.json();
      if (!commandResponse.ok || commandData.status !== "success")
        throw new Error(commandData.message || "读取测评参数失败");
      const command = commandData.data.command;
      const response = await fetch("/api/admin/task/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command,
          clients: nodes,
          timeout: 7200,
          "2fa_code": code,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.status !== "success")
        throw new Error(data.message || "启动失败");
      setOpen(false);
      setCode("");
      toast.success("测评任务已提交");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "启动失败");
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/task/benchmark-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await response.json();
      if (!response.ok || data.status !== "success")
        throw new Error(data.message || "保存失败");
      setSettings(data.data);
      setSettingsOpen(false);
      toast.success("测评参数已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const allRows: Row[] = useMemo(
    () =>
      items
        .flatMap((task) =>
          task.results.map((result) => ({ task: task.task_id, ...result }))
        )
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    [items]
  );

  // 按记录对应的节点统计分组数量
  const groups = useMemo(
    () =>
      orderGroups(
        getGroups(Array.isArray(nodeDetail) ? nodeDetail : []),
        publicInfo?.group_order
      ),
    [nodeDetail, publicInfo?.group_order]
  );

  const { groupCounts, ungroupedCount } = useMemo(() => {
    const counts: Record<string, number> = {};
    let ungrouped = 0;
    for (const r of allRows) {
      const g = (nodeMap.get(r.client)?.group || "").trim();
      if (g) counts[g] = (counts[g] || 0) + 1;
      else ungrouped++;
    }
    return { groupCounts: counts, ungroupedCount: ungrouped };
  }, [allRows, nodeMap]);

  const keywords = useMemo(() => parseKeywords(search), [search]);

  const filteredRows = useMemo(() => {
    return allRows.filter((r) => {
      const node: NodeDetail | undefined = nodeMap.get(r.client);
      if (keywords.length > 0) {
        if (node) {
          if (!nodeMatchesKeywords(node, keywords)) return false;
        } else {
          const idLower = r.client.toLowerCase();
          if (!keywords.some((k) => idLower.includes(k))) return false;
        }
      }
      const g = (node?.group || "").trim();
      if (groupFilter === GROUP_UNGROUPED && g) return false;
      if (
        groupFilter !== GROUP_ALL &&
        groupFilter !== GROUP_UNGROUPED &&
        g !== groupFilter
      )
        return false;
      if (statusFilter !== "all" && getStatusInfo(r).tone !== statusFilter)
        return false;
      return true;
    });
  }, [allRows, nodeMap, keywords, groupFilter, statusFilter]);

  const summary = useMemo(() => {
    let running = 0;
    let ready = 0;
    for (const r of allRows) {
      const tone = getStatusInfo(r).tone;
      if (tone === "run") running++;
      else if (tone === "ok") ready++;
    }
    return { total: allRows.length, running, ready };
  }, [allRows]);

  const active = allRows.find(
    (r) => r.task === selected?.task && r.client === selected?.client
  );
  const activeNode = active ? nodeMap.get(active.client) : undefined;
  const activeSections = useMemo(
    () => (active ? parseReportSections(active.result) : []),
    [active]
  );

  useEffect(() => {
    if (activeSections.length > 0) {
      if (!activeSections.some((s) => s.key === activeTab)) {
        setActiveTab(activeSections[0].key);
      }
    }
  }, [activeSections, activeTab]);

  const currentSection =
    activeSections.find((s) => s.key === activeTab) || activeSections[0];

  const filtersActive =
    keywords.length > 0 ||
    groupFilter !== GROUP_ALL ||
    statusFilter !== "all";

  const clearFilters = () => {
    setSearch("");
    setGroupFilter(GROUP_ALL);
    setStatusFilter("all");
  };

  const invalidSettings =
    settings.hardware === "n" &&
    !settings.ip &&
    settings.network === "n" &&
    !settings.backroute;

  return (
    <div className="nn-page md:p-4 p-1">
      <div className="nn-header">
        <div>
          <div className="nn-title">线路测评</div>
          <div className="nn-sub">
            {summary.total} 条测评记录
            {" · "}
            进行中 <b>{summary.running}</b>
            {" · "}
            已生成 <b>{summary.ready}</b>
            {" · "}
            当前配置：<b>{summarizeSettings(settings)}</b>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Dialog.Root
            open={settingsOpen}
            onOpenChange={(o) => {
              setSettingsOpen(o);
              if (o) {
                fetch("/api/admin/task/benchmark-settings")
                  .then((r) => r.json())
                  .then((data) => {
                    if (data.status === "success") setSettings(data.data);
                    else toast.error("读取测评参数失败");
                  })
                  .catch(() => toast.error("读取测评参数失败"));
              }
            }}
          >
            <Dialog.Trigger>
              <button type="button" className="nn-btn">
                <SlidersHorizontal size={15} />
                测评参数
              </button>
            </Dialog.Trigger>
            <Dialog.Content maxWidth="480px">
              <Dialog.Title mb="1">测评参数</Dialog.Title>
              <Dialog.Description size="2" color="gray">
                适用于后台和前台发起的线路测评，完成后自动生成本地报告并上传至
                NodeQuality。
              </Dialog.Description>
              <div className="nn-form mt-2">
                <div className="nn-form-row">
                  <div>
                    <div className="nn-form-label">硬件质量</div>
                    <div className="nn-form-desc">
                      测试 CPU、内存与磁盘读写性能
                    </div>
                  </div>
                  <div className="nn-seg" role="radiogroup" aria-label="硬件质量">
                    {HARDWARE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className="nn-seg-item"
                        data-active={settings.hardware === opt.value}
                        onClick={() =>
                          setSettings({ ...settings, hardware: opt.value })
                        }
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="nn-form-row cursor-pointer">
                  <div>
                    <div className="nn-form-label">IP 质量</div>
                    <div className="nn-form-desc">
                      检测 IP 风险评分、流媒体解锁与邮局连通性
                    </div>
                  </div>
                  <Switch
                    checked={settings.ip}
                    onCheckedChange={(v) => setSettings({ ...settings, ip: v })}
                  />
                </label>

                <div className="nn-form-row">
                  <div>
                    <div className="nn-form-label">网络质量</div>
                    <div className="nn-form-desc">
                      测试国内外多节点上下行带宽、延迟与BGP信息
                    </div>
                  </div>
                  <div className="nn-seg" role="radiogroup" aria-label="网络质量">
                    {NETWORK_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className="nn-seg-item"
                        data-active={settings.network === opt.value}
                        onClick={() =>
                          setSettings({ ...settings, network: opt.value })
                        }
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="nn-form-row cursor-pointer">
                  <div>
                    <div className="nn-form-label">回程路由追踪</div>
                    <div className="nn-form-desc">
                      追踪三网回程路由跳数、ASN 与线路走向
                    </div>
                  </div>
                  <Switch
                    checked={settings.backroute}
                    onCheckedChange={(v) =>
                      setSettings({ ...settings, backroute: v })
                    }
                  />
                </label>
              </div>
              {invalidSettings && (
                <div className="nn-missing mt-2">请至少启用一项测评内容</div>
              )}
              <div className="nn-dialog-footer">
                <Dialog.Close>
                  <button type="button" className="nn-btn">
                    取消
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  className="nn-btn nn-btn-primary"
                  disabled={saving || invalidSettings}
                  onClick={saveSettings}
                >
                  {saving ? "保存中…" : "保存"}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Root>

          <button type="button" className="nn-btn" onClick={() => void refresh()}>
            <RefreshCw size={15} />
            刷新
          </button>

          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger>
              <button type="button" className="nn-btn nn-btn-primary">
                <Play size={15} />
                新建测评
              </button>
            </Dialog.Trigger>
            <Dialog.Content maxWidth="680px">
              <Dialog.Title mb="1">新建线路测评</Dialog.Title>
              <Dialog.Description size="2" color="gray">
                当前测评项：<b>{summarizeSettings(settings)}</b>
                。报告将保留在面板并上传至 NodeQuality。
              </Dialog.Description>
              <div className="nn-hint-box">
                测试会消耗流量并短暂占用系统资源，目标节点需满足
                Linux、root 权限、flock 与 timeout。
              </div>
              <div className="my-3">
                <NodeSelector
                  value={nodes}
                  onChange={setNodes}
                  className="min-h-[220px]"
                />
              </div>
              {twoFa && (
                <div className="nn-search max-w-xs">
                  <input
                    type="text"
                    placeholder="请输入 2FA 验证码"
                    style={{ paddingLeft: 12 }}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>
              )}
              <div className="nn-dialog-footer">
                <Dialog.Close>
                  <button type="button" className="nn-btn">
                    取消
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  className="nn-btn nn-btn-primary"
                  disabled={busy || !nodes.length || (twoFa && !code.trim())}
                  onClick={start}
                >
                  <Play size={14} />
                  {busy ? "提交中…" : `开始测评（${nodes.length}）`}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Root>
        </div>
      </div>

      {allRows.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="nn-toolbar">
            <div className="nn-search">
              <Search size={15} />
              <input
                type="text"
                value={search}
                placeholder="搜索节点名称或 IP，可粘贴多个"
                onChange={(e) => setSearch(e.target.value)}
                onPaste={(e) => pasteAsKeywords(e, setSearch)}
              />
            </div>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <button
                  type="button"
                  className="nn-btn"
                  data-active={statusFilter !== "all"}
                >
                  <ListFilter size={15} />
                  状态
                  {statusFilter !== "all" && <span className="nn-badge">1</span>}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="start" variant="soft">
                <DropdownMenu.Label>测评状态</DropdownMenu.Label>
                <DropdownMenu.RadioGroup
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as StatusKind)}
                >
                  <DropdownMenu.RadioItem value="all">全部</DropdownMenu.RadioItem>
                  <DropdownMenu.RadioItem value="ok">
                    报告已生成
                  </DropdownMenu.RadioItem>
                  <DropdownMenu.RadioItem value="run">
                    测评进行中
                  </DropdownMenu.RadioItem>
                  <DropdownMenu.RadioItem value="warn">
                    仅本地 / 不完整
                  </DropdownMenu.RadioItem>
                  <DropdownMenu.RadioItem value="err">
                    未完成
                  </DropdownMenu.RadioItem>
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
            {filtersActive && (
              <span className="nn-count">
                {filteredRows.length} / {allRows.length}
                <span className="nn-link" onClick={clearFilters}>
                  清除
                </span>
              </span>
            )}
          </div>
          {(groups.length > 0 || ungroupedCount > 0) && (
            <GroupFilterPills
              groups={groups.filter((g) => (groupCounts[g] ?? 0) > 0)}
              counts={groupCounts}
              total={allRows.length}
              ungroupedCount={ungroupedCount}
              groupFilter={groupFilter}
              setGroupFilter={setGroupFilter}
            />
          )}
        </div>
      )}

      {error && <div className="nn-missing">{error}</div>}

      <div className="nn-table-card">
        <div className="nn-table-scroll">
          <table className="nn-table">
            <thead>
              <tr>
                <th>节点</th>
                <th>开始时间</th>
                <th>完成时间</th>
                <th>耗时</th>
                <th>状态</th>
                <th style={{ textAlign: "right", paddingRight: 18 }}>报告</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="nn-empty">
                    {allRows.length === 0
                      ? "暂无线路测评记录，点击右上角「新建测评」发起测试"
                      : "没有符合筛选条件的测评记录"}
                  </td>
                </tr>
              )}
              {filteredRows.map((r) => {
                const node = nodeMap.get(r.client);
                const st = getStatusInfo(r);
                const link = reportLink(r.result);
                const dur = formatDuration(r.created_at, r.finished_at);
                return (
                  <tr key={`${r.task}-${r.client}`}>
                    <td>
                      <div className="nn-name">{node?.name || r.client}</div>
                      {(node?.ipv4 || node?.ipv6) && (
                        <div className="nn-ip">
                          {node.ipv4 && <span>{node.ipv4}</span>}
                          {node.ipv6 && (
                            <span title={node.ipv6}>{shortV6(node.ipv6)}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="nn-muted">{formatDate(r.created_at)}</td>
                    <td className="nn-muted">{formatDate(r.finished_at)}</td>
                    <td className="nn-muted">{dur || "—"}</td>
                    <td>
                      <span className="nn-status-pill" data-tone={st.tone}>
                        <i className="nn-status-dot" />
                        {st.label}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", paddingRight: 18 }}>
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          className="nn-btn-xs"
                          onClick={() => {
                            setSelected({ task: r.task, client: r.client });
                            setActiveTab("");
                          }}
                        >
                          <FileText size={13} />
                          查看报告
                        </button>
                        {link && (
                          <a
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                            className="nn-btn-xs"
                            data-accent="true"
                          >
                            NodeQuality
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog.Root
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
      >
        <Dialog.Content maxWidth="960px">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <Dialog.Title mb="1">
                {active ? activeNode?.name || active.client : "测评报告"}
              </Dialog.Title>
              <Dialog.Description size="2" color="gray">
                {activeNode?.ipv4 || active?.client || "NodeQuality 线路测评报告"}
              </Dialog.Description>
            </div>
            {active && (
              <div className="flex items-center gap-2">
                <span
                  className="nn-status-pill"
                  data-tone={getStatusInfo(active).tone}
                >
                  <i className="nn-status-dot" />
                  {getStatusInfo(active).label}
                </span>
                {reportLink(active.result) && (
                  <a
                    href={reportLink(active.result)}
                    target="_blank"
                    rel="noreferrer"
                    className="nn-btn-xs"
                    data-accent="true"
                  >
                    NodeQuality 外部报告
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            )}
          </div>

          {active && (
            <>
              <div className="nn-report-meta">
                <span>
                  开始时间：<b>{formatDate(active.created_at)}</b>
                </span>
                <span>
                  完成时间：<b>{formatDate(active.finished_at)}</b>
                </span>
                {formatDuration(active.created_at, active.finished_at) && (
                  <span>
                    总耗时：
                    <b>{formatDuration(active.created_at, active.finished_at)}</b>
                  </span>
                )}
              </div>

              {activeSections.length > 1 && (
                <div className="nn-report-tabs" role="tablist">
                  {activeSections.map((sec) => (
                    <button
                      key={sec.key}
                      type="button"
                      role="tab"
                      aria-selected={currentSection?.key === sec.key}
                      className="nn-report-tab"
                      data-active={currentSection?.key === sec.key}
                      onClick={() => setActiveTab(sec.key)}
                    >
                      {sec.label}
                    </button>
                  ))}
                </div>
              )}

              <pre className="nn-report-box">
                {currentSection?.content || "等待节点输出…"}
              </pre>
            </>
          )}

          <div className="nn-dialog-footer">
            {active && (
              <>
                <button
                  type="button"
                  className="nn-btn"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      currentSection?.content || clean(active.result)
                    );
                    setCopied(true);
                    toast.success("已复制到剪贴板");
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  复制当前页
                </button>
                <button
                  type="button"
                  className="nn-btn"
                  onClick={() => {
                    const blob = new Blob([clean(active.result)], {
                      type: "text/plain;charset=utf-8",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `nodequality-${
                      activeNode?.name || active.client
                    }-${active.task}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download size={14} />
                  下载完整报告
                </button>
              </>
            )}
            <Dialog.Close>
              <button type="button" className="nn-btn nn-btn-primary">
                关闭
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}

export default function BenchmarkPage() {
  return (
    <NodeDetailsProvider>
      <BenchmarkContent />
    </NodeDetailsProvider>
  );
}
