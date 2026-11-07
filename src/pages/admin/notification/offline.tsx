import { Checkbox } from "@/components/ui/checkbox";
import {
  NodeDetailsProvider,
  useNodeDetails,
  type NodeDetail,
} from "@/contexts/NodeDetailsContext";
import {
  OfflineNotificationProvider,
  useOfflineNotification,
  type OfflineNotification,
} from "@/contexts/NotificationContext";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import React from "react";
import {
  Bell,
  BellOff,
  ListFilter,
  Pencil,
  Search,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Dialog, DropdownMenu, Switch } from "@radix-ui/themes";
import { toast } from "sonner";
import Loading from "@/components/loading";
import { GroupFilterPills } from "@/components/admin/GroupFilterPills";
import { updateSettingsWithToast, useSettings } from "@/lib/api";
import {
  GROUP_ALL,
  GROUP_UNGROUPED,
  getGroups,
  orderGroups,
} from "@/utils/nodeGroups";
import "./nodeNotify.css";

const OFFLINE_ENDPOINT = "/api/admin/notification/offline";
const CN_BLOCKED_ENDPOINT = "/api/admin/notification/offline/cn-blocked";

const OfflinePage = () => {
  return (
    <OfflineNotificationProvider>
      <NodeDetailsProvider>
        <InnerLayout />
      </NodeDetailsProvider>
    </OfflineNotificationProvider>
  );
};

type EditValues = {
  enable: boolean;
  grace_period: number;
  // 被墙通知是否开启（界面用正向开关，提交时转成后端的 cn_blocked_muted）
  cn_blocked: boolean;
};

// 与后端内置默认一致；后台设置读到之前先用它。
const BUILTIN_DEFAULTS: EditValues = {
  enable: false,
  grace_period: 180,
  cn_blocked: true,
};

// 没有配置行的节点按「新节点默认」显示（后端也按它通知、按它建行）。
const configOf = (
  n: OfflineNotification | undefined,
  defaults: EditValues
): EditValues =>
  n
    ? {
        enable: n.enable,
        grace_period: n.grace_period || defaults.grace_period,
        cn_blocked: !n.cn_blocked_muted,
      }
    : defaults;

const toEditPayload = (client: string, v: EditValues) => ({
  client,
  enable: v.enable,
  grace_period: v.grace_period,
  cn_blocked_muted: !v.cn_blocked,
});

type StatusFilter = "all" | "on" | "off";

// 编辑对话框：单个节点 / 批量 / 新节点默认，共用一个表单。
type EditTarget =
  | { kind: "node"; node: NodeDetail }
  | { kind: "batch"; uuids: string[] }
  | { kind: "defaults" };

// 搜索关键字：空格、逗号、分号（含全角）分隔，多个之间是"或"。
const parseKeywords = (search: string): string[] =>
  search
    .split(/[\s,;，；]+/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);

const nodeMatches = (node: NodeDetail, keyword: string) =>
  [node.name, node.ipv4, node.ipv6].some((v) =>
    (v || "").toLowerCase().includes(keyword)
  );

// 过长的 IPv6 中间省略，悬停看全。
const shortV6 = (ip: string) => {
  const segments = ip.split(":");
  return ip.length > 20 && segments.length > 3
    ? `${segments.slice(0, 2).join(":")}:…${segments[segments.length - 1]}`
    : ip;
};

// 最后通知时间用相对时间，悬停看完整时间；后端的零值时间视为从未通知。
const relativeTime = (iso: string | undefined, t: TFunction) => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 3) return null;
  const sec = (Date.now() - date.getTime()) / 1000;
  const text =
    sec < 60
      ? t("notification.offline.just_now", "刚刚")
      : sec < 3600
      ? t("notification.offline.minutes_ago", {
          count: Math.floor(sec / 60),
          defaultValue: "{{count}} 分钟前",
        })
      : sec < 86400
      ? t("notification.offline.hours_ago", {
          count: Math.floor(sec / 3600),
          defaultValue: "{{count}} 小时前",
        })
      : sec < 86400 * 30
      ? t("notification.offline.days_ago", {
          count: Math.floor(sec / 86400),
          defaultValue: "{{count}} 天前",
        })
      : date.toLocaleDateString();
  return { text, full: date.toLocaleString() };
};

const postJSON = async (url: string, body: unknown) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message || res.statusText);
  }
};

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const InnerLayout = () => {
  const {
    loading: onLoading,
    error: onError,
    offlineNotification,
    refresh,
  } = useOfflineNotification();
  const {
    nodeDetail,
    isLoading: onNodeLoading,
    error: onNodeError,
  } = useNodeDetails();
  const { publicInfo } = usePublicInfo();
  const { settings, loading: settingsLoading } = useSettings();
  const { t } = useTranslation();

  const [search, setSearch] = React.useState("");
  const [groupFilter, setGroupFilter] = React.useState<string>(GROUP_ALL);
  const [offlineFilter, setOfflineFilter] = React.useState<StatusFilter>("all");
  const [cnFilter, setCnFilter] = React.useState<StatusFilter>("all");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [batchBusy, setBatchBusy] = React.useState(false);
  const [editing, setEditing] = React.useState<EditTarget | null>(null);

  // 新节点默认：设置读到后以它为准；之后在对话框里改了就以本地为准。
  const [defaultsOverride, setDefaultsOverride] =
    React.useState<EditValues | null>(null);
  const defaults: EditValues = React.useMemo(() => {
    if (defaultsOverride) return defaultsOverride;
    if (settingsLoading) return BUILTIN_DEFAULTS;
    const grace = Number(settings.offline_notification_default_grace_period);
    return {
      enable:
        settings.offline_notification_default_enabled ??
        BUILTIN_DEFAULTS.enable,
      grace_period: grace > 0 ? grace : BUILTIN_DEFAULTS.grace_period,
      cn_blocked:
        settings.cn_blocked_notification_default_enabled ??
        BUILTIN_DEFAULTS.cn_blocked,
    };
  }, [defaultsOverride, settings, settingsLoading]);

  const nodes = React.useMemo(
    () =>
      (Array.isArray(nodeDetail) ? [...nodeDetail] : []).sort(
        (a, b) => a.weight - b.weight
      ),
    [nodeDetail]
  );
  const confByUUID = React.useMemo(
    () => new Map(offlineNotification.map((n) => [n.client, n])),
    [offlineNotification]
  );
  const valuesOf = React.useCallback(
    (uuid: string) => configOf(confByUUID.get(uuid), defaults),
    [confByUUID, defaults]
  );

  const groups = React.useMemo(
    () => orderGroups(getGroups(nodes), publicInfo?.group_order),
    [nodes, publicInfo?.group_order]
  );
  const groupCounts = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of nodes) {
      const g = (n.group || "").trim();
      if (g) m[g] = (m[g] || 0) + 1;
    }
    return m;
  }, [nodes]);
  const ungroupedCount = nodes.filter((n) => !(n.group || "").trim()).length;

  // 当前选中的分组若已不存在（被重命名/删除），回退到"全部"
  React.useEffect(() => {
    if (
      groupFilter !== GROUP_ALL &&
      groupFilter !== GROUP_UNGROUPED &&
      !groups.includes(groupFilter)
    ) {
      setGroupFilter(GROUP_ALL);
    }
  }, [groups, groupFilter]);

  const keywords = React.useMemo(() => parseKeywords(search), [search]);
  const filtered = React.useMemo(
    () =>
      nodes.filter((node) => {
        if (keywords.length && !keywords.some((k) => nodeMatches(node, k)))
          return false;
        const g = (node.group || "").trim();
        if (groupFilter === GROUP_UNGROUPED && g) return false;
        if (
          groupFilter !== GROUP_ALL &&
          groupFilter !== GROUP_UNGROUPED &&
          g !== groupFilter
        )
          return false;
        const v = valuesOf(node.uuid);
        if (offlineFilter !== "all" && v.enable !== (offlineFilter === "on"))
          return false;
        if (cnFilter !== "all" && v.cn_blocked !== (cnFilter === "on"))
          return false;
        return true;
      }),
    [nodes, keywords, groupFilter, offlineFilter, cnFilter, valuesOf]
  );
  // 一次搜多个时，列出在所有节点里都找不到的关键字，方便核对漏了哪台。
  const unmatched = React.useMemo(
    () =>
      keywords.length > 1
        ? keywords.filter((k) => !nodes.some((n) => nodeMatches(n, k)))
        : [],
    [keywords, nodes]
  );
  const stats = React.useMemo(() => {
    let offline = 0;
    let cn = 0;
    for (const n of nodes) {
      const v = valuesOf(n.uuid);
      if (v.enable) offline++;
      if (v.cn_blocked) cn++;
    }
    return { offline, cn };
  }, [nodes, valuesOf]);

  // 选择只保留当前筛选结果里的节点，批量操作不会误伤看不见的节点。
  const filteredKey = filtered.map((n) => n.uuid).join(",");
  React.useEffect(() => {
    const visible = new Set(filteredKey ? filteredKey.split(",") : []);
    setSelected((prev) => {
      const next = prev.filter((id) => visible.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [filteredKey]);

  const statusFilterCount =
    (offlineFilter !== "all" ? 1 : 0) + (cnFilter !== "all" ? 1 : 0);
  const filtersActive =
    keywords.length > 0 || groupFilter !== GROUP_ALL || statusFilterCount > 0;
  const clearFilters = () => {
    setSearch("");
    setGroupFilter(GROUP_ALL);
    setOfflineFilter("all");
    setCnFilter("all");
  };

  // 粘贴多行（如一列 IP）时把换行换成空格：单行输入框会直接吞掉换行，把 IP 粘成一串。
  const handleSearchPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/[\r\n]/.test(text)) return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const cleaned = text.replace(/[\r\n]+/g, " ").trim();
    setSearch(
      `${el.value.slice(0, start)} ${cleaned} ${el.value.slice(end)}`.trim()
    );
  };

  const runBatchSwitch = async (endpoint: string, enable: boolean) => {
    const uuids = [...selected];
    setBatchBusy(true);
    try {
      await postJSON(`${endpoint}/${enable ? "enable" : "disable"}`, uuids);
      await refresh();
      toast.success(
        t("notification.offline.batch_done", {
          count: uuids.length,
          defaultValue: "已更新 {{count}} 个节点",
        })
      );
    } catch (error) {
      toast.error(t("common.error", { message: errorText(error) }));
    } finally {
      setBatchBusy(false);
    }
  };

  const saveEdit = async (target: EditTarget, values: EditValues) => {
    try {
      if (target.kind === "defaults") {
        await updateSettingsWithToast(
          {
            offline_notification_default_enabled: values.enable,
            offline_notification_default_grace_period: values.grace_period,
            cn_blocked_notification_default_enabled: values.cn_blocked,
          },
          t
        );
        setDefaultsOverride(values);
      } else {
        const uuids =
          target.kind === "node" ? [target.node.uuid] : target.uuids;
        await postJSON(
          `${OFFLINE_ENDPOINT}/edit`,
          uuids.map((id) => toEditPayload(id, values))
        );
        await refresh();
        toast.success(t("common.updated_successfully"));
      }
      setEditing(null);
    } catch (error) {
      // 设置保存失败时 updateSettingsWithToast 已提示
      if (target.kind !== "defaults")
        toast.error(t("common.error", { message: errorText(error) }));
    }
  };

  if (onLoading || onNodeLoading) {
    return <Loading text="(o゜▽゜)o☆" />;
  }
  if (onError || onNodeError) {
    return <div>Error: {onError?.message || onNodeError}</div>;
  }

  const allUUIDs = filtered.map((n) => n.uuid);
  const toggleMany = (uuids: string[], checked: boolean) => {
    const rest = selected.filter((id) => !uuids.includes(id));
    setSelected(checked ? [...rest, ...uuids] : rest);
  };

  return (
    <div className="nn-page md:p-4 p-1">
      <div className="nn-header">
        <div>
          <div className="nn-title">
            {t("notification.offline.full_title", "节点通知")}
          </div>
          <div className="nn-sub">
            {t("notification.offline.summary_total", {
              count: nodes.length,
              defaultValue: "{{count}} 个节点",
            })}
            {" · "}
            {t("notification.offline.col_offline", "离线通知")}{" "}
            <b>{stats.offline}</b>
            {" · "}
            {t("notification.offline.col_cn", "被墙通知")} <b>{stats.cn}</b>
          </div>
        </div>
        <button
          type="button"
          className="nn-btn"
          onClick={() => setEditing({ kind: "defaults" })}
        >
          <SlidersHorizontal size={15} />
          {t("notification.offline.defaults_button", "默认设置")}
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="nn-toolbar">
          <div className="nn-search">
            <Search size={15} />
            <input
              type="text"
              value={search}
              placeholder={t(
                "notification.offline.search_placeholder",
                "搜索名称或 IP，可粘贴多个"
              )}
              onChange={(e) => setSearch(e.target.value)}
              onPaste={handleSearchPaste}
            />
          </div>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <button
                type="button"
                className="nn-btn"
                data-active={statusFilterCount > 0}
              >
                <ListFilter size={15} />
                {t("notification.offline.filter", "筛选")}
                {statusFilterCount > 0 && (
                  <span className="nn-badge">{statusFilterCount}</span>
                )}
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="start" variant="soft">
              <StatusFilterGroup
                label={t("notification.offline.col_offline", "离线通知")}
                value={offlineFilter}
                onChange={setOfflineFilter}
              />
              <DropdownMenu.Separator />
              <StatusFilterGroup
                label={t("notification.offline.col_cn", "被墙通知")}
                value={cnFilter}
                onChange={setCnFilter}
              />
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          {filtersActive && (
            <span className="nn-count">
              {filtered.length} / {nodes.length}
              <span className="nn-link" onClick={clearFilters}>
                {t("notification.offline.clear_filters", "清除")}
              </span>
            </span>
          )}
        </div>
        {unmatched.length > 0 && (
          <div className="nn-missing">
            {t("notification.offline.not_found", "未找到：")}
            <code>{unmatched.join("  ")}</code>
          </div>
        )}
        {(groups.length > 0 || ungroupedCount > 0) && (
          <GroupFilterPills
            groups={groups}
            counts={groupCounts}
            total={nodes.length}
            ungroupedCount={ungroupedCount}
            groupFilter={groupFilter}
            setGroupFilter={setGroupFilter}
          />
        )}
      </div>

      <div className="nn-table-card">
        <div className="nn-table-scroll">
          <table className="nn-table">
            <thead>
              <tr>
                <th className="nn-col-check">
                  <Checkbox
                    checked={checkState(allUUIDs, selected)}
                    onCheckedChange={(c) => toggleMany(allUUIDs, !!c)}
                  />
                </th>
                <th>{t("notification.offline.col_node", "节点")}</th>
                <th>{t("notification.offline.col_offline", "离线通知")}</th>
                <th>{t("notification.offline.col_cn", "被墙通知")}</th>
                <th>{t("notification.offline.grace_period", "宽限期")}</th>
                <th>{t("notification.offline.last_notified", "最后通知")}</th>
                <th className="nn-col-action" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="nn-empty">
                    {t("notification.offline.no_match", "没有符合条件的节点")}
                  </td>
                </tr>
              )}
              {filtered.map((node) => (
                <NodeRow
                  key={node.uuid}
                  node={node}
                  values={valuesOf(node.uuid)}
                  lastNotified={confByUUID.get(node.uuid)?.last_notified}
                  checked={selected.includes(node.uuid)}
                  onCheckedChange={(c) => toggleMany([node.uuid], c)}
                  onEdit={() => setEditing({ kind: "node", node })}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected.length > 0 && (
        <div className="nn-bar" role="toolbar">
          <span className="nn-bar-count">
            {t("notification.offline.selected_count", {
              count: selected.length,
              defaultValue: "已选 {{count}}",
            })}
          </span>
          <span className="nn-bar-sep" />
          <span className="nn-bar-label">
            {t("notification.offline.col_offline", "离线通知")}
          </span>
          <button
            type="button"
            className="nn-bar-btn"
            disabled={batchBusy}
            onClick={() => runBatchSwitch(OFFLINE_ENDPOINT, true)}
          >
            <Bell size={14} />
            {t("notification.offline.on", "开")}
          </button>
          <button
            type="button"
            className="nn-bar-btn"
            disabled={batchBusy}
            onClick={() => runBatchSwitch(OFFLINE_ENDPOINT, false)}
          >
            <BellOff size={14} />
            {t("notification.offline.off", "关")}
          </button>
          <span className="nn-bar-sep" />
          <span className="nn-bar-label">
            {t("notification.offline.col_cn", "被墙通知")}
          </span>
          <button
            type="button"
            className="nn-bar-btn"
            disabled={batchBusy}
            onClick={() => runBatchSwitch(CN_BLOCKED_ENDPOINT, true)}
          >
            <ShieldCheck size={14} />
            {t("notification.offline.on", "开")}
          </button>
          <button
            type="button"
            className="nn-bar-btn"
            disabled={batchBusy}
            onClick={() => runBatchSwitch(CN_BLOCKED_ENDPOINT, false)}
          >
            <ShieldOff size={14} />
            {t("notification.offline.off", "关")}
          </button>
          <span className="nn-bar-sep" />
          <button
            type="button"
            className="nn-bar-btn"
            disabled={batchBusy}
            onClick={() => setEditing({ kind: "batch", uuids: [...selected] })}
          >
            <Pencil size={14} />
            {t("notification.offline.edit", "编辑")}
          </button>
          <button
            type="button"
            className="nn-bar-btn"
            title={t("notification.offline.clear_selection", "取消选择")}
            onClick={() => setSelected([])}
          >
            <X size={15} />
          </button>
        </div>
      )}

      <EditDialog
        target={editing}
        initialValues={
          !editing
            ? defaults
            : editing.kind === "defaults"
            ? defaults
            : editing.kind === "node"
            ? valuesOf(editing.node.uuid)
            : valuesOf(editing.uuids[0])
        }
        onClose={() => setEditing(null)}
        onSave={saveEdit}
      />
    </div>
  );
};

// 一批节点的勾选状态：全选 / 部分 / 未选。
const checkState = (uuids: string[], selected: string[]) => {
  if (uuids.length === 0) return false;
  const n = uuids.filter((id) => selected.includes(id)).length;
  return n === 0 ? false : n === uuids.length ? true : "indeterminate";
};

const StatusFilterGroup = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: StatusFilter;
  onChange: (v: StatusFilter) => void;
}) => {
  const { t } = useTranslation();
  return (
    <>
      <DropdownMenu.Label>{label}</DropdownMenu.Label>
      <DropdownMenu.RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as StatusFilter)}
      >
        <DropdownMenu.RadioItem value="all">
          {t("notification.offline.filter_all", "全部")}
        </DropdownMenu.RadioItem>
        <DropdownMenu.RadioItem value="on">
          {t("notification.offline.filter_on", "已开启")}
        </DropdownMenu.RadioItem>
        <DropdownMenu.RadioItem value="off">
          {t("notification.offline.filter_off", "已关闭")}
        </DropdownMenu.RadioItem>
      </DropdownMenu.RadioGroup>
    </>
  );
};

const NodeRow = ({
  node,
  values,
  lastNotified,
  checked,
  onCheckedChange,
  onEdit,
}: {
  node: NodeDetail;
  values: EditValues;
  lastNotified: string | undefined;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  onEdit: () => void;
}) => {
  const { t } = useTranslation();
  const last = relativeTime(lastNotified, t);
  return (
    <tr data-selected={checked}>
      <td className="nn-col-check">
        <Checkbox
          checked={checked}
          onCheckedChange={(c) => onCheckedChange(!!c)}
        />
      </td>
      <td>
        <div className="nn-name">{node.name}</div>
        {(node.ipv4 || node.ipv6) && (
          <div className="nn-ip">
            {node.ipv4 && <span>{node.ipv4}</span>}
            {node.ipv6 && <span title={node.ipv6}>{shortV6(node.ipv6)}</span>}
          </div>
        )}
      </td>
      <td>
        <InlineSwitch
          uuid={node.uuid}
          checked={values.enable}
          endpoint={OFFLINE_ENDPOINT}
        />
      </td>
      <td>
        <InlineSwitch
          uuid={node.uuid}
          checked={values.cn_blocked}
          endpoint={CN_BLOCKED_ENDPOINT}
        />
      </td>
      <td className="nn-muted">
        {values.grace_period} {t("nodeCard.time_second", "秒")}
      </td>
      <td className="nn-muted" title={last?.full}>
        {last ? last.text : "—"}
      </td>
      <td className="nn-col-action">
        <span
          role="button"
          className="nn-icon-btn"
          title={t("common.edit")}
          onClick={onEdit}
        >
          <Pencil size={15} />
        </span>
      </td>
    </tr>
  );
};

// InlineSwitch 在表格里直接开关单个节点的某项通知：POST {endpoint}/enable|disable，参数为 [uuid]。
const InlineSwitch = ({
  uuid,
  checked,
  endpoint,
}: {
  uuid: string;
  checked: boolean;
  endpoint: string;
}) => {
  const { t } = useTranslation();
  const { refresh } = useOfflineNotification();
  const [value, setValue] = React.useState(checked);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setValue(checked), [checked]);

  return (
    <Switch
      size="1"
      checked={value}
      disabled={saving}
      onCheckedChange={async (next) => {
        setValue(next);
        setSaving(true);
        try {
          await postJSON(`${endpoint}/${next ? "enable" : "disable"}`, [uuid]);
          await refresh();
        } catch (error) {
          setValue(!next);
          toast.error(t("common.error", { message: errorText(error) }));
        } finally {
          setSaving(false);
        }
      }}
    />
  );
};

const EditDialog = ({
  target,
  initialValues,
  onClose,
  onSave,
}: {
  target: EditTarget | null;
  initialValues: EditValues;
  onClose: () => void;
  onSave: (target: EditTarget, values: EditValues) => Promise<void>;
}) => {
  const { t } = useTranslation();
  const [values, setValues] = React.useState(initialValues);
  const [grace, setGrace] = React.useState(String(initialValues.grace_period));
  const [saving, setSaving] = React.useState(false);

  // 每次打开都从目标的当前值开始
  React.useEffect(() => {
    if (target) {
      setValues(initialValues);
      setGrace(String(initialValues.grace_period));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  if (!target) return null;
  const title =
    target.kind === "defaults"
      ? t("notification.offline.defaults_title", "新节点默认")
      : target.kind === "batch"
      ? t("notification.offline.batch_title", {
          count: target.uuids.length,
          defaultValue: "批量编辑 {{count}} 个节点",
        })
      : target.node.name;
  const description =
    target.kind === "defaults"
      ? t(
          "notification.offline.defaults_desc",
          "用于新加入、还没单独设置过的节点；已设置过的节点不受影响。"
        )
      : target.kind === "batch"
      ? t(
          "notification.offline.batch_desc",
          "以下设置会覆盖所选节点的当前配置。"
        )
      : [target.node.ipv4, target.node.ipv6].filter(Boolean).join(" · ");
  const graceNum = Math.floor(Number(grace));
  const graceValid = Number.isFinite(graceNum) && graceNum > 0;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content maxWidth="440px">
        <Dialog.Title mb="1">{title}</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          {description || " "}
        </Dialog.Description>
        <form
          className="nn-form mt-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!graceValid) return;
            setSaving(true);
            await onSave(target, { ...values, grace_period: graceNum });
            setSaving(false);
          }}
        >
          <label className="nn-form-row">
            <div>
              <div className="nn-form-label">
                {t("notification.offline.offline_switch", "离线 / 上线通知")}
              </div>
              <div className="nn-form-desc">
                {t(
                  "notification.offline.offline_desc",
                  "掉线超过宽限期时通知，恢复后再通知一次"
                )}
              </div>
            </div>
            <Switch
              checked={values.enable}
              onCheckedChange={(v) => setValues((s) => ({ ...s, enable: v }))}
            />
          </label>
          <label className="nn-form-row">
            <div>
              <div className="nn-form-label">
                {t("notification.offline.cn_blocked_switch", "被墙通知")}
              </div>
              <div className="nn-form-desc">
                {t(
                  "notification.offline.cn_blocked_desc",
                  "被墙、恢复、被墙期间掉线时通知"
                )}
              </div>
            </div>
            <Switch
              checked={values.cn_blocked}
              onCheckedChange={(v) =>
                setValues((s) => ({ ...s, cn_blocked: v }))
              }
            />
          </label>
          <label className="nn-form-row">
            <div>
              <div className="nn-form-label">
                {t("notification.offline.grace_period", "宽限期")}
              </div>
              <div className="nn-form-desc">
                {t("notification.offline.grace_period_tip")}
              </div>
            </div>
            <span className="nn-num">
              <input
                type="number"
                min={1}
                value={grace}
                onChange={(e) => setGrace(e.target.value)}
              />
              <span>{t("nodeCard.time_second", "秒")}</span>
            </span>
          </label>
          <div className="nn-dialog-footer">
            <button type="button" className="nn-btn" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="nn-btn nn-btn-primary"
              disabled={saving || !graceValid}
            >
              {t("common.save")}
            </button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
};

export default OfflinePage;
