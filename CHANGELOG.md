# 更新日志

所有本项目的重要变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
并且本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

---
## [0.0.7] - 2026-08-31

### 🔧 修复UTF8编码异常

- 修复了编码错误问题

## [0.0.6] - 2026-08-31

### 🔧 修复

- 修复了一些配置问题

## [0.0.5] - 2026-08-31

### 第一版插件试运行

### ✨ 新增功能

- **侧边栏文件列表**：在活动栏新增 File Preview 入口，支持添加、删除、刷新预览文件
- **多格式文件预览**：
  - 文本类：TXT、代码文件
  - 文档类：Markdown（实时渲染）、Word（.docx，基于 mammoth）、PDF（基于 pdf.js）
  - 表格类：Excel（.xlsx/.xls，基于 SheetJS）
  - 多媒体：图片、视频、音频
- **配置面板**：可视化设置预览字体大小、自动刷新、行号显示、视频透明度等
- **老板键**：`Ctrl+Shift+H` 一键显示/隐藏预览面板，保护隐私
- **视频透明度调节**：`Ctrl+Alt+Up/Down` 快速调整视频透明度，低调摸鱼
- **文件自动刷新**：监听文件变动，预览内容实时更新
- **本地媒体服务**：内置本地媒体服务器，安全加载本地视频/音频/图片资源

### ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+F P` | 切换侧边栏 |
| `Ctrl+Shift+H` | 老板键（显示/隐藏预览） |
| `Ctrl+Alt+Up` | 视频透明度 +10 |
| `Ctrl+Alt+Down` | 视频透明度 -10 |

### 📦 技术栈

- TypeScript + VS Code Extension API
- mammoth（Word 解析）、marked（Markdown 渲染）
- pdfjs-dist（PDF 渲染）、xlsx（Excel 解析）

### 📝 备注

- 首次发布，功能尚在完善中，欢迎反馈问题
