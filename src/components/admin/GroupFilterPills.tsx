import { Flex } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { GROUP_ALL, GROUP_UNGROUPED } from "@/utils/nodeGroups";

// 分组筛选胶囊：全部 / 未分组 / 各分组，带节点数。样式见 global.css 的 .group-pill。
export const GroupFilterPills = ({
  groups,
  counts,
  total,
  ungroupedCount,
  groupFilter,
  setGroupFilter,
}: {
  groups: string[];
  counts: Record<string, number>;
  total: number;
  ungroupedCount: number;
  groupFilter: string;
  setGroupFilter: (g: string) => void;
}) => {
  const { t } = useTranslation();
  const Pill = ({
    value,
    label,
    count,
  }: {
    value: string;
    label: string;
    count: number;
  }) => (
    <button
      type="button"
      className="group-pill"
      data-active={groupFilter === value}
      onClick={() => setGroupFilter(value)}
      title={label}
    >
      <span
        style={{
          maxWidth: 160,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span className="group-pill-count">{count}</span>
    </button>
  );
  return (
    <Flex gap="2" wrap="wrap" align="center">
      <Pill
        value={GROUP_ALL}
        label={t("admin.group.filterAll", "全部分组")}
        count={total}
      />
      {ungroupedCount > 0 && (
        <Pill
          value={GROUP_UNGROUPED}
          label={t("admin.group.ungrouped", "未分组")}
          count={ungroupedCount}
        />
      )}
      {groups.map((g) => (
        <Pill key={g} value={g} label={g} count={counts[g] ?? 0} />
      ))}
    </Flex>
  );
};
