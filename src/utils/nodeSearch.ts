// 节点搜索的公共逻辑：后台「服务器」列表与「节点通知」页共用。
// 按名称或 IP 搜，可一次输入 / 粘贴多个关键字（空格、逗号、分号、换行分隔，含全角），多个之间是"或"。
import type React from "react";

type Searchable = { name: string; ipv4?: string; ipv6?: string };

export const parseKeywords = (search: string): string[] =>
  search
    .split(/[\s,;，；]+/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);

export const nodeMatchesKeyword = (node: Searchable, keyword: string) =>
  [node.name, node.ipv4, node.ipv6].some((v) =>
    (v || "").toLowerCase().includes(keyword)
  );

export const nodeMatchesKeywords = (node: Searchable, keywords: string[]) =>
  keywords.length === 0 || keywords.some((k) => nodeMatchesKeyword(node, k));

// 一次搜多个时，返回在所有节点里都找不到的关键字，方便核对漏了哪台。
export const unmatchedKeywords = (nodes: Searchable[], keywords: string[]) =>
  keywords.length > 1
    ? keywords.filter((k) => !nodes.some((n) => nodeMatchesKeyword(n, k)))
    : [];

// 粘贴多行（如一列 IP）时把换行换成空格：单行输入框会直接吞掉换行，把 IP 粘成一串。
export const pasteAsKeywords = (
  e: React.ClipboardEvent<HTMLInputElement>,
  setValue: (value: string) => void
) => {
  const text = e.clipboardData.getData("text");
  if (!/[\r\n]/.test(text)) return;
  e.preventDefault();
  const el = e.currentTarget;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  const cleaned = text.replace(/[\r\n]+/g, " ").trim();
  setValue(
    `${el.value.slice(0, start)} ${cleaned} ${el.value.slice(end)}`.trim()
  );
};
