# AGENTS.md — DSH 插件开发工作手册

在本仓库（或任何 dsh 插件仓库）里做插件时，按本手册执行。它只记录**已在本机验证过**的路径与坑；没验证的地方会显式标注。

## 0. 权威来源（先读，别背我这份）

| 内容 | 位置 |
|---|---|
| 插件开发总纲（技能） | `skill` 工具加载 `cordis-plugin-development` |
| 技能参考文件 | `E:\develop-lcb\apps\dsh\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-agent-preset\skills\cordis-plugin-development\references\` （`host-plugin.md`、`ui-plugin.md`、`practices.md`、`user-actions.md`、`verification.md`） |
| 模板 | 同目录 `templates/decoration/`、`templates/mcp/` |
| 运行时真相 | `cordis_inspect_list` / `cordis_inspect_query`：Service、Event、Config、Tool、Slots、Theme |

**关键事实**：随包发布的只有运行时代码（`lib/index.js`），**`.d.ts` 类型声明被裁掉了**。所以接口细节只能靠 inspect 和运行时读代码，不要指望翻类型文件。

**asm 读法**：`app.asar` 里的文件只能用 `read` 工具按确切路径读；`ls`/`grep`/`glob`/`node` 全都打不开 asar（它们走原生进程，不认识 asar）。

## 1. 先决定做哪种插件

| 形态 | 适用 | 最小文件 |
|---|---|---|
| **Host-only bundle** | 加工具、接系统、加服务 | `package.json` + `cordis.patch.yml` + `index.js` |
| **Host + Client** | 上面 + 自定义 UI | 再加 `client.js` |
| 纯配置 bundle | 只开/配一个已发布插件（如 MCP） | `package.json` + `cordis.patch.yml` |

选型原则：**能用工具解决就不要做 UI**。工具的验证是客观的（能调用、有返回），UI 的验证要靠眼睛。

## 2. 契约发现：三查，不要猜

```text
cordis_inspect_list                                  # 有哪些 provider
cordis_inspect_query  host    Service  listService   # 服务目录（紧凑）
cordis_inspect_query  host    Service  listService  {service:"tools"}   # 精确方法签名 + 引用类型
cordis_inspect_query  client  Slots    listSubTree  {root:"<slot 名>"}  # 插槽 registration/ownerProps/occupants
cordis_inspect_query  client  Theme    listTokens    # 主题 token 名
cordis_inspect_query  host    Config   listConfigs  {name:"<包名>"}      # → packageDir
cordis_inspect_query  host    Config   listConfigs  {entry:"<entryId>"}  # → schema + packageDir
```

`Config.listConfigs` 拿到的 `packageDir` 就是读源码的入口（README + `lib/index.js` 的 JSDoc）。

## 3. 包骨架（可直接抄）

`package.json`（Host + Client 版）：

```json
{
  "name": "dsh-plugin-<name>",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg", "README.md", "LICENSE"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-ui-conversation"] }
  }
}
```

`cordis.patch.yml`：

```yaml
- insert:
    - id: <row-id>            # 插件行 id，之后 set_plugin 用它
      name: dsh-plugin-<name>  # 必须等于包名
```

`locale/en.json` 与 `locale/zh.json` 必须各有 `meta.title` / `meta.description`（插件管理页与市场卡片读它们，且不激活插件就能读到）。图标 SVG/PNG/JPEG/WebP ≤ 256 KiB，必须在包内。

## 4. Host 半边

```js
export const name = '<row-id>'
export const inject = ['tools']            // 可选服务放这里，缺失时插件不激活而不是抛错

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(definition))   // 注册即 effect，返回 disposer
}
```

`ToolDefinition` 的精确字段（已核实）：

```ts
{
  name, description, parameters: JSONSchema,      // 模型可见的三件套
  output: {
    schema: JsonSchemaNode,                       // 返回值校验
    render(args, value): ContentBlock[]           // 给模型看的 content；文本块是 { type:'text', text }
  },
  execute(args, exec): Promise<unknown>,          // 返回 JSON 值
  isConcurrencySafe?(args): boolean,
  timeoutMs?: number,
  presentCall? / presentResult?                   // 可选：自定义卡片视图（走内建渲染器）
}
```

约束：
- 工具名 `run_code` 保留；同层重名会失败。
- `parameters` 是**受约束的 JSON Schema 子集**：标量 `type`、`properties`/`required`/`additionalProperties`、`items`、标量 `enum`/`const`、恰好一个 `oneOf`。
- 错误要分类清楚：区分"命令不存在"和"命令失败"，别把两者合并——这是 v1 的真实缺陷。
- 只读工具在描述里写明"只读、离线、不执行项目代码"，便于模型判断何时调用。

## 5. Client 半边

```js
window.__ModuleLoader__.load({
  id: '<包名>',                     // 必须等于包名
  factory(require) {
    const React = require('react')  // React 来自浏览器的模块表，不要自装、不要 CDN
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('<slot 名>', () =>
          ctx.slots.register({ name: '<slot 名>', key: '<key>' }, Component))
      },
    }
  },
})
```

- 列表插槽用 `id` 注册，键控插槽用 `key`；
- `ctx.slots.inject(ownerKey, cb)` 的注册随所属声明卸载/重建，**不要在组件里写 DOM、不要碰 `document.body`**；
- 样式用主题 token（`--dsw-alias-*`），**不要 import 任何 `@deepseek-ai/dsh-client-*` 包**——它们随时变，且组件抛异常会让整个插槽条目变空白（控制台：`slot entry crashed in '<slot>'`）；
- 组件里任何可能抛的外部调用（订阅、locale、解析）都要 try/catch 兜住；
- 明暗主题：只用 token，不要写字面色（字面色仅用于图形资源）。

## 6. 安装、热更新、卸载

```text
plugin_manager  action: install_bundle  target: <包的绝对目录>          # 本地开发：以链接方式安装
plugin_manager  action: install_bundle  target: git+https://…#<commit>   # 从发布源安装
plugin_manager  action: set_plugin      target: include:<row-id> enabled: false|true
plugin_manager  action: remove_bundle   target: <包名>
```

- **Host 代码改动不会自动生效**。链接安装后改 `index.js`，必须 `set_plugin` 关一次再开一次才会加载新的一代模块（HMR 不接管链接目录）。已在 v1 验证。
- **Client 代码改动要刷新页面**。客户端模块图在页面启动时读取；不刷新就不会有新组件。
- 装完先看返回的 `application: applied`，不要用日志或进程状态推断。

## 7. 验证：什么能客观证明，什么不能

能：

- 工具是否可见：`cordis_inspect_query host Tool listTools`
- 工具是否真能跑：直接调用它，看返回值
- 客户端是否注册：`cordis_inspect_query client Slots listSubTree {root:"<slot>"}`，在 `selected.occupants` 里找你的 `key`
- 包是否完整：从发布 commit 克隆后 `git ls-tree` 看文件齐不齐

不能：

- **渲染长相**。没有浏览器控制时只能靠人眼看。别把"安装成功"说成"界面对了"。
- 状态：本仓库的 Client 卡片**已安装、已语法检查，但尚未在活动页面里观察到注册**（需要刷新页面后确认）。

## 8. Windows 已知坑（都真实踩过）

1. **不要把工作区链接进 profile，又用同名包覆盖它。** 链接安装会在 `node_modules\<pkg>` 建 Junction；pnpm 在该位置做删除/rename 时可能**穿透到链接目标**，把工作区里的文件删掉（本项目曾因此丢失大半个 `.git`）。要覆盖就先 `remove_bundle`，确认链接点已消失，再装新目标。
2. `remove_bundle` 只清清单，**可能留下 Junction**；用 `cmd /c rmdir "<link>"` 只摘链接（不要用 `Remove-Item -Recurse`，它会跟进去删）。
3. **EPERM 是常态，先重试一次。** profile 根目录的 `package.json` rename 偶发 EPERM（被瞬时占用），重试即成功。判断依据：先用 `[System.IO.File]::Open(..., 'None')` 看是否真被锁。
4. **cmd 输出是 GBK，不是 UTF-8。** Node 的 `exec` 默认按 UTF-8 解码，中文报错会变乱码，导致"命令不存在"匹配不上而被误判成"执行失败"。要在 `exec` 里用 `encoding:'buffer'` + 检测替换字符后回退 `new TextDecoder('gbk')`。
5. `core.autocrlf=true`：`git reset --hard` 后工作区是 CRLF，逐文件 hash 比对会全部"不同"，比较时要先规范化行尾。
6. `pnpm`/`gh` 可能不在 `PATH`（DSH 自带 pnpm）。别假设 shell 能直接调 `pnpm`——安装依赖一律走 `plugin_manager`。

## 9. 发布到 GitHub + 插件市场

市场不是一个固定站点，而是**用户配置的索引 URL 列表**（`@deepseek-ai/dsh-plugin-market`，默认空）。

```powershell
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
git tag -a v<版本> -m "<包名> <版本>"; git push origin v<版本>
node scripts/build-index.mjs      # 从 package.json + locale + origin + HEAD 生成 index.json
```

索引格式要点（format 1，校验器 `@deepseek-ai/dsh-plugin-market-index`）：

- `format: 1`、`title`（本地化对象，**必须含 `en`**）、`plugins[]`；
- 每个 `versions[]` 必须有 `version`（精确 SemVer）、`publishTimestamp`（Unix 秒整数）、`source`；
- `source` 两种：`{ type:'npm' }` 或 `{ type:'git', url, commit }`——**commit 必须是 40 位小写 SHA**，可带 `path`（包在子目录时）；
- `icon` 可写相对路径（相对索引 URL 解析），也可 `data:` 内联（≤ 32 KiB 解码后）；
- **`engines.dsh` 慎填**：预发布版本（如 `0.2.1-rc.2`）默认不满足 `>=0.2.0` 这类范围，会被判为不兼容。没把握就留空。

**发布前必须用官方校验器验一遍**（不要肉眼检查）：

```powershell
npm install --prefix $env:TEMP\market-validate @deepseek-ai/dsh-plugin-market-index
node validate.mjs <index.json> <index 的 URL>
# 期望输出：VALID format=1 plugins=N + 每条 install 目标
```

索引可托管在任何 http(s) 静态地址：

- `https://raw.githubusercontent.com/<owner>/<repo>/main/index.json` —— **最快可用，无需配置**；
- `https://<owner>.github.io/<repo>/index.json` —— 需要 Public 仓库 + 在 Settings → Pages 选 `main` / root。

**索引源只能在 Settings → Plugins → Discover 里添加**：`plugin_market` 不能改索引源，`plugin_manager` 也没有这个动作。加完之后可以用 `plugin_market action:list_plugins target:<url>` 验证服务端读到的条目、`installation.status` 与 `install.target`。

`index.json` 钉的是具体 commit，所以**每次发布都要重新生成**，否则装到的是旧代码。

## 10. 交付前检查表

- [ ] `node --check` 过全部 JS；`package.json` / locale 是合法 JSON
- [ ] `locale/en.json` + `zh.json` 的 `meta.title`/`meta.description` 描述的是**本插件**，不是模板文案
- [ ] 图标是有效图形且在本包内
- [ ] `install_bundle` 返回 `application: applied`，`warnings` 为空
- [ ] 工具真实调用过一次，返回值符合 `output.schema`
- [ ] 有 Client 半边：刷新页面后 `Slots` 的 `occupants` 里能看到自己的 `key`
- [ ] 改了 Host 代码 → 已 disable/enable 确认新代码生效
- [ ] README 写清安装方式（本地目录 / npm / 市场索引）与发布步骤
- [ ] `index.json` 已重新生成并通过官方校验器
- [ ] 指标性结论只写**观察到的**；没目视验证的写"未验证"

## 11. 本仓库现状（作为范例）

| 项 | 值 |
|---|---|
| 包名 | `dsh-plugin-env-doctor` |
| 形态 | Host 工具 `env_doctor` + Client 卡片（`tool.call.toolview`，key = `env_doctor`） |
| 市场索引 | `https://raw.githubusercontent.com/GitHub-lcb/dsh-plugin-env-doctor/main/index.json` |
| 已验证 | Host 工具端到端；从发布 commit 安装；索引格式 |
| 未验证 | 卡片在活动页面里的渲染长相 |
