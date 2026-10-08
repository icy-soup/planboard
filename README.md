# PlanBoard

一个简单、私有、可本地保存的个人计划工具。

PlanBoard 使用原生 HTML / CSS / JavaScript 构建，并通过 Electron 提供桌面版。任务数据保存在本机文件中，不依赖云端账号。

## 功能

- 周视图：按时间安排任务，支持拖动改时间、改时长和换天
- 列表视图：按日期查看、完成和整理任务
- 全天任务与跨天任务：支持按天完成或整体完成
- 循环课表：支持单双周、生效范围和课程编辑
- 四象限：手动添加优先级事项，可选用 DeepSeek 辅助分析
- 备忘录：多条笔记、自动保存
- 里程碑：按月份查看长期节点
- 导入 / 导出：支持日期范围、合并和按日期覆盖
- 本地备份、数据迁移、深色模式和单实例运行

## 安装与运行

需要 Node.js 运行环境。

```bash
npm install
npm start
```

也可以直接在浏览器打开 `app/index.html`。浏览器版使用 `localStorage`，本地功能可用；AI 调用建议使用桌面版。

## 数据位置

开发版默认使用项目目录下的 `data/`：

```text
data/
├── planboard.json       # 任务、设置、课表和备忘录
├── secrets.json         # DeepSeek API Key
├── memory/              # 可选择发送给 AI 的个人背景记忆
└── backups/             # 自动备份
```

`data/` 已加入 `.gitignore`，不会提交到仓库。安装版使用 `%APPDATA%\planboard\data`，与开发版数据相互独立。

## 开发

```bash
npm test
```

项目不需要前端构建步骤。界面代码位于 `app/`，Electron 主进程位于 `electron/`，纯逻辑测试位于 `test/`。

修改 `app/` 后重启应用即可生效；只有修改 Electron 配置或需要发布安装包时才需要重新打包：

```bash
npm run dist
```

## 技术栈

- 原生 HTML / CSS / JavaScript
- Electron
- Node.js 内置 `node:test`
- DeepSeek API（可选）

## 许可证

[MIT](LICENSE)
