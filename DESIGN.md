# Skill 可视化面板 — 设计方案

> 目标：为 `E:\Skill研究` 下的多套 Claude Code Skill / Agent 集合做一个本地可视化浏览面板，
> 解决「下载太多、不知道用哪个」的痛点。

## 一、需求拆解

| # | 需求 | 说明 |
|---|---|---|
| 1 | **聚合浏览** | 一处看到所有 skill / agent，无需挨个翻文件夹 |
| 2 | **快速检索** | 按名称、描述、tag、所属集合、工具权限过滤 |
| 3 | **详情预览** | 点击查看 SKILL.md 全文（Markdown 渲染） |
| 4 | **重复识别** | 同名或语义相近的 skill 自动并排提示 |
| 5 | **使用引导** | 显示触发关键词、调用方式（slash command / proactive） |
| 6 | **离线本地** | 全本地运行，无需联网，启动一条命令 |

## 二、调研到的同类方案（可借鉴）

| 方案 | 借鉴点 |
|---|---|
| [Understand-Anything](https://github.com/Lum1104/Understand-Anything) | 知识图谱式交互 dashboard、节点点击展开 |
| [Dashboard Creator skill](https://mcpmarket.com/tools/skills/dashboard-creator-1) | HTML + SVG 卡片式 KPI 布局 |
| [awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) | skill 元数据组织方式 |
| [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | 分类标签体系 |

结论：**没有现成可直接套用的本地多集合管理面板**，自建是合理的。
方案上选择「轻量本地 web 面板」而非 CLI / 桌面应用。

## 三、当前目录扫描结果

```
E:\Skill研究
├── Harness_Engineering/    # Python harness，含 1 个 skill (frontend-design)
├── agency-agents/          # 扁平 *.md，按 design/engineering/marketing 等 18 类
├── awesome-design-md/      # 30+ 品牌设计系统 md（airbnb / linear / figma...）
├── claude-code-guide/      # 工具脚本项目（非 skill 集）
├── edict/                  # Agent 框架项目（非 skill 集）
├── gstack/                 # ~30 个 SKILL.md（autoplan / ship / qa / review...）
├── pua/                    # ~12 个 SKILL.md（多语言变体）
├── tong-jincheng-skill-main/ # 1 个 SKILL.md
└── ui-ux-pro-max-skill/    # 7 个 SKILL.md（design / brand / slides...）
```

**两类元数据格式**：
1. **SKILL.md 带 YAML frontmatter**：`name / description / version / allowed-tools / benefits-from`
2. **agency-agents 普通 md**：从文件名 + 首段提取，没有标准 frontmatter

## 四、技术方案

**技术栈**（贴合 Node 24 环境）：

- **后端**：Node 24 原生 ESM + 内置 `node:fs` / `node:http`，**零依赖优先**
  - 唯一可选依赖：`gray-matter`（解析 frontmatter）+ `marked`（md 渲染）
- **前端**：单页 `index.html` + 原生 JS + Tailwind CDN（避免 build 步骤）
- **数据流**：启动时扫描磁盘 → 生成 `index.json` → 浏览器直接 fetch

**架构**：

```
skill-dashboard/
├── package.json           # type: module, node >=24
├── server.mjs             # 启动 HTTP 服务，serve 静态 + /api/*
├── scanner.mjs            # 扫描 E:\Skill研究 → 生成 index.json
├── parsers/
│   ├── skill-md.mjs       # 解析带 frontmatter 的 SKILL.md
│   └── agent-md.mjs       # 解析 agency-agents 风格 md
├── public/
│   ├── index.html         # 单页面板
│   ├── app.js             # 列表 / 过滤 / 详情逻辑
│   └── styles.css
└── data/
    └── index.json         # 扫描产物（gitignore）
```

**核心数据模型**：

```ts
type SkillEntry = {
  id: string;            // 集合名/相对路径 hash
  collection: string;    // 所属集合（gstack / pua / ...）
  name: string;          // frontmatter.name 或文件名
  description: string;   // frontmatter.description 或首段
  filePath: string;      // 绝对路径
  type: 'skill' | 'agent' | 'design-doc';
  tags: string[];        // 从路径 + frontmatter 提取
  tools?: string[];      // allowed-tools
  triggerKeywords: string[]; // 从 description 中正则抽取
  raw: string;           // 完整 markdown
}
```

## 五、UI 布局

```
┌────────────────────────────────────────────────────────────┐
│ 🔍 Search...    [集合 ▼] [类型 ▼] [工具 ▼]      ⟳ Rescan │
├──────────────────┬─────────────────────────────────────────┤
│ Collections      │  Cards Grid (响应式 3 列)                │
│ ☑ gstack (30)    │  ┌──────┐ ┌──────┐ ┌──────┐            │
│ ☑ pua (12)       │  │ name │ │ name │ │ name │            │
│ ☑ ui-ux (7)      │  │ desc │ │ desc │ │ desc │            │
│ ☐ agency (190)   │  │ tags │ │ tags │ │ tags │            │
│ ...              │  └──────┘ └──────┘ └──────┘            │
│                  │                                          │
│ Tags             │  点击卡片 → 右侧抽屉显示完整 SKILL.md   │
│ • design (15)    │                                          │
│ • review (8)     │                                          │
│ • deploy (5)     │                                          │
└──────────────────┴─────────────────────────────────────────┘
```

**交互细节**：
- 卡片悬浮显示 trigger keywords
- 同名/相似 skill 在卡片角标显示 `⚠ 2 similar`
- 详情抽屉支持复制路径 / 在资源管理器打开
- URL hash 同步过滤状态，可分享 / 收藏

## 六、扫描策略

1. **递归 glob**：只扫 `**/SKILL.md` + `agency-agents/**/*.md` + `awesome-design-md/**/*.md`
2. **跳过**：`node_modules` / `.git` / `dist` / `__pycache__` / `screenshots`
3. **缓存**：基于 mtime 增量扫描，避免冷启动慢
4. **去重检测**：name 相同 → 标记 duplicate；description cosine 相似度 > 0.8 → 标记 similar

## 七、启动方式

```bash
cd skill-dashboard
node server.mjs           # 启动后访问 http://localhost:5173
node scanner.mjs --rebuild # 强制全量重扫
```

## 八、里程碑

| 阶段 | 产物 |
|---|---|
| M1 | scanner 输出 index.json，覆盖所有集合 |
| M2 | 静态 HTML 列表 + 搜索过滤可用 |
| M3 | 详情抽屉 + Markdown 渲染 |
| M4 | 重复/相似检测 + 标签自动聚合 |
| M5 | 增量扫描 + URL 状态同步 |

## 九、风险与权衡

- **gray-matter 依赖**：若想纯零依赖，可以手写 ~30 行 YAML frontmatter parser（只支持简单字段）
- **awesome-design-md 体量大**：30+ 品牌系统每个上千行，列表默认折叠，懒加载详情
- **Windows 路径**：scanner 用 `path.posix` 输出统一前向斜杠，避免 JSON 转义问题
- **中文路径**：根目录含中文 `Skill研究`，确认 `fs` 在 Node 24 + Win11 下正常（已验证可读）

## 十、实现决策记录

| 决策 | 选择 | 原因 |
|---|---|---|
| 依赖 | **零依赖** | 要求明确；gray-matter / marked 可用 ~200 行自实现替代 |
| 端口 | **10010** | 用户指定 |
| 集合配置 | **scan-config.json 外置** | 新增 skill 包无需改代码，只改 JSON |
| 扫描模式 | **增量（mtime 缓存）+ --rebuild 全量** | 日常使用快，新增集合时可全量 |
| design-doc 名称 | **父目录名（品牌名）** | DESIGN.md 通用文件名无意义，品牌名才是区分点 |
| 重复检测 | **跨集合同名才标记** | 同集合内不同路径同名是合法（多语言变体） |
| URL hash | **#q=&col=&type=&tag=&fav=** | 只写非默认值，保持 URL 简洁 |
| Markdown 渲染 | **内置 ~80 行简易渲染器** | 覆盖 SKILL.md 常用格式；避免 marked 依赖 |
| YAML 解析 | **lib/frontmatter.mjs 自实现** | 覆盖 block scalar / inline array / block list；~130 行 |
| trigger keywords | **引号短语 + asked-to 模式，≤35 字符** | 避免截断句子显示为 keyword |
| import guard | **process.argv[1] 对比 import.meta.url** | scanner.mjs 被 server.mjs import 时不自动运行 |
