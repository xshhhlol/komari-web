# 网页终端 vim「卡死/无交互」事故记录（2026-06 ~ 2026-07-08 根治）

## 现象

网页终端里打开 vim：屏幕画到一半（只有波浪线），随后**任何按键无反应**，整个终端假死。
本地 terminal SSH 到同一台机器一切正常。dev 模式（`vite dev`）**永远复现不了**，只有生产压缩构建出问题。

## 真正根因（真浏览器 E2E + WS 逐帧抓包实证）

1. `@xterm/xterm` 6.0 官方发布的 `lib/xterm.mjs` 是**预压缩**代码，`requestMode`
   （DECRQM 查询处理器）里使用了 ES2021 语法 `r||={}`；
2. 本项目 vite 构建的默认 build target 包含 firefox78（不支持 `||=`），esbuild
   降级重写该语法并做变量重命名时丢失声明，产出：

   ```js
   requestMode(e,t){(g=>(...))(void 0||(i={}))   // i 无任何声明！
   ```

3. ESM 严格模式下对未声明变量赋值 → `ReferenceError: i is not defined`；
4. vim 在 `TERM=xterm*` 下启动**必然**发 DECRQM 探测（`\e[?12$p`）→ 一命中该函数,
   xterm.js 解析器崩溃 → 之后所有输出不再渲染,「vim 卡死」。

## 修复

`vite.config.ts` → `build.target: "es2022"`（komari-web radix `25fbdc2`，随面板 2.20.1 发布）。
`||=` 不再被降级重写，产物正确。

**不要把 target 降回 es2021 以下**；升级 `@xterm/xterm` 或改动构建链后，检查 dist
产物有无「对未声明变量赋值」的损坏模式（已由 `script/check-dist.mjs` 在每次
`npm run build` 时自动把关，命中即构建失败）。

## 曾经的错误结论（勿再采信）

- ~~「vim 卡死是 xterm.js 不应答 XTGETTCAP」~~ → 实测 vim 8.0/8.1/9.0/9.1 没有那些
  应答也不卡。终端页的 DCS `0+r` 应答保留（无害、可免 vim 等待超时），但它不是修复。
- ~~「agent TERM=screen-256color 修复了卡死」~~ → 只是规避：screen 系 TERM 下 vim
  不发 xterm 探测（含 DECRQM），绕开了前端崩溃点。agent 现用 `TERM=xterm-256color`
  是正确终态（vim 只在 xterm* 下自动开 bracketed paste，网页粘贴才不会被 autoindent
  弄成阶梯缩进），有 `KOMARI_AGENT_TERM` 环境变量可临时覆盖。

## 快速复现/验证方法

- 关键信号：浏览器控制台的 `pageerror`（Playwright `page.on("pageerror")` 一抓一个准）；
  dev 正常、build 异常 ⇒ 优先怀疑压缩/降级。
- 对压缩产物做 E2E：`VITE_API_TARGET=<面板地址> npx vite preview`（preview 已配与 dev
  相同的 /api 代理，含 WebSocket），真浏览器打开 `/terminal?uuid=...` 试 vim。
- 面板侧隔离环境：任选一台被控机，用面板二进制 `KOMARI_LISTEN=127.0.0.1:<port>` 起服务
  （首次启动 stdout 打印 admin 密码），`komari-agent -e http://127.0.0.1:<port> -t <token>
  --disable-auto-update` 即可，全程不影响生产。
