# Skill 可视化面板 — TODO List

> 配套设计文档：[DESIGN.md](./DESIGN.md)
> 目标环境：Node 24 / Windows 11 / 工作目录 `E:\Skill研究`
> 项目路径：`E:\Skill研究\skill-dashboard\`

---

## 阶段 0 — 项目初始化 ✅

- [x] 在 `E:\Skill研究\skill-dashboard\` 创建项目骨架
- [x] `package.json` 设置 `"type": "module"`、`"engines": { "node": ">=24" }`
- [x] **零依赖**（决定不引入 gray-matter / marked，全部自实现）
- [x] 添加 `.gitignore`（忽略 `data/`、`node_modules`）

## 阶段 1 — Scanner（数据层）✅

- [x] `scanner.mjs`：递归扫描 `E:\Skill研究`
- [x] **`scan-config.json`** ← 扩展入口，新增集合只改这一个文件
- [x] 收录规则（config 驱动）：
  - [x] `SKILL.md` 规则（gstack / pua / ui-ux-pro-max / harness / tong-jincheng）
  - [x] `*.md` 规则（agency-agents，排除 meta 文件）
  - [x] `DESIGN.md` 规则（awesome-design-md/design-md）
- [x] 跳过目录（skipDirs in config）：node_modules / .git / dist / playbooks / examples 等
- [x] `lib/frontmatter.mjs`：零依赖 YAML 解析（string / block scalar | > / inline array / block list）
- [x] 触发关键词提取：引号短语 + `asked to X` 模式，≤35 字符过滤
- [x] 自动标签：路径段 + frontmatter color / preamble-tier
- [x] **design-doc 名称**：用父目录品牌名（airbnb / notion ...），而非 "DESIGN"
- [x] **重复检测**：仅对跨集合同名条目标记，design-doc 不再误标
- [x] **import guard**：`runScan()` 仅在 `node scanner.mjs` 直接调用时执行，import 时不触发
- [x] **增量扫描**：`data/scan-cache.json` 记录 mtime+size，unchanged 文件复用旧 entry
- [x] `--rebuild` 标志：强制全量重扫
- [x] 输出 `data/index.json`（v2 schema）：总数 283，含 `byCollection`
- [x] 验证：gstack:34 / pua:16 / ui-ux-pro-max:7 / agency-agents:167 / awesome-design:57 / harness:1 / tong-jincheng:1

## 阶段 2 — Server（HTTP 层）✅

- [x] `server.mjs`：基于 `node:http`，端口 **10010**，零依赖
- [x] **路由表**（ROUTES 数组，扩展只需 push 新条目）：
  - [x] `GET  /api/index`  → data/index.json，不存在自动扫描
  - [x] `GET  /api/raw`    → 单文件内容（路径白名单校验，≤2MB 限制）
  - [x] `POST /api/rescan` → 触发重扫
  - [x] `POST /api/open`   → Windows Explorer 定位文件
  - [x] `GET  /api/health` → 健康检查
- [x] 静态文件服务（public/）
- [x] 目录穿越防护（`safePath()` 验证在 SKILL_ROOT 内）
- [x] 请求 body 大小限制（64 KB）
- [x] 请求日志（time / status / method / path，带颜色）
- [x] 端口冲突友好报错（EADDRINUSE）

## 阶段 3 — 前端 UI（展示层）✅

- [x] `public/index.html` 语义化骨架（header / nav / main / aside）
- [x] 搜索框（按 `/` 聚焦，Esc 清空）
- [x] 左侧栏：
  - [x] 集合复选框（带颜色圆点 + 数量徽章）
  - [x] 类型复选框
  - [x] **顶部标签云**（按频率 Top 24，点击激活/取消）
- [x] 主区：响应式卡片网格（auto-fill minmax 270px）
- [x] 卡片：name / emoji / collection / version / desc 截断 / tags / tools 数 / 重复徽章 / 触发词 tooltip
- [x] **收藏夹**：卡片 ★ 按钮，"Favorites" 按钮切换视图，localStorage 持久化
- [x] 右侧抽屉：Markdown 渲染 / meta 徽章 / 操作按钮
- [x] 抽屉操作：复制路径、复制名称、Show in Explorer
- [x] 抽屉收藏按钮（☆/★ 同步）
- [x] 相似 skill 链接（跨集合同名，点击跳转）
- [x] 客户端检索：name + description + collection + tags + triggerKeywords
- [x] **URL hash 状态同步**：#q=&col=&type=&tag=&fav=，支持 hashchange

## 阶段 4 — 重复 / 相似检测 ✅

- [x] 同名跨集合检测：卡片角标 `⚠ N`，抽屉内列出相似条目链接
- [x] design-doc 排除误标（名称改为品牌名后自然解决）
- [ ] 描述相似度（token Jaccard）— Stretch，当前同名检测已满足需求

## 阶段 5 — 体验优化 ✅

- [x] 增量扫描（mtime 缓存）
- [x] ⟳ Rescan 按钮 + loading 状态
- [x] URL hash 同步（可分享过滤状态）
- [x] 深色主题（完整 CSS token 系统）
- [x] 滚动条美化
- [x] 键盘快捷键（/、Esc、Enter/Space 打开卡片）
- [ ] 自动打开浏览器（npm run dev）— 待实现
- [ ] 黑暗/浅色模式切换 — Stretch

## 阶段 6 — 文档 ✅

- [x] `README.md`：启动方式、新增 skill 指南、API 文档、数据模型、故障排查
- [x] `scan-config.json` 注释（`_comment` 字段）
- [x] 所有 .mjs 文件 JSDoc 注释（参数、返回值、扩展点）
- [ ] 截图 — 待服务运行后补充

---

## Stretch（可选）

- [ ] `npm run dev` 自动打开浏览器（`node:child_process` open/start）
- [ ] 导出过滤结果为 markdown 清单（便于贴回 Claude Code）
- [ ] 一键复制「使用此 skill 的提示词」（基于 description）
- [ ] 知识图谱视图（Cytoscape.js）展示 `benefits-from` 依赖关系
- [ ] 描述相似度检测（token Jaccard ≥ 0.6）
- [ ] 浅色主题切换
- [ ] 搜索高亮（卡片描述中标记匹配词）

---

## 文件清单（当前）

```
skill-dashboard/
├── .gitignore
├── README.md               ← 完整使用文档
├── package.json
├── scan-config.json        ← 扩展入口：新增集合改这里
├── scanner.mjs             ← 数据层：扫描 + 解析 + index.json
├── server.mjs              ← 服务层：HTTP + 路由 + 安全
├── lib/
│   └── frontmatter.mjs     ← 零依赖 YAML 解析 + 文本提取
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js              ← 客户端：过滤 / 渲染 / URL sync / 收藏
└── data/                   ← gitignore
    ├── index.json          (283 entries)
    └── scan-cache.json
```
