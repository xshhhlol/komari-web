import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Dialog, Flex, Text, TextField } from "@radix-ui/themes";
import { Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import NodeSelector from "@/components/NodeSelector";
import { NodeDetailsProvider, useNodeDetails } from "@/contexts/NodeDetailsContext";

type Result = { client: string; result: string; exit_code: number | null; created_at: string; finished_at: string | null };
type Benchmark = { task_id: string; results: Result[] };

// NodeQuality's normal cleanup exits with code 1. Capture its report files locally
// before cleanup, instead of uploading them to NodeQuality's public clipboard.
const command = `# komari-nodequality-report-v1
set -eu
[ "$(uname -s)" = Linux ] || { echo '仅支持 Linux'; exit 1; }
[ "$(id -u)" = 0 ] || { echo '需要 root 权限'; exit 1; }
command -v flock >/dev/null && command -v timeout >/dev/null || { echo "需要 flock 和 timeout"; exit 1; }
exec 9>/tmp/komari-nodequality.lock
flock -n 9 || { echo "此节点已有测评正在运行"; exit 1; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl -fsSL --connect-timeout 30 --max-time 120 https://raw.githubusercontent.com/LloydAsp/NodeQuality/a92fca6c0067df29ddd03fdc2fee6f3000f64545/NodeQuality.sh -o "$work/source"
[ "$(tail -n 1 "$work/source")" = main ] || { echo 'NodeQuality 入口不匹配'; exit 1; }
sed '$d' "$work/source" > "$work/run"
cat >> "$work/run" <<'KOMARI_SCRIPT'
function upload_result() {
  echo '--- KOMARI NODEQUALITY REPORT BEGIN ---'
  for file in header_info.log hardware_quality.log ip_quality.log net_quality.log; do
    echo "\n--- $file ---"
    if [ -s "$result_directory/$file" ]; then cat "$result_directory/$file"; else echo '[结果文件缺失或为空]'; fi
  done
  echo '--- KOMARI NODEQUALITY REPORT END ---'
}
main
KOMARI_SCRIPT
printf 'f\\ny\\ny\\nn\\n' | timeout -s TERM -k 120 7000 bash "$work/run" -d /tmp
`;
const clean = (s: string) => s.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g"), "").replace(/\r/g, "");
const date = (s: string | null) => s ? new Date(s).toLocaleString() : "—";

function BenchmarkContent() {
  const { nodeDetail } = useNodeDetails();
  const [nodes, setNodes] = useState<string[]>([]);
  const [items, setItems] = useState<Benchmark[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<{ task: string; client: string } | null>(null);
  const [twoFa, setTwoFa] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/task/benchmarks", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || payload.status !== "success" || !Array.isArray(payload.data)) throw new Error(payload.message || "读取报告失败");
      setItems(payload.data); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "读取报告失败"); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    fetch("/api/me").then(r => r.json()).then(data => setTwoFa(Boolean(data?.["2fa_enabled"]))).catch(() => {});
    return () => clearInterval(timer);
  }, [refresh]);
  const start = async () => {
    if (!nodes.length || (twoFa && !code.trim())) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/task/exec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command, clients: nodes, timeout: 7200, "2fa_code": code }) });
      const data = await response.json();
      if (!response.ok || data.status !== "success") throw new Error(data.message || "启动失败");
      setOpen(false); setCode(""); toast.success("测评任务已提交"); await refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "启动失败"); }
    finally { setBusy(false); }
  };
  const rows = items.flatMap(task => task.results.map(result => ({ task: task.task_id, ...result }))).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const active = rows.find(r => r.task === selected?.task && r.client === selected?.client);
  const name = (id: string) => nodeDetail.find(n => n.uuid === id)?.name || id;
  const status = (r: Result) => !r.finished_at ? "等待 / 进行中" : r.result.includes("--- KOMARI NODEQUALITY REPORT END ---") && r.exit_code === 1 ? (r.result.includes("[结果文件缺失或为空]") ? "报告不完整" : "报告已生成") : "未完成";
  return <div className="p-4 flex flex-col gap-4">
    <Flex justify="between" align="center" wrap="wrap" gap="3">
      <div><h1 className="text-2xl font-bold">线路测评</h1><Text size="2" color="gray">{rows.length} 条测评记录</Text></div>
      <Flex gap="2"><Button variant="soft" onClick={() => void refresh()}><RefreshCw size={15} />刷新</Button>
      <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Trigger><Button><Play size={15} />新建测评</Button></Dialog.Trigger>
        <Dialog.Content maxWidth="700px"><Dialog.Title>新建线路测评</Dialog.Title>
          <Dialog.Description size="2" color="gray">快速硬件、IP 质量和网络质量；不执行回程追踪。测试会消耗流量并占用系统资源，需要 Linux、root、挂载权限、flock 和 timeout。异常中断可能需要手动检查临时挂载。</Dialog.Description>
          <div className="my-4"><NodeSelector value={nodes} onChange={setNodes} className="min-h-[200px]" /></div>
          {twoFa && <TextField.Root placeholder="2FA 验证码" value={code} onChange={e => setCode(e.target.value)} />}
          <Flex justify="end" gap="2" mt="4"><Dialog.Close><Button variant="soft">取消</Button></Dialog.Close><Button disabled={busy || !nodes.length || (twoFa && !code.trim())} onClick={start}>{busy ? "提交中" : `开始测评（${nodes.length}）`}</Button></Flex>
        </Dialog.Content></Dialog.Root></Flex>
    </Flex>
    {error && <Text color="red">{error}</Text>}
    <Card><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-[var(--gray-a5)] text-[var(--gray-11)]"><th className="p-3">节点</th><th className="p-3">开始时间</th><th className="p-3">完成时间</th><th className="p-3">状态</th><th className="p-3">报告</th></tr></thead>
      <tbody>{rows.map(r => <tr key={`${r.task}-${r.client}`} className="border-b border-[var(--gray-a4)]"><td className="p-3">{name(r.client)}</td><td className="p-3 whitespace-nowrap">{date(r.created_at)}</td><td className="p-3 whitespace-nowrap">{date(r.finished_at)}</td><td className="p-3"><Badge color={status(r) === "报告已生成" ? "green" : status(r) === "等待 / 进行中" ? "gray" : "red"}>{status(r)}</Badge></td><td className="p-3"><Button size="1" variant="soft" onClick={() => setSelected({ task: r.task, client: r.client })}>查看</Button></td></tr>)}</tbody></table>
      {!rows.length && <div className="p-8 text-center text-[var(--gray-11)]">暂无测评记录</div>}</div></Card>
    <Dialog.Root open={!!selected} onOpenChange={v => { if (!v) setSelected(null); }}><Dialog.Content maxWidth="1000px"><Dialog.Title>{active ? name(active.client) : "测评报告"}</Dialog.Title><Dialog.Description size="2" color="gray">开始：{date(active?.created_at || null)} 完成：{date(active?.finished_at || null)} {active && status(active)}</Dialog.Description>
      <pre className="mt-4 max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--gray-2)] p-4 text-sm">{active ? clean(active.result) || "等待输出…" : "记录不可用"}</pre>
      <Flex justify="end" gap="2" mt="4"><Button variant="soft" onClick={() => { if (active) { const blob = new Blob([clean(active.result)], { type: "text/plain;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `nodequality-${active.task}.txt`; a.click(); URL.revokeObjectURL(url); } }}>下载报告</Button><Dialog.Close><Button>关闭</Button></Dialog.Close></Flex>
    </Dialog.Content></Dialog.Root>
  </div>;
}
export default function BenchmarkPage() { return <NodeDetailsProvider><BenchmarkContent /></NodeDetailsProvider>; }
