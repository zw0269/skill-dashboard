# AI 操作日志

记录所有由 AI（Claude）完成的开发操作，按时间顺序排列。
格式：`[日期] 操作类型 — 描述`

---

## 2026-04-08  Phase 1：项目立项与方案设计

**操作：调研 + 设计**
- 扫描 `E:\Skill研究` 目录，识别出 9 个 skill/agent 集合
- 发现两类元数据格式：带 YAML frontmatter 的 SKILL.md、agency-agents 扁平 *.md
- 调研同类工具（Understand-Anything、Dashboard Creator、awesome-claude-code-toolkit）
- 输出 `DESIGN.md`（技术方案）和 `todolist.md`（任务清单）

**决策记录**
- 选择零依赖方案（不引入 gray-matter / marked）
- 端口设为 10010（用户后调整为 8082）
- 使用 scan-config.json 配置驱动，新增集合无需改代码

---

## 2026-04-08  Phase 2：核心功能实现

### 创建文件

| 文件 | 说明 |
|---|---|
| `package.json` | `type:module`, `engines: node>=24`，零外部依赖 |
| `scan-config.json` | 集合配置文件，扩展入口 |
| `lib/frontmatter.mjs` | 零依赖 YAML frontmatter 解析器 |
| `scanner.mjs` | 目录扫描器，生成 `data/index.json` |
| `server.mjs` | Node 24 HTTP 服务器，端口 10010 |
| `public/index.html` | 单页应用骨架 |
| `public/style.css` | 深色主题 CSS |
| `public/app.js` | 客户端逻辑 |
| `.gitignore` | 忽略 `data/`、`node_modules/` |
| `README.md` | 完整使用文档 |

### 扫描结果
首次扫描：**296 条**（后续修复后 283 条）

| 集合 | 数量 |
|---|---|
| gstack | 34 |
| pua | 16 |
| agency-agents | 167 |
| awesome-design | 57 |
| ui-ux-pro-max | 7 |
| harness | 1 |
| tong-jincheng | 1 |

---

## 2026-04-08  Phase 3：Bug 修复与功能完善

### Bug 修复

**Bug 1：scanner.mjs 被 import 时自动运行**
- 原因：顶层 `runScan()` 调用无 guard
- 修复：添加 `process.argv[1]` 对比 `import.meta.url` 的 isMain 守卫
- 文件：`scanner.mjs`

**Bug 2：design-doc 名字全部显示为 "DESIGN"**
- 原因：`inferNameFromPath()` 对 `DESIGN.md` 未特殊处理
- 修复：DESIGN.md 使用父目录名（品牌名，如 "airbnb"）作为显示名
- 文件：`scanner.mjs`

**Bug 3：重复检测误标所有 design-doc**
- 原因：所有 `DESIGN.md` 文件名相同触发重复检测
- 修复：Bug 2 修复后品牌名各不相同，自然解决；文档记录"只标跨集合同名"规则
- 文件：`scanner.mjs`

**Bug 4：trigger keywords 截断成整句话**
- 原因：正则匹配范围过宽，`> 35 字符` 未过滤
- 修复：增加 `≤ 35 字符` 过滤，优化引号匹配逻辑
- 文件：`lib/frontmatter.mjs`

### 新增功能

| 功能 | 实现位置 |
|---|---|
| 增量扫描（mtime 缓存）| `scanner.mjs` + `data/scan-cache.json` |
| `--rebuild` 全量重扫标志 | `scanner.mjs` CLI |
| URL hash 状态同步 | `public/app.js` |
| 侧边栏标签云 | `public/app.js` |
| 收藏夹（localStorage）| `public/app.js` |
| `/api/health` 接口 | `server.mjs` |
| 路由表（ROUTES 数组）| `server.mjs` |
| 请求日志（带颜色）| `server.mjs` |

---

## 2026-04-09  Phase 4：修复 403 + 侧边栏联动

### Bug 修复

**Bug 5：`/api/raw` 返回 403 Forbidden**
- 原因：`safePath()` 使用硬编码 `'/'` 做路径前缀校验
  ```
  abs  = "E:\Skill研究\gstack\qa-only\SKILL.md"  (Windows 反斜杠)
  root = "E:\Skill研究"
  check: abs.startsWith(root + '/')  →  false！(混用 \ 和 /)
  ```
- 修复：将 `'/'` 改为 `path.sep`（Windows 上为 `\\`），同时在 import 中添加 `sep`
- 文件：`server.mjs`
- 验证：`node -e "..."` 确认 `abs.startsWith(root + sep)` 返回 true

### 功能修改

**移除翻译功能（用户要求）**
- 删除 `server.mjs`：`httpsRequest` import、`callClaude()`、`handleTranslate()`、路由
- 删除 `app.js`：`translateEntry()`、`renderSummaryText()`、"中文概要"按钮
- 删除 `style.css`：`.summary-panel`、`.summary-loading`、`.spinner`

**侧边栏三区联动**
- 设计：Collection 是"根"维度，改变 collection → type 和 tags 区联动更新
- 实现：`applyFilters()` 先计算 `colVisible`（仅 collection 过滤），传入 `renderTypeFilter(colVisible)` 和 `renderTagCloud(colVisible)`
- 全选按钮：三区各自加"全选"按钮（`.sb-selectall`），分别清除对应 filter state
- 空状态：tags 为空时显示 `<span class="sb-empty">暂无标签</span>`
- 文件：`app.js`、`style.css`、`index.html`

---

## 变更文件汇总

```
skill-dashboard/
├── .gitignore             新建
├── AI_OPERATIONS_LOG.md   新建（本文件）
├── DESIGN.md              新建
├── MAINTENANCE.md         新建
├── README.md              修改（内容更新）
├── package.json           新建
├── scan-config.json       新建
├── scanner.mjs            新建 → 多次修改
├── server.mjs             新建 → 多次修改（403修复、翻译移除）
├── todolist.md            新建 → 更新进度
├── lib/
│   └── frontmatter.mjs    新建 → 修改（trigger keyword 质量）
└── public/
    ├── index.html         新建 → 修改（侧边栏骨架简化）
    ├── style.css          新建 → 多次修改（联动样式、翻译样式删除）
    └── app.js             新建 → 多次修改（联动逻辑、翻译删除）
```

---

## AI 工具使用记录

| 工具 | 使用次数（估算）| 主要用途 |
|---|---|---|
| WebSearch | 2 | 调研同类方案 |
| Bash | 15+ | 扫描验证、语法检查、服务器测试 |
| Read | 20+ | 读取现有代码确认结构 |
| Write | 12 | 创建新文件 |
| Edit | 20+ | 修改现有文件 |
| Grep/Glob | 10+ | 定位代码位置 |
