# Skill Dashboard — 维护手册

本手册面向后续维护者，涵盖：新增 skill 集合、SKILL.md 规范、系统架构、扩展指南、常见问题。

---

## 目录

1. [快速上手](#1-快速上手)
2. [新增 Skill 集合](#2-新增-skill-集合)
3. [SKILL.md 规范](#3-skillmd-规范)
4. [Agency-Agent 规范](#4-agency-agent-规范)
5. [Design-Doc 规范](#5-design-doc-规范)
6. [系统架构](#6-系统架构)
7. [扩展开发](#7-扩展开发)
8. [常见问题](#8-常见问题)

---

## 1. 快速上手

```bash
cd E:\Skill研究\skill-dashboard

# 启动服务（自动扫描）
node server.mjs

# 访问
open http://localhost:8082

# 强制全量重扫
node scanner.mjs --rebuild

# 仅扫描，不启动服务
node scanner.mjs
```

> **环境要求**：Node.js ≥ 24，Windows 11。无需 npm install（零依赖）。

---

## 2. 新增 Skill 集合

### 步骤

**只需编辑一个文件：`scan-config.json`**，无需改任何代码。

```json
{
  "collections": [
    {
      "id":       "my-new-skills",
      "label":    "my-new-skills",
      "dir":      "my-new-skills",
      "type":     "skill",
      "scanRule": "SKILL.md",
      "color":    "#10b981"
    }
  ]
}
```

编辑后，在面板点击 **⟳ Rescan**，或重启服务器。

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ | 唯一标识符，用于 URL hash、侧边栏过滤 |
| `label` | string | ✅ | 侧边栏显示名称 |
| `dir` | string | ✅ | 相对于 `E:\Skill研究` 的路径（支持子路径 `foo/bar`） |
| `type` | string | ✅ | `"skill"` / `"agent"` / `"design-doc"` |
| `scanRule` | string | ✅ | 见下方 scanRule 说明 |
| `color` | string | ✅ | CSS 颜色值，显示为侧边栏圆点和徽章颜色 |
| `excludeFiles` | string[] | ❌ | 仅 `*.md` 规则有效，排除的文件名列表 |

### scanRule 取值

| 值 | 行为 | 适用集合类型 |
|---|---|---|
| `"SKILL.md"` | 扫描所有名为 `SKILL.md` 的文件 | 标准 Claude Code Skill |
| `"DESIGN.md"` | 扫描所有名为 `DESIGN.md` 的文件，用父目录名作为显示名 | 品牌设计系统文档 |
| `"*.md"` | 扫描目录下所有 `.md` 文件（排除 `excludeFiles` 指定的元文件） | agency-agents 风格扁平集合 |

### color 参考色板

```
已用颜色（避免重复）：
  gstack:             #6366f1  靛蓝
  pua:                #ec4899  粉红
  ui-ux-pro-max:      #f59e0b  琥珀
  agency-agents:      #22c55e  绿
  agency-agents-zh:   #14b8a6  蓝绿
  awesome-design:     #ef4444  红
  harness:            #06b6d4  青
  tong-jincheng:      #a855f7  紫
  edict:              #f97316  橙

可用颜色：
  #3b82f6  蓝   #84cc16  黄绿
  #f43f5e  玫红  #8b5cf6  紫    #0ea5e9  天蓝
```

### 目录结构规范

新集合放入 `E:\Skill研究\` 根目录下，建议：

```
E:\Skill研究\
└── my-new-collection\     ← 集合根目录
    ├── README.md           ← 可选，扫描时自动跳过
    ├── skill-a\
    │   └── SKILL.md        ← 标准 Skill，带 frontmatter
    └── skill-b\
        └── SKILL.md
```

---

## 3. SKILL.md 规范

SKILL.md 是 Claude Code Skill 的核心描述文件。支持的 YAML frontmatter 字段：

```yaml
---
name: my-skill-name          # 必填：短名称，英文小写+连字符
description: |               # 必填：描述，说明用途和触发时机
  This skill does X.
  Use when asked to "do X" or "run X workflow".
  Proactively suggest when Y condition is met.
version: 1.0.0               # 推荐：语义化版本
preamble-tier: 2             # 可选：1-3，影响标签显示
allowed-tools:               # 推荐：列出允许使用的工具
  - Bash
  - Read
  - Write
benefits-from:               # 可选：依赖的其他 skill id
  - office-hours
emoji: 🚀                    # 可选：单个 emoji，显示在卡片标题
---

# Skill 正文内容
...
```

### description 字段写法规范

**description 是面板检索和触发词提取的核心来源**，请遵守：

1. **首句说用途**：`This skill does X` 或 `Use for Y`
2. **明确触发条件**：用双引号包裹触发词，例如 `Use when asked to "ship"` 或 `"run all reviews"`
3. **避免超过 400 字符**（超出自动截断）
4. **触发词长度 ≤ 35 字符**（更长的词不会被提取为 keyword）

**好的示例：**
```yaml
description: |
  Code review skill for pull requests.
  Use when asked to "review PR", "review this", or "check my code".
  Proactively suggest when the user has uncommitted changes and mentions shipping.
```

**不好的示例：**
```yaml
description: |
  This is a very comprehensive skill that handles many different scenarios
  including but not limited to reviewing code, checking tests, validating
  configurations...  # 太长且没有明确触发词
```

### allowed-tools 常用值参考

```yaml
allowed-tools:
  - Bash        # 执行 shell 命令
  - Read        # 读取文件
  - Write       # 写入文件
  - Edit        # 编辑文件
  - Glob        # 文件路径匹配
  - Grep        # 内容搜索
  - WebSearch   # 网络搜索
  - WebFetch    # 抓取网页
  - AskUserQuestion  # 向用户提问
  - Agent       # 启动子 agent
```

---

## 4. Agency-Agent 规范

agency-agents 集合使用扁平 `.md` 文件，支持标准 frontmatter：

```yaml
---
name: Frontend Developer     # 必填：显示名称
description: Expert frontend developer specializing in...
color: cyan                  # 可选：影响标签
emoji: 🖥️                   # 可选
vibe: Builds responsive, accessible web apps.  # 可选：简短一句话
---
```

**文件命名规范**：`{category}-{role-name}.md`
- 例：`engineering-frontend-developer.md`
- category 会自动提取为标签
- role-name 会被转换为显示名（去掉 category 前缀，title-case）

**排除文件**（在 scan-config.json 的 `excludeFiles` 中维护）：
```
CONTRIBUTING.md, CHANGELOG.md, README.md, AGENTS_OVERVIEW.md,
update-log.md, LICENSE, ROADMAP.md
```

---

## 5. Design-Doc 规范

品牌/设计系统文档集合。文件结构：

```
awesome-design-md/
└── design-md/
    └── {brand-name}/         ← 品牌名作为 Skill 显示名
        ├── DESIGN.md         ← 被扫描的文件
        ├── README.md         ← 跳过
        └── preview.html      ← 跳过
```

- 扫描规则 `"DESIGN.md"`：只扫描名为 `DESIGN.md` 的文件
- 显示名取 **父目录名**（品牌文件夹名），而非文件名
- 无需 frontmatter，描述从正文首段提取

---

## 6. 系统架构

```
用户请求
    │
    ▼
server.mjs (Node 24 HTTP)
    │
    ├─ GET /api/index ──── data/index.json ←── scanner.mjs
    │                                              │
    ├─ GET /api/raw ────── 读取单个 .md 文件       └─ lib/frontmatter.mjs
    │
    ├─ POST /api/rescan ── 触发 scanner.mjs
    ├─ POST /api/open ──── Windows Explorer
    └─ GET /           ─── public/index.html
                               │
                          public/app.js
                          (过滤/渲染/URL hash/收藏)
```

### 数据流

```
E:\Skill研究\**/SKILL.md
           │
           ▼
scanner.mjs
  ├─ 读 scan-config.json（集合定义）
  ├─ walk 目录树（跳过 skipDirs）
  ├─ lib/frontmatter.mjs 解析 YAML
  ├─ 增量缓存 data/scan-cache.json（mtime+size）
  └─ 输出 data/index.json
           │
           ▼
server.mjs /api/index
           │
           ▼
public/app.js
  ├─ fetch('/api/index')
  ├─ buildCollectionFilter()   ← 只建一次
  ├─ applyFilters()
  │    ├─ colVisible = all.filter(不在 hiddenCols)
  │    ├─ renderTypeFilter(colVisible)   ← 联动
  │    ├─ renderTagCloud(colVisible)     ← 联动
  │    └─ state.filtered = colVisible.filter(type+tag+search+fav)
  └─ renderCards()
```

### 关键文件职责

| 文件 | 职责 | 扩展方式 |
|---|---|---|
| `scan-config.json` | 集合定义 | 添加 collection 对象 |
| `lib/frontmatter.mjs` | YAML 解析 + 文本提取 | 添加新 YAML feature case |
| `scanner.mjs` | 扫描 + index 生成 | 添加 scanRule 类型 |
| `server.mjs` | HTTP 服务 | 往 ROUTES 数组 push 新路由 |
| `public/app.js` | 前端逻辑 | 扩展 applyFilters / renderCards |

---

## 7. 扩展开发

### 添加新 API 路由

在 `server.mjs` 的 ROUTES 数组追加：

```javascript
const ROUTES = [
  // ... 现有路由
  { method: 'POST', path: '/api/my-new-route', handler: handleMyRoute },
];

async function handleMyRoute(req, res, url) {
  const body = await readBody(req);
  // 处理逻辑
  sendJson(res, { ok: true, result: '...' });
}
```

### 添加新 scanRule 类型

在 `scanner.mjs` 的 walk callback 中添加：

```javascript
// 在 "// Extension: add more scanRule patterns here as needed" 注释下方
else if (col.scanRule === 'my-rule') {
  matches = /* 自定义匹配逻辑 */;
}
```

### 添加新 YAML 字段

如果新的 SKILL.md 使用了新字段，在 `scanner.mjs` 的 `parseEntry()` 中提取：

```javascript
const myField = data['my-field'] ? String(data['my-field']) : '';
return { ...existingFields, myField };
```

同时在 `public/app.js` 的 `renderCards()` 或 `openDrawer()` 中展示。

### URL Hash 新增参数

在 `public/app.js` 中：

```javascript
// stateToHash()
if (state.myFilter) p.set('my', state.myFilter);

// hashToState()
state.myFilter = params.get('my') || '';
```

---

## 8. 常见问题

### 新下载的 skill 不显示

点面板右上角 **⟳ Rescan**，或运行：
```bash
node scanner.mjs
```

### 某个集合一条都没有

1. 检查 `scan-config.json` 中 `dir` 字段是否与实际目录名一致（大小写敏感）
2. 检查 `scanRule` 是否匹配文件结构
3. 运行 `node scanner.mjs --rebuild` 观察输出

### SKILL.md 有内容但 description 为空

可能原因：
- frontmatter 缺少 `description` 字段
- 正文首段被标题、代码块或表格开头，导致 `extractFirstParagraph()` 无内容

解法：在 frontmatter 中显式添加 `description:` 字段。

### 端口冲突

修改 `server.mjs` 第 35 行：
```javascript
const PORT = 8082;  // 改为其他端口
```

### 触发词（trigger keywords）不准确

触发词从 `description` 字段提取，规则：
- 双引号包裹的 3-35 字符短语
- `asked to X` 句式中的 X（≤35 字符）

如需精确控制，在 SKILL.md frontmatter 的 `description` 中使用双引号明确标注触发词：
```yaml
description: Use when asked to "ship", "deploy", or "release".
```

### index.json 数据陈旧

删除缓存文件并强制重建：
```bash
rm data/scan-cache.json
node scanner.mjs --rebuild
```

### Windows Explorer 无法打开

`/api/open` 使用 `explorer /select,"<path>"`，仅在 Windows 上有效。
如果报错，检查路径是否含特殊字符（中文路径通常没问题）。

---

## 附录：SkillEntry 完整字段

```typescript
type SkillEntry = {
  id:              string;    // 相对路径，正斜杠，全局唯一键
                              // 例：gstack/autoplan/SKILL.md
  collection:      string;    // scan-config.json 中的 id
  name:            string;    // 显示名（frontmatter.name 或路径推断）
  description:     string;    // 描述，最长 400 字符
  filePath:        string;    // 绝对路径，正斜杠
  type:            'skill' | 'agent' | 'design-doc';
  tags:            string[];  // 路径段 + frontmatter color/preamble-tier，最多 8 个
  tools:           string[];  // allowed-tools 列表
  triggerKeywords: string[];  // ≤35 字符触发词，最多 6 个
  version:         string;    // semver 字符串或 ""
  emoji:           string;    // 单个 emoji 或 ""
  duplicates:      string[];  // 同名跨集合条目的 id 列表
}
```

---

---

## 变更日志

| 日期 | 操作 | 操作者 |
|---|---|---|
| 2026-04-09 | 新增 `agency-agents-zh` 集合（中文版 agency-agents，蓝绿色 #14b8a6，scanRule: \*.md） | AI（Claude Sonnet 4.6） |

*最后更新：2026-04-09 by AI（Claude Sonnet 4.6）*
