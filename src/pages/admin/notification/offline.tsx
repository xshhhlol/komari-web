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
} from "@/contexts/NodeDetailsContext";
import {
  OfflineNotificationProvider,
  useOfflineNotification,
  type OfflineNotification,
} from "@/contexts/NotificationContext";
import React from "react";
import { Pencil, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  Flex,
  IconButton,
  Switch,
  TextField,
} from "@radix-ui/themes";
import { toast } from "sonner";
import Loading from "@/components/loading";
import Tips from "@/components/ui/tips";

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

// 节点没有配置行时的默认值：离线通知关、被墙通知开（与后端默认一致）。
const configOf = (n: OfflineNotification | undefined): EditValues => ({
  enable: n?.enable ?? false,
  cooldown: n?.cooldown ?? 1800,
  grace_period: n?.grace_period ?? 300,
  cn_blocked: !(n?.cn_blocked_muted ?? false),
});

const toEditPayload = (client: string, v: EditValues) => ({
  client,
  enable: v.enable,
  cooldown: v.cooldown,
  grace_period: v.grace_period,
  cn_blocked_muted: !v.cn_blocked,
});

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
  // const [cooldown, setCooldown] = React.useState(initialValues.cooldown);
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
      {/* <label htmlFor="cooldown">{t("notification.offline.cooldown")}</label>
      <TextField.Root
        type="number"
        min={0}
        value={cooldown}
        onChange={e => setCooldown(Number(e.target.value))}
        id="cooldown"
        name="cooldown"
      /> */}
      <label htmlFor="grace_period" className="flex items-center gap-2">
        {t("notification.offline.grace_period")}
        <Tips>{t("notification.offline.grace_period_tip")}</Tips>
      </label>
      <TextField.Root
        type="number"
        min={0}
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

const InnerLayout = () => {
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const {
    loading: onLoading,
    error: onError,
    offlineNotification,
    refresh,
  } = useOfflineNotification();
  const { isLoading: onNodeLoading, error: onNodeError } = useNodeDetails();
  const { t } = useTranslation();
  const [batchLoading, setBatchLoading] = React.useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = React.useState(false);
  const [batchForm, setBatchForm] = React.useState<EditValues>({
    enable: true,
    cooldown: 1800,
    grace_period: 300,
    cn_blocked: true,
  });

  // 批量修改
  const handleBatchEdit = (values: EditValues) => {
    setBatchLoading(true);
    const payload = selected.map((id) => toEditPayload(id, values));
    fetch("/api/admin/notification/offline/edit", {
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
  return (
    <div className="flex flex-col gap-4 md:p-4 p-1">
      <Flex justify="between" align="center" wrap="wrap">
        <label className="text-2xl font-semibold">
          {t("notification.offline.full_title", "节点通知设置")}
        </label>
        <TextField.Root
          type="text"
          className="max-w-64"
          placeholder={t(
            "notification.offline.search_placeholder",
            "搜索名称 / IP"
          )}
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setSearch(e.target.value)
          }
        >
          <TextField.Slot>
            <Search size={16} />
          </TextField.Slot>
        </TextField.Root>
      </Flex>
      <OfflineNotificationTable
        search={search}
        selected={selected}
        onSelectionChange={setSelected}
      />
      <label className="text-sm text-muted-foreground">
        {t("common.selected", {
          count: selected.length,
        })}
      </label>
      <Flex gap="2" align="center">
        <Dialog.Root open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
          <Dialog.Trigger>
            <Button
              variant="soft"
              onClick={() => {
                // 默认取第一个选中项的配置作为初始值
                const first = offlineNotification.find(
                  (n) => n.client === selected[0]
                );
                setBatchForm(
                  first
                    ? configOf(first)
                    : { ...configOf(undefined), enable: true }
                );
              }}
              disabled={batchLoading || selected.length === 0}
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
      <label className="text-sm text-muted-foreground">
        <span
          dangerouslySetInnerHTML={{ __html: t("notification.offline.tips") }}
        />
      </label>
    </div>
  );
};

const OfflineNotificationTable = ({
  search,
  selected,
  onSelectionChange,
}: {
  search: string;
  selected: string[];
  onSelectionChange: (ids: string[]) => void;
}) => {
  const { offlineNotification } = useOfflineNotification();
  const { nodeDetail } = useNodeDetails();
  const { t } = useTranslation();
  // 名称、IPv4、IPv6 任一包含关键字即命中（节点多按 IP 找）。
  const keyword = search.trim().toLowerCase();
  const filtered = [...nodeDetail]
    .sort((a, b) => a.weight - b.weight)
    .filter(
      (node) =>
        !keyword ||
        [node.name, node.ipv4, node.ipv6].some((v) =>
          (v || "").toLowerCase().includes(keyword)
        )
    );
  return (
    <div className="rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-6">
              <Checkbox
                checked={
                  selected.length === filtered.length
                    ? true
                    : selected.length > 0
                    ? "indeterminate"
                    : false
                }
                onCheckedChange={(checked) =>
                  onSelectionChange(checked ? filtered.map((n) => n.uuid) : [])
                }
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
            {/* <TableHead>{t("notification.offline.cooldown")}</TableHead> */}
            <TableHead>{t("notification.offline.grace_period")}</TableHead>
            <TableHead>{t("notification.offline.last_notified")}</TableHead>
            <TableHead>{t("common.action")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((node) => {
            const conf = offlineNotification.find(
              (n) => n.client === node.uuid
            );
            const values = configOf(conf);
            return (
              <TableRow key={node.uuid}>
                <TableCell>
                  <Checkbox
                    checked={selected.includes(node.uuid)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onSelectionChange([...selected, node.uuid]);
                      } else {
                        onSelectionChange(
                          selected.filter((id) => id !== node.uuid)
                        );
                      }
                    }}
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
                    endpoint="/api/admin/notification/offline"
                  />
                </TableCell>
                <TableCell>
                  <InlineSwitch
                    uuid={node.uuid}
                    checked={values.cn_blocked}
                    endpoint="/api/admin/notification/offline/cn-blocked"
                  />
                </TableCell>
                {/* <TableCell>
                {offlineNotification.find((n) => n.client === node.uuid)
                  ?.cooldown || 1800}{" "}
                {t("nodeCard.time_second")}
              </TableCell> */}
                <TableCell>
                  {conf?.grace_period || 300}
                  {t("nodeCard.time_second")}
                </TableCell>
                <TableCell>
                  {(() => {
                    const lastNotified = conf?.last_notified;
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
          })}
        </TableBody>
      </Table>
    </div>
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
              fetch("/api/admin/notification/offline/edit", {
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
