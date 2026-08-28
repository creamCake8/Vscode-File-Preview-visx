# VisX — File Preview for VS Code

> 还在为上班时间浏览"其他文件"而提心吊胆吗？
> 还在 Alt+Tab 与老板的死亡凝视之间反复横跳吗？
> **不！终于~ 终于！** 🎉

把文档、表格、PDF、甚至**视频**统统装进 VS Code 的右侧面板——在别人眼里，你只是一个兢兢业业、目不斜视、在写代码的卷王。

**老板键 `Ctrl+Shift+H` 一键消失，深藏功与名。** 🕶️

---

## ✨ 它能干什么

### 📄 文档预览，像模像样

| 格式 | 渲染效果 |
|------|----------|
| .txt .log .json .csv .xml .yml 等文本 | 行号 + 分片加载，大文件也不卡 |
| .md | Markdown 渲染，标题表格引用通通安排 |
| .docx | mammoth.js 转换，标题/段落/表格/粗体保留 |
| .xlsx .xls | 多 Sheet 标签切换，表格斑马纹渲染 |
| .pdf | pdf.js 内联渲染，翻页缩放，保留原始排版 |
| .html | 去除脚本后安全展示 |

### 🎬 视频隐匿模式（本插片的灵魂）

- 视频直接在 VS Code 面板里播放，**不切换窗口**
- **透明度滑块**（0–100%）：调到 30%，视频若有若无，隔壁工位只看到你在凝视代码
- 快捷键 `Ctrl+Alt+↑/↓` 随时微调透明度，状态栏实时提示
- 默认**静音 + 不自动播放**，双保险；接上耳机后一键解除静音
- 本地视频流式播放，支持拖进度条，大文件不占内存

### 🌐 在线链接预览

配置面板里贴个 URL：视频直链直接播，网页剔除脚本后安全展示，纯文本直接看。

### 📋 文件列表管理

- 从资源管理器**拖拽文件**到侧边栏即可添加（VS Code 原生 TreeView 拖放，100% 可靠）
- `Ctrl+点击` 多选、`Shift+点击` 范围选择，**批量删除**
- 文件列表持久化，重启 VS Code 不丢失
- 只存文件路径，**不动你的文件本体**

---

## 🕹️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+H` | **老板键**：一键隐藏预览，再按一次恢复 |
| `Ctrl+Alt+↑` / `Ctrl+Alt+↓` | 视频透明度 ±10（状态栏提示当前值） |
| `Ctrl+Shift+F P` | 切换侧边栏 |

---

## ⚙️ 配置项

侧边栏标题栏 **⚙ 按钮** 打开配置面板，改完即时生效：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| 视频透明度 | 100% | 越低越隐蔽 |
| 视频自动播放 | 关 | 打开视频是否立即播放 |
| 静音播放 | 开 | 静音时自动播放不会被浏览器拦截 |
| 字体大小 | 14px | 文本/文档预览字体 |
| 显示行号 | 开 | 文本预览行号 |

以上也可以在 VS Code `settings.json` 中直接修改（`filePreview.*`）。

---

## 🚀 安装与运行

### 从源码运行

```bash
git clone https://github.com/<your-name>/file-preview-vscode.git
cd file-preview-vscode
npm install
```

用 VS Code 打开项目，按 `F5` 启动扩展开发宿主即可体验。

### 打包 .vsix

```bash
npm run package        # 生成 .vsix
code --install-extension file-preview-0.0.5.vsix
```

---

## 🔧 工作原理（一句话版）

- **侧边栏**：VS Code 原生 TreeView + TreeDragAndDropController，拖放由工作台直接处理（HTML5 拖放在 webview 里是个坑，我们绕开了）
- **预览面板**：单例 WebviewPanel，右侧抽屉式；Markdown 管道在扩展端完成（SheetJS → GFM 表格 → marked → HTML），webview 零依赖
- **PDF**：pdf.js（本地打包，无 CDN），扩展端读文件 base64 传入，webview 内解析渲染
- **视频**：扩展宿主启动本地媒体服务（127.0.0.1，支持 Range 分段），webview 走 HTTP 流式播放
- **老板键**：即刻销毁面板；再按恢复上次预览的文件

---

## 📁 项目结构

```
file-preview-vscode/
├── src/
│   ├── extension.ts            # 扩展入口，命令注册
│   ├── sidebar/
│   │   └── FileTreeProvider.ts # TreeView + 原生拖放 + 批量删除
│   ├── preview/
│   │   ├── PreviewPanel.ts     # 预览面板（text/html/excel/pdf/video 多模式）
│   │   └── ConfigPanel.ts      # 二级配置页（滑块/开关/URL 输入）
│   ├── services/
│   │   ├── FileService.ts      # 文件读取 + 格式转换（mammoth/SheetJS/marked）
│   │   ├── StorageService.ts   # 文件列表持久化（globalState）
│   │   └── MediaServer.ts      # 本地媒体流服务（Range + token）
│   ├── types/index.ts          # 消息协议与数据类型
│   └── utils/path.ts
├── scripts/verify-convert.js   # 转换管道回归验证脚本
└── media/icons/                # 活动栏图标
```

---

## 🛠️ 本地开发

```bash
npm install
npm run compile     # 编译
npm run watch       # 监听模式
node scripts/verify-convert.js   # 文档转换管道回归测试
```

F5 启动扩展开发宿主调试；webview 内可用 `Ctrl+Shift+I` 打开开发者工具。

**技术栈**：TypeScript · VS Code Extension API · mammoth · SheetJS · marked · pdf.js

---

## ⚠️ 使用须知

- 摸鱼有风险，摸鱼需谨慎。因观看视频导致的绩效滑坡、被老板逮个正着等后果，本插件概不负责 😇
- 视频编解码能力取决于内置浏览器内核：mp4(h264) / webm 完美支持，部分 mkv / HEVC 编码可能无法播放
- 旧版 .doc（二进制格式）暂不支持，请另存为 .docx

## 📄 License

[MIT](./LICENSE)
