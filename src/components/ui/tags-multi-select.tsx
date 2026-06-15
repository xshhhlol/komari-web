import * as React from "react";
import { Badge } from "@radix-ui/themes";
import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

// 去掉标签末尾的 <color> 颜色标记，仅用于展示
const stripColor = (tag: string) => tag.replace(/<\w+>$/, "").trim();

export type TagsMultiSelectProps = {
  /** 原始 ";" 分隔的标签字符串（保留 <color> 标记） */
  value: string;
  onChange: (value: string) => void;
  /** 已有标签（聚合自所有节点），作为下拉建议 */
  options?: string[];
  placeholder?: string;
  /** 「新建 "xxx"」文案，{tag} 会被替换 */
  createLabel?: string;
  className?: string;
};

/**
 * 标签多选输入框：已选标签以可删除的胶囊展示，
 * 输入可从已有标签中筛选选择，或回车新建。保留 <color> 语法。
 */
export function TagsMultiSelect({
  value,
  onChange,
  options = [],
  placeholder,
  createLabel,
  className,
}: TagsMultiSelectProps) {
  const tokens = React.useMemo(
    () =>
      value
        .split(";")
        .map((t) => t.trim())
        .filter(Boolean),
    [value]
  );

  const [input, setInput] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const commit = (next: string[]) => {
    const seen = new Set<string>();
    const cleaned = next
      .map((t) => t.trim())
      .filter((t) => {
        if (!t || seen.has(t)) return false;
        seen.add(t);
        return true;
      });
    onChange(cleaned.join(";"));
  };

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (tag && !tokens.includes(tag)) commit([...tokens, tag]);
    setInput("");
    setOpen(false);
  };

  const removeTag = (tag: string) => commit(tokens.filter((t) => t !== tag));

  const suggestions = React.useMemo(() => {
    const text = input.trim().toLowerCase();
    return options
      .filter((o) => !tokens.includes(o))
      .filter((o) => (text ? stripColor(o).toLowerCase().includes(text) : true))
      .slice(0, 20);
  }, [options, tokens, input]);

  const trimmed = input.trim();
  const canCreate =
    trimmed.length > 0 &&
    !tokens.includes(trimmed) &&
    !options.includes(trimmed);

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && input === "" && tokens.length > 0) {
      removeTag(tokens[tokens.length - 1]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  React.useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(ev.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open]);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 min-h-9 cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {tokens.map((tag) => (
          <Badge
            key={tag}
            variant="soft"
            radius="full"
            className="flex items-center gap-1"
          >
            {stripColor(tag)}
            <button
              type="button"
              className="inline-flex cursor-pointer opacity-70 hover:opacity-100"
              aria-label={`remove ${stripColor(tag)}`}
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag);
              }}
            >
              <X size={12} />
            </button>
          </Badge>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={tokens.length === 0 ? placeholder : ""}
          className="flex-1 min-w-24 bg-transparent outline-none text-sm py-0.5"
        />
      </div>

      {open && (suggestions.length > 0 || canCreate) && (
        <div className="absolute left-0 right-0 z-50 mt-1 rounded-md border bg-accent-1 text-popover-foreground shadow-md max-h-60 overflow-auto p-1">
          {canCreate && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-left font-semibold hover:bg-accent hover:text-accent-foreground"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addTag(input)}
            >
              <Plus size={14} />
              {(createLabel ?? 'Create "{tag}"').replace("{tag}", trimmed)}
            </button>
          )}
          {suggestions.map((o) => (
            <button
              key={o}
              type="button"
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addTag(o)}
            >
              {stripColor(o)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default TagsMultiSelect;
