// 节点分组的公共工具：后台「服务器」列表与「节点通知」页共用。

// 分组过滤的特殊取值（"" 不能作为 Radix Select 的 value）
export const GROUP_ALL = "__all__";
export const GROUP_UNGROUPED = "__ungrouped__";

// 从节点列表中提取去重、排序后的分组名（忽略空分组）
export const getGroups = (nodes: { group?: string }[]): string[] =>
  Array.from(
    new Set(nodes.map((n) => (n.group || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

// 解析全局分组顺序设置（";" 分隔）。
export const parseGroupOrder = (groupOrder?: string): string[] =>
  (groupOrder || "")
    .split(";")
    .map((g) => g.trim())
    .filter(Boolean);

// 把分组按全局顺序排列：已在顺序表中的按其位置，未列出的（如新分组）按字母序追加在后。
export const orderGroups = (
  groups: string[],
  groupOrder?: string
): string[] => {
  const order = parseGroupOrder(groupOrder);
  const rank = new Map(order.map((g, i) => [g, i]));
  const rankOf = (g: string) =>
    rank.has(g) ? rank.get(g)! : Number.POSITIVE_INFINITY;
  return [...groups].sort((a, b) => {
    const ra = rankOf(a);
    const rb = rankOf(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
};
