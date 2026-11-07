// 构建产物防回归检查：检测「对未声明变量赋值」的压缩损坏模式。
// 背景：@xterm/xterm 6.0 预压缩代码里的 `r||={}` 被低 target 降级重写后曾产出
// `void 0||(i={})`（i 无声明），严格模式下 ReferenceError 导致网页终端假死。
// 详见 docs/xterm-vim-freeze.md。命中即让构建失败。
import fs from "node:fs";
import path from "node:path";

const dir = "dist/assets";
const bad = /void 0\|\|\([a-zA-Z_$][\w$]*=\{\}\)/;
const hits = [];

for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith(".js")) continue;
  const m = fs.readFileSync(path.join(dir, f), "utf8").match(bad);
  if (m) hits.push(`${f}: ...${m[0]}...`);
}

if (hits.length) {
  console.error("[check-dist] 检测到疑似压缩损坏（对未声明变量赋值），构建终止。");
  console.error("[check-dist] 详见 docs/xterm-vim-freeze.md（build.target 不得低于 es2021）：");
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
// 后端用 //go:embed 打包 dist，会静默忽略以 "_" 或 "." 开头的文件，
// 这类产物上线后直接 404（例如 _layout 的 CSS 丢失，后台样式全无）。
const hidden = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.name.startsWith("_") || e.name.startsWith(".")) hidden.push(p);
    if (e.isDirectory()) walk(p);
  }
};
walk("dist");
if (hidden.length) {
  console.error("[check-dist] 以下产物以 _ 或 . 开头，会被 go:embed 忽略，构建终止：");
  for (const h of hidden) console.error("  " + h);
  process.exit(1);
}

console.log("[check-dist] OK: 未发现压缩损坏模式，也没有会被 go:embed 忽略的文件");
