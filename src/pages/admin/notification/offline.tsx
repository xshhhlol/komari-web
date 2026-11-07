import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Pencil, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  Flex,
  IconButton,
  Select,
  Switch,
  Text,
  TextField,
} from "@radix-ui/themes";
import { toast } from "sonner";
import Loading from "@/components/loading";
import Tips from "@/components/ui/tips";
import { GroupFilterPills } from "@/components/admin/GroupFilterPills";
import { updateSettingsWithToast, useSettings } from "@/lib/api";
import {
  GROUP_ALL,
  GROUP_UNGROUPED,
  getGroups,
  orderGroups,
} from "@/utils/nodeGroups";

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
  cooldown: number;
  grace_period: number;
  // 被墙通知是否开启（界面用正向开关，提交时转成后端的 cn_blocked_muted）
  cn_blocked: boolean;
};

// 与后端内置默认一致；后台设置读到之前先用它。
const BUILTIN_DEFAULTS: EditValues = {
  enable: false,
  cooldown: 1800,
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
        cooldown: n.cooldown ?? defaults.cooldown,
        grace_period: n.grace_period || defaults.grace_period,
        cn_blocked: !n.cn_blocked_muted,
      }
    : defaults;

const toEditPayload = (client: string, v: EditValues) => ({
  client,
  enable: v.enable,
  cooldown: v.cooldown,
  grace_period: v.grace_period,
  cn_blocked_muted: !v.cn_blocked,
});

type StatusFilter = "all" | "on" | "off";

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

const NotificationEditForm = ({
  initialValues,
  onSubmit,
  loading,
  onCancel,
}: {
  initialValues: EditValues;
  onSubmit: (values: EditValues) => void;
  loading?: boolean;
  onCancel?: () => void;
}) => {
  const { t } = useTranslation();
  const [enabled, setEnabled] = React.useState(initialValues.enable);
  const [cnBlocked, setCnBlocked] = React.useState(initialValues.cn_blocked);
  const [grace, setGrace] = React.useState(initialValues.grace_period);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          enable: enabled,
          cooldown: 3000,
          grace_period: grace,
          cn_blocked: cnBlocked,
        });
      }}
      className="flex flex-col gap-2"
    >
      <label htmlFor="status">
        {t("notification.offline.offline_switch", "离线 / 上线通知")}
      </label>
      <Switch
        id="status"
        name="status"
        checked={enabled}
        onCheckedChange={setEnabled}
      />
      <label htmlFor="cn_blocked" className="flex items-center gap-2">
        {t("notification.offline.cn_blocked_switch", "被墙通知")}
        <Tips>
          {t(
            "notification.offline.cn_blocked_tip",
            "关闭后，该节点被墙、恢复、被墙期间掉线都不再推送；面板上的被墙标记照常显示。"
          )}
        </Tips>
      </label>
      <Switch
        id="cn_blocked"
        name="cn_blocked"
        checked={cnBlocked}
        onCheckedChange={setCnBlocked}
      />
      <label htmlFor="grace_period" className="flex items-center gap-2">
        {t("notification.offline.grace_period")}
        <Tips>{t("notification.offline.grace_period_tip")}</Tips>
      </label>
      <TextField.Root
        type="number"
        min={1}
        value={grace}
        onChange={(e) => setGrace(Number(e.target.value))}
        id="grace_period"
        name="grace_period"
      />
      <Flex gap="2" justify="end" className="mt-4">
        {onCancel && (
          <Dialog.Close>
            <Button
              variant="soft"
              color="gray"
              type="button"
              onClick={onCancel}
            >
              {t("common.cancel")}
            </Button>
          </Dialog.Close>
        )}
        <Button variant="solid" type="submit" disabled={loading}>
          {t("common.save")}
        </Button>
      </Flex>
    </form>
  );
};

// DefaultsCard 编辑「新节点默认」：开关立即保存，宽限期失焦 / 回车时保存。
const DefaultsCard = ({
  defaults,
  onChange,
}: {
  defaults: EditValues;
  onChange: (next: EditValues) => void;
}) => {
  const { t } = useTranslation();
  const [grace, setGrace] = React.useState(String(defaults.grace_period));
  React.useEffect(
    () => setGrace(String(defaults.grace_period)),
    [defaults.grace_period]
  );

  const save = async (patch: Record<string, unknown>, next: EditValues) => {
    try {
      await updateSettingsWithToast(patch, t);
      onChange(next);
    } catch {
      // updateSettingsWithToast 已提示错误；界面保持原值
    }
  };
  const saveGrace = () => {
    const v = Math.floor(Number(grace));
    if (!Number.isFinite(v) || v <= 0) {
      setGrace(String(defaults.grace_period));
      return;
    }
    if (v === defaults.grace_period) return;
    save(
      { offline_notification_default_grace_period: v },
      { ...defaults, grace_period: v }
    );
  };

  return (
    <div className="rounded-lg border border-[var(--gray-a5)] p-3 flex flex-col gap-2">
      <Flex align="center" gap="2">
        <Text size="2" weight="bold">
          {t("notification.offline.defaults_title", "新节点默认")}
        </Text>
        <Tips>
          {t(
            "notification.offline.defaults_tip",
            "作用于新加入、还没单独设置过的节点。已经设置过的节点不受影响，如需统一调整，可筛选后全选再批量操作。"
          )}
        </Tips>
      </Flex>
      <Flex gap="5" align="center" wrap="wrap">
        <Text as="label" size="2" className="flex items-center gap-2">
          <Switch
            checked={defaults.enable}
            onCheckedChange={(v) =>
              save(
                { offline_notification_default_enabled: v },
                { ...defaults, enable: v }
              )
            }
          />
          {t("notification.offline.offline_switch", "离线 / 上线通知")}
        </Text>
        <Text as="label" size="2" className="flex items-center gap-2">
          <Switch
            checked={defaults.cn_blocked}
            onCheckedChange={(v) =>
              save(
                { cn_blocked_notification_default_enabled: v },
                { ...defaults, cn_blocked: v }
              )
            }
          />
          {t("notification.offline.cn_blocked_switch", "被墙通知")}
        </Text>
        <Text as="label" size="2" className="flex items-center gap-2">
          {t("notification.offline.grace_period")}
          <TextField.Root
            type="number"
            min={1}
            className="w-24"
            value={grace}
            onChange={(e) => setGrace(e.target.value)}
            onBlur={saveGrace}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          >
            <TextField.Slot side="right">
              {t("nodeCard.time_second")}
            </TextField.Slot>
          </TextField.Root>
        </Text>
      </Flex>
    </div>
  );
};

const StatusSelect = ({
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
    <Flex align="center" gap="2">
      <Text size="2" color="gray">
        {label}
      </Text>
      <Select.Root
        value={value}
        onValueChange={(v) => onChange(v as StatusFilter)}
      >
        <Select.Trigger className="min-w-20" />
        <Select.Content>
          <Select.Item value="all">
            {t("notification.offline.filter_all", "全部")}
          </Select.Item>
          <Select.Item value="on">
            {t("notification.offline.filter_on", "已开启")}
          </Select.Item>
          <Select.Item value="off">
            {t("notification.offline.filter_off", "已关闭")}
          </Select.Item>
        </Select.Content>
      </Select.Root>
    </Flex>
  );
};

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
  const [batchLoading, setBatchLoading] = React.useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = React.useState(false);
  const [batchForm, setBatchForm] =
    React.useState<EditValues>(BUILTIN_DEFAULTS);

  // 新节点默认：设置读到后以它为准；之后的修改由 DefaultsCard 回写本地。
  const [defaultsOverride, setDefaultsOverride] =
    React.useState<EditValues | null>(null);
  const defaults: EditValues = React.useMemo(() => {
    if (defaultsOverride) return defaultsOverride;
    if (settingsLoading) return BUILTIN_DEFAULTS;
    const grace = Number(settings.offline_notification_default_grace_period);
    return {
      ...BUILTIN_DEFAULTS,
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

  // 选择只保留当前筛选结果里的节点，批量操作不会误伤看不见的节点。
  const filteredKey = filtered.map((n) => n.uuid).join(",");
  React.useEffect(() => {
    const visible = new Set(filteredKey ? filteredKey.split(",") : []);
    setSelected((prev) => {
      const next = prev.filter((id) => visible.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [filteredKey]);

  const filtersActive =
    keywords.length > 0 ||
    groupFilter !== GROUP_ALL ||
    offlineFilter !== "all" ||
    cnFilter !== "all";
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
    setBatchLoading(true);
    try {
      const res = await fetch(`${endpoint}/${enable ? "enable" : "disable"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(uuids),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || res.statusText);
      }
      await refresh();
      toast.success(
        t("notification.offline.batch_done", {
          count: uuids.length,
          defaultValue: "已更新 {{count}} 个节点",
        })
      );
    } catch (error) {
      toast.error(
        t("common.error", {
          message: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      setBatchLoading(false);
    }
  };

  // 批量修改
  const handleBatchEdit = (values: EditValues) => {
    setBatchLoading(true);
    const payload = selected.map((id) => toEditPayload(id, values));
    fetch(`${OFFLINE_ENDPOINT}/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((res) => {
        if (!res.ok) {
          toast.error(
            "Failed to update offline notifications: " + res.statusText
          );
        } else {
          toast.success(t("common.updated_successfully"));
        }
        return res.json();
      })
      .then(() => {
        setBatchLoading(false);
        setBatchDialogOpen(false);
        refresh();
      })
      .catch((error) => {
        console.error("Error updating offline notifications:", error);
        toast.error(t("common.error", { message: error.message }));
        setBatchLoading(false);
      });
  };

  if (onLoading || onNodeLoading) {
    return <Loading text="(o゜▽゜)o☆" />;
  }
  if (onError || onNodeError) {
    return <div>Error: {onError?.message || onNodeError}</div>;
  }
  const noneSelected = selected.length === 0 || batchLoading;
  return (
    <div className="flex flex-col gap-4 md:p-4 p-1">
      <label className="text-2xl font-semibold">
        {t("notification.offline.full_title", "节点通知设置")}
      </label>

      <DefaultsCard defaults={defaults} onChange={setDefaultsOverride} />

      <Flex gap="3" align="center" wrap="wrap">
        <TextField.Root
          type="text"
          className="w-full sm:w-80"
          placeholder={t(
            "notification.offline.search_placeholder",
            "名称 / IP，多个用空格或逗号分隔"
          )}
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setSearch(e.target.value)
          }
          onPaste={handleSearchPaste}
        >
          <TextField.Slot>
            <Search size={16} />
          </TextField.Slot>
        </TextField.Root>
        <StatusSelect
          label={t("notification.offline.offline_switch", "离线 / 上线通知")}
          value={offlineFilter}
          onChange={setOfflineFilter}
        />
        <StatusSelect
          label={t("notification.offline.cn_blocked_switch", "被墙通知")}
          value={cnFilter}
          onChange={setCnFilter}
        />
      </Flex>

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

      {unmatched.length > 0 && (
        <Text size="2" color="red">
          {t("notification.offline.not_found", {
            count: unmatched.length,
            list: unmatched.join(", "),
            defaultValue: "未找到 {{count}} 个：{{list}}",
          })}
        </Text>
      )}

      <Flex gap="2" align="center" wrap="wrap">
        <Text size="2" color="gray">
          {t("notification.offline.showing", {
            shown: filtered.length,
            total: nodes.length,
            defaultValue: "显示 {{shown}} / 共 {{total}} 个节点",
          })}
          {" · "}
          {t("common.selected", { count: selected.length })}
        </Text>
        {filtersActive && (
          <Button size="1" variant="ghost" onClick={clearFilters}>
            {t("notification.offline.clear_filters", "清除筛选")}
          </Button>
        )}
      </Flex>

      <Flex gap="2" align="center" wrap="wrap">
        <Button
          size="2"
          variant="soft"
          disabled={noneSelected}
          onClick={() => runBatchSwitch(OFFLINE_ENDPOINT, true)}
        >
          {t("notification.offline.batch_offline_on", "开启离线通知")}
        </Button>
        <Button
          size="2"
          variant="soft"
          color="gray"
          disabled={noneSelected}
          onClick={() => runBatchSwitch(OFFLINE_ENDPOINT, false)}
        >
          {t("notification.offline.batch_offline_off", "关闭离线通知")}
        </Button>
        <Button
          size="2"
          variant="soft"
          disabled={noneSelected}
          onClick={() => runBatchSwitch(CN_BLOCKED_ENDPOINT, true)}
        >
          {t("notification.offline.batch_cn_on", "开启被墙通知")}
        </Button>
        <Button
          size="2"
          variant="soft"
          color="gray"
          disabled={noneSelected}
          onClick={() => runBatchSwitch(CN_BLOCKED_ENDPOINT, false)}
        >
          {t("notification.offline.batch_cn_off", "关闭被墙通知")}
        </Button>
        <Dialog.Root open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
          <Dialog.Trigger>
            <Button
              variant="soft"
              onClick={() => {
                // 默认取第一个选中项的配置作为初始值
                setBatchForm(valuesOf(selected[0]));
              }}
              disabled={noneSelected}
            >
              {t("notification.offline.batch_edit")}
            </Button>
          </Dialog.Trigger>
          <Dialog.Content>
            <Dialog.Title>{t("notification.offline.batch_edit")}</Dialog.Title>
            <NotificationEditForm
              initialValues={batchForm}
              loading={batchLoading}
              onSubmit={handleBatchEdit}
              onCancel={() => setBatchDialogOpen(false)}
            />
          </Dialog.Content>
        </Dialog.Root>
      </Flex>

      <NotificationTable
        filtered={filtered}
        valuesOf={valuesOf}
        lastNotifiedOf={(uuid) => confByUUID.get(uuid)?.last_notified}
        selected={selected}
        onSelectionChange={setSelected}
      />

      <label className="text-sm text-muted-foreground">
        <span
          dangerouslySetInnerHTML={{ __html: t("notification.offline.tips") }}
        />
      </label>
    </div>
  );
};

// 表头勾选状态：全选 / 部分 / 未选。
const checkState = (uuids: string[], selected: string[]) => {
  if (uuids.length === 0) return false;
  const n = uuids.filter((id) => selected.includes(id)).length;
  return n === 0 ? false : n === uuids.length ? true : "indeterminate";
};

// 节点平铺列表（按权重排序）；分组用上方的分组胶囊筛选，列表里不再分段。
const NotificationTable = ({
  filtered,
  valuesOf,
  lastNotifiedOf,
  selected,
  onSelectionChange,
}: {
  filtered: NodeDetail[];
  valuesOf: (uuid: string) => EditValues;
  lastNotifiedOf: (uuid: string) => string | undefined;
  selected: string[];
  onSelectionChange: (ids: string[]) => void;
}) => {
  const { t } = useTranslation();
  // 勾选 / 取消一批节点，保留其它已选项。
  const toggleMany = (uuids: string[], checked: boolean) => {
    const rest = selected.filter((id) => !uuids.includes(id));
    onSelectionChange(checked ? [...rest, ...uuids] : rest);
  };
  const allUUIDs = filtered.map((n) => n.uuid);
  const columns = 8;

  return (
    <div className="rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-6">
              <Checkbox
                checked={checkState(allUUIDs, selected)}
                onCheckedChange={(checked) => toggleMany(allUUIDs, !!checked)}
              />
            </TableHead>
            <TableHead>{t("common.server")}</TableHead>
            <TableHead>IP</TableHead>
            <TableHead>
              {t("notification.offline.offline_switch", "离线 / 上线通知")}
            </TableHead>
            <TableHead>
              {t("notification.offline.cn_blocked_switch", "被墙通知")}
            </TableHead>
            <TableHead>{t("notification.offline.grace_period")}</TableHead>
            <TableHead>{t("notification.offline.last_notified")}</TableHead>
            <TableHead>{t("common.action")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns} className="text-center">
                <Text size="2" color="gray">
                  {t("notification.offline.no_match", "没有符合条件的节点")}
                </Text>
              </TableCell>
            </TableRow>
          )}
          {filtered.map((node) => (
            <NodeRow
              key={node.uuid}
              node={node}
              values={valuesOf(node.uuid)}
              lastNotified={lastNotifiedOf(node.uuid)}
              checked={selected.includes(node.uuid)}
              onCheckedChange={(checked) => toggleMany([node.uuid], checked)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

const NodeRow = ({
  node,
  values,
  lastNotified,
  checked,
  onCheckedChange,
}: {
  node: NodeDetail;
  values: EditValues;
  lastNotified: string | undefined;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) => {
  const { t } = useTranslation();
  return (
    <TableRow>
      <TableCell>
        <Checkbox
          checked={checked}
          onCheckedChange={(c) => onCheckedChange(!!c)}
        />
      </TableCell>
      <TableCell>{node.name}</TableCell>
      <TableCell>
        <NodeIPs ipv4={node.ipv4} ipv6={node.ipv6} />
      </TableCell>
      <TableCell>
        <InlineSwitch
          uuid={node.uuid}
          checked={values.enable}
          endpoint={OFFLINE_ENDPOINT}
        />
      </TableCell>
      <TableCell>
        <InlineSwitch
          uuid={node.uuid}
          checked={values.cn_blocked}
          endpoint={CN_BLOCKED_ENDPOINT}
        />
      </TableCell>
      <TableCell>
        {values.grace_period}
        {t("nodeCard.time_second")}
      </TableCell>
      <TableCell>
        {(() => {
          if (!lastNotified) return "-";
          const date = new Date(lastNotified);
          if (date.getFullYear() < 3)
            return t("notification.offline.never_triggered");
          return date.toLocaleString();
        })()}
      </TableCell>
      <TableCell>
        <ActionButtons uuid={node.uuid} initialValues={values} />
      </TableCell>
    </TableRow>
  );
};

// NodeIPs 显示节点的 IPv4 / IPv6（各占一行，等宽字体便于核对）；过长的 IPv6 中间省略，悬停看全。
const NodeIPs = ({ ipv4, ipv6 }: { ipv4?: string; ipv6?: string }) => {
  if (!ipv4 && !ipv6) return <span className="text-muted-foreground">-</span>;
  const shortV6 = (ip: string) => {
    const segments = ip.split(":");
    return ip.length > 20 && segments.length > 3
      ? `${segments.slice(0, 2).join(":")}:...${segments[segments.length - 1]}`
      : ip;
  };
  return (
    <div className="flex flex-col font-mono text-xs leading-5">
      {ipv4 && <span>{ipv4}</span>}
      {ipv6 && (
        <span className="text-muted-foreground" title={ipv6}>
          {shortV6(ipv6)}
        </span>
      )}
    </div>
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
          const res = await fetch(
            `${endpoint}/${next ? "enable" : "disable"}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify([uuid]),
            }
          );
          if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error(data?.message || res.statusText);
          }
          await refresh();
        } catch (error) {
          setValue(!next);
          toast.error(
            t("common.error", {
              message: error instanceof Error ? error.message : String(error),
            })
          );
        } finally {
          setSaving(false);
        }
      }}
    />
  );
};

const ActionButtons = ({
  uuid,
  initialValues,
}: {
  uuid: string;
  initialValues: EditValues;
}) => {
  const { t } = useTranslation();
  const { refresh } = useOfflineNotification();
  const [editOpen, setEditOpen] = React.useState(false);
  const [editSaving, setEditSaving] = React.useState(false);

  return (
    <Flex gap="2" align="center">
      <Dialog.Root open={editOpen} onOpenChange={setEditOpen}>
        <Dialog.Trigger>
          <IconButton variant="ghost">
            <Pencil size={16} />
          </IconButton>
        </Dialog.Trigger>
        <Dialog.Content>
          <Dialog.Title>{t("common.edit")}</Dialog.Title>
          <NotificationEditForm
            initialValues={initialValues}
            loading={editSaving}
            onSubmit={(values) => {
              setEditSaving(true);
              fetch(`${OFFLINE_ENDPOINT}/edit`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify([toEditPayload(uuid, values)]),
              })
                .then((res) => {
                  if (!res.ok) {
                    toast.error(
                      "Failed to save offline notification settings: " +
                        res.statusText
                    );
                  }
                  toast.success(t("common.updated_successfully"));
                  return res.json();
                })
                .then(() => {
                  setEditOpen(false);
                  refresh();
                  setEditSaving(false);
                })
                .catch((error) => {
                  console.error(
                    "Error saving offline notification settings:",
                    error
                  );
                  toast.error(t("common.error", { message: error.message }));
                });
            }}
            onCancel={() => setEditOpen(false)}
          />
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
};

export default OfflinePage;
