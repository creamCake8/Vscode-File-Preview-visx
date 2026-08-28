import * as vscode from 'vscode';
import * as path from 'path';
import { FileService } from '../services/FileService';
import { MediaServer } from '../services/MediaServer';
import { FileItem, ExtensionMessage } from '../types';

/** 当前渲染模式 */
type RenderMode = 'text' | 'html' | 'excel' | 'pdf' | 'video' | 'empty' | 'loading';

/**
 * 右侧预览面板（单例模式）
 * 使用 WebviewPanel + Beside 实现右侧抽屉效果
 * 支持多种渲染模式：text / html(Word) / excel / pdf(待实现) / video(待实现)
 */
export class PreviewPanel {
  private static instance: PreviewPanel | undefined;
  private panel: vscode.WebviewPanel | undefined;
  private readonly mediaServer = new MediaServer();
  private currentFileId: string | undefined;
  private currentFileItem: FileItem | undefined;
  private readOffset: number = 0;
  private currentMode: RenderMode = 'empty';
  private excelSheets: { name: string; content: string }[] = [];
  private currentSheetIndex: number = 0;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly fileService: FileService
  ) {
    context.subscriptions.push({ dispose: () => this.mediaServer.dispose() });
  }

  /**
   * 获取单例
   */
  static getInstance(context: vscode.ExtensionContext, fileService: FileService): PreviewPanel {
    if (!PreviewPanel.instance) {
      PreviewPanel.instance = new PreviewPanel(context, fileService);
    }
    return PreviewPanel.instance;
  }

  /**
   * 创建或显示预览面板
   */
  createOrShow(): void {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (this.panel) {
      this.panel.reveal(column);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'filePreview.preview',
      '文件预览',
      { viewColumn: column, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(this.context.extensionPath, 'media')),
          vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules', 'pdfjs-dist', 'legacy', 'build')),
        ],
      }
    );

    this.panel.webview.html = this.getHtml();

    // 监听消息
    this.panel.webview.onDidReceiveMessage(
      (message: { type: string; data?: any }) => {
        this.handleMessage(message);
      },
      undefined,
      this.context.subscriptions
    );

    // 面板关闭时清理
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.currentFileId = undefined;
      this.currentFileItem = undefined;
    });
  }

  /**
   * 关闭预览面板
   */
  close(): void {
    if (this.panel) {
      this.panel.dispose();
    }
  }

  /**
   * 获取当前预览的文件 ID
   */
  getCurrentFileId(): string | undefined {
    return this.currentFileId;
  }

  /**
   * 渲染指定文件内容
   */
  async renderFile(fileItem: FileItem): Promise<void> {
    this.createOrShow();
    this.currentFileId = fileItem.id;
    this.currentFileItem = fileItem;
    this.readOffset = 0;

    if (!this.panel) {
      return;
    }

    // 更新面板标题
    this.panel.title = `预览：${fileItem.name}`;

    // 立即显示加载状态，避免大文件读取/传输期间用户误以为卡死
    this.postMessage({ type: 'file:loading', data: { name: fileItem.name } });

    const fileType = this.fileService.getFileType(fileItem.path);

    try {
      switch (fileType) {
        case 'word':
          await this.renderWord(fileItem);
          break;
        case 'excel':
          await this.renderExcel(fileItem);
          break;
        case 'markdown':
          await this.renderMarkdown(fileItem);
          break;
        case 'html':
          await this.renderHtmlFile(fileItem);
          break;
        case 'pdf':
          await this.renderPdf(fileItem);
          break;
        case 'video':
          await this.renderVideo(fileItem);
          break;
        case 'video':
          this.currentMode = 'empty';
          this.postMessage({ type: 'info', message: '视频预览将在后续版本支持，敬请期待' });
          break;
        case 'text':
        default:
          await this.renderText(fileItem);
          break;
      }
    } catch (err: any) {
      this.currentMode = 'empty';
      this.postMessage({
        type: 'error',
        message: `读取文件失败：${err.message || String(err)}`,
      });
    }
  }

  /**
   * 文本模式渲染（现有逻辑）
   */
  private async renderText(fileItem: FileItem): Promise<void> {
    // 二进制文件（旧版 .doc、未知格式等）拦截，避免显示乱码
    if (await this.fileService.isBinaryFile(fileItem.path)) {
      this.currentMode = 'empty';
      this.postMessage({
        type: 'info',
        message: '该文件为二进制格式，暂不支持预览（旧版 .doc 请另存为 .docx 后再试）',
      });
      return;
    }

    this.currentMode = 'text';
    const { content, hasMore, totalSize } = await this.fileService.readFileHead(fileItem.path);
    this.readOffset = Buffer.byteLength(content, 'utf-8');
    this.postMessage({
      type: 'file:content',
      data: { id: fileItem.id, content, totalSize, hasMore },
    });
  }

  /**
   * Markdown 文件渲染（marked 转 HTML）
   */
  private async renderMarkdown(fileItem: FileItem): Promise<void> {
    this.currentMode = 'html';
    const markdown = await this.fileService.readTxtFile(fileItem.path);
    this.postMessage({
      type: 'file:htmlContent',
      data: { id: fileItem.id, html: this.fileService.markdownToHtml(markdown) },
    });
  }

  /**
   * HTML 文件渲染（去除脚本后直接展示）
   */
  private async renderHtmlFile(fileItem: FileItem): Promise<void> {
    this.currentMode = 'html';
    const raw = await this.fileService.readTxtFile(fileItem.path);
    // 去除脚本标签，避免在 webview 中执行任意代码
    const safe = raw.replace(/<script[\s\S]*?<\/script>/gi, '');
    this.postMessage({
      type: 'file:htmlContent',
      data: { id: fileItem.id, html: safe },
    });
  }

  /**
   * Word 模式渲染（mammoth 转 HTML）
   */
  private async renderWord(fileItem: FileItem): Promise<void> {
    this.currentMode = 'html';
    const html = await this.fileService.readDocxAsHtml(fileItem.path);
    this.postMessage({
      type: 'file:htmlContent',
      data: { id: fileItem.id, html },
    });
  }

  /**
   * Excel 模式渲染（SheetJS 转 Markdown → marked 转 HTML）
   */
  private async renderExcel(fileItem: FileItem): Promise<void> {
    this.currentMode = 'excel';
    const { sheets, defaultSheet } = await this.fileService.readXlsxAsMarkdown(fileItem.path);
    this.excelSheets = sheets;
    this.currentSheetIndex = defaultSheet;

    const html = this.fileService.markdownToHtml(sheets[defaultSheet].content);

    this.postMessage({
      type: 'file:excelContent',
      data: {
        id: fileItem.id,
        sheets: sheets.map(s => ({ name: s.name })),
        currentIndex: defaultSheet,
        html,
      },
    });
  }

  /**
   * 切换 Excel Sheet
   */
  private switchExcelSheet(fileId: string, sheetIndex: number): void {
    if (fileId !== this.currentFileId || !this.currentFileItem) return;
    if (sheetIndex < 0 || sheetIndex >= this.excelSheets.length) return;

    this.currentSheetIndex = sheetIndex;
    const sheet = this.excelSheets[sheetIndex];
    const html = this.fileService.markdownToHtml(sheet.content);

    this.postMessage({
      type: 'file:excelContent',
      data: {
        id: fileId,
        sheets: this.excelSheets.map(s => ({ name: s.name })),
        currentIndex: sheetIndex,
        html,
      },
    });
  }

  /**
   * PDF 模式渲染：文件内容以 base64 传给 webview，
   * pdf.js 在 webview 内解析渲染，翻页/缩放均在 webview 本地完成
   */
  private async renderPdf(fileItem: FileItem): Promise<void> {
    this.currentMode = 'pdf';
    const buffer = await this.fileService.readFileBuffer(fileItem.path);
    this.postMessage({
      type: 'file:pdfContent',
      data: { id: fileItem.id, data: buffer.toString('base64') },
    });
  }

  /**
   * 视频模式渲染：本地文件通过 webview URI 加载，透明度/自动播放来自配置
   */
  private async renderVideo(fileItem: FileItem): Promise<void> {
    this.currentMode = 'video';
    if (!this.panel) return;

    const config = vscode.workspace.getConfiguration('filePreview');
    const opacity = config.get<number>('videoOpacity', 100);
    const autoplay = config.get<boolean>('videoAutoplay', false);
    const muted = config.get<boolean>('videoMuted', true);

    // 本地视频通过扩展宿主的媒体服务流式提供（localResourceRoots 对任意路径不可靠）
    try {
      await this.mediaServer.start();
    } catch (err: any) {
      this.postMessage({ type: 'error', message: `媒体服务启动失败：${err.message || err}` });
      return;
    }
    const src = this.mediaServer.urlFor(fileItem.path);

    this.postMessage({
      type: 'file:videoContent',
      data: { id: fileItem.id, src, opacity, autoplay, muted },
    });
  }

  /**
   * 在线链接预览：视频直链直接播放；网页剔除脚本后展示；其余按文本展示
   */
  async renderUrl(url: string): Promise<void> {
    this.createOrShow();
    if (!this.panel) return;

    const id = 'url:' + url;
    this.currentFileId = id;
    this.currentFileItem = undefined;
    this.readOffset = 0;
    this.panel.title = `预览：${url.replace(/^https?:\/\//i, '').slice(0, 40)}`;
    this.postMessage({ type: 'file:loading', data: { name: url } });

    const config = vscode.workspace.getConfiguration('filePreview');
    const opacity = config.get<number>('videoOpacity', 100);
    const autoplay = config.get<boolean>('videoAutoplay', false);
    const muted = config.get<boolean>('videoMuted', true);

    // 视频直链直接播放
    const urlExt = path.extname(new URL(url).pathname).toLowerCase();
    if (['.mp4', '.webm', '.ogg', '.ogv', '.mov', '.m4v'].includes(urlExt)) {
      this.currentMode = 'video';
      this.postMessage({
        type: 'file:videoContent',
        data: { id, src: url, opacity, autoplay, muted },
      });
      return;
    }

    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const contentType = res.headers.get('content-type') ?? '';

      if (contentType.startsWith('video/') || contentType.startsWith('audio/')) {
        this.currentMode = 'video';
        this.postMessage({
          type: 'file:videoContent',
          data: { id, src: url, opacity, autoplay, muted },
        });
      } else if (contentType.includes('text/html')) {
        const raw = await res.text();
        this.currentMode = 'html';
        this.postMessage({
          type: 'file:htmlContent',
          data: { id, html: raw.replace(/<script[\s\S]*?<\/script>/gi, '') },
        });
      } else {
        const text = await res.text();
        this.currentMode = 'text';
        this.postMessage({
          type: 'file:content',
          data: { id, content: text, totalSize: Buffer.byteLength(text, 'utf-8'), hasMore: false },
        });
      }
    } catch (err: any) {
      this.currentMode = 'empty';
      this.postMessage({
        type: 'error',
        message: `链接加载失败：${err.message || String(err)}`,
      });
    }
  }

  /**
   * 配置面板修改视频透明度/自动播放/静音后实时应用（不打断播放）
   */
  applyVideoConfig(opacity?: number, autoplay?: boolean, muted?: boolean): void {
    this.postMessage({ type: 'config:update', data: { opacity, autoplay, muted } });
  }

  /**
   * 重新渲染当前文件（字体大小/行号等阅读配置变更后调用）
   */
  refreshCurrent(): void {
    if (this.currentFileItem) {
      this.renderFile(this.currentFileItem);
    }
  }

  /**
   * 加载更多内容（分片滚动加载）
   */
  private async loadMore(fileId: string): Promise<void> {
    if (fileId !== this.currentFileId || !this.currentFileItem) {
      return;
    }

    try {
      const { chunk, hasMore } = await this.fileService.readFileChunk(
        this.currentFileItem.path,
        this.readOffset
      );
      this.readOffset += Buffer.byteLength(chunk, 'utf-8');

      this.postMessage({
        type: 'file:contentChunk',
        data: { id: fileId, chunk, hasMore },
      });
    } catch (err: any) {
      this.postMessage({
        type: 'error',
        message: `加载更多失败：${err.message || String(err)}`,
      });
    }
  }

  /**
   * 处理来自 Webview 的消息
   */
  private handleMessage(message: { type: string; data?: any }): void {
    switch (message.type) {
      case 'preview:loadMore':
        if (this.currentMode === 'text') {
          this.loadMore(message.data?.id || this.currentFileId || '');
        }
        break;
      case 'preview:excelSwitchSheet':
        if (this.currentMode === 'excel') {
          this.switchExcelSheet(message.data?.id || '', message.data?.sheetIndex ?? 0);
        }
        break;
      case 'preview:ready':
        // 面板准备就绪，如果有当前文件则重新渲染
        if (this.currentFileItem) {
          this.renderFile(this.currentFileItem);
        }
        break;
    }
  }

  /**
   * 发送消息到 Webview
   */
  private postMessage(message: ExtensionMessage): void {
    this.panel?.webview.postMessage(message);
  }

  /**
   * 获取预览面板 HTML
   */
  private getHtml(): string {
    const config = vscode.workspace.getConfiguration('filePreview');
    const fontSize = config.get<number>('fontSize', 14);
    const showLineNumbers = config.get<boolean>('lineNumbers', true);

    // pdf.js 本地资源（webview 只能加载 cspSource 范围内的脚本）
    const webview = this.panel?.webview;
    const pdfjsBuild = path.join(this.context.extensionPath, 'node_modules', 'pdfjs-dist', 'legacy', 'build');
    const pdfjsUri = webview
      ? webview.asWebviewUri(vscode.Uri.file(path.join(pdfjsBuild, 'pdf.min.js'))).toString()
      : '';
    const pdfWorkerUri = webview
      ? webview.asWebviewUri(vscode.Uri.file(path.join(pdfjsBuild, 'pdf.worker.min.js'))).toString()
      : '';
    const cspSource = webview?.cspSource ?? '';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data: blob:; media-src ${cspSource} https: http: blob:; script-src ${cspSource} 'unsafe-inline'; style-src 'unsafe-inline'; font-src ${cspSource} data:; worker-src ${cspSource} blob:;">
<style>
  :root {
    --bg-color: var(--vscode-editor-background, #1e1e1e);
    --fg-color: var(--vscode-editor-foreground, #cccccc);
    --line-number-color: var(--vscode-editorLineNumber-foreground, #858585);
    --font-size: ${fontSize}px;
    --font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
    --doc-font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    --border-color: var(--vscode-panel-border, rgba(128,128,128,0.2));
    --accent-color: var(--vscode-textLink-foreground, #3794ff);
    --code-bg: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1));
    --table-header-bg: var(--vscode-editorLineNumber-foreground, rgba(128,128,128,0.15));
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    height: 100%;
    background: var(--bg-color);
    color: var(--fg-color);
    font-family: var(--font-family);
    font-size: var(--font-size);
    line-height: 1.6;
    overflow: hidden;
  }
  #app { height: 100%; display: flex; flex-direction: column; }

  /* ===== 文本模式 ===== */
  .text-container {
    display: flex;
    height: 100%;
    overflow: auto;
  }
  .line-numbers {
    flex-shrink: 0;
    padding: 12px 8px 12px 12px;
    text-align: right;
    color: var(--line-number-color);
    user-select: none;
    background: var(--bg-color);
    border-right: 1px solid var(--vscode-editorRuler-foreground, rgba(128,128,128,0.15));
    min-width: 48px;
    white-space: pre;
    display: ${showLineNumbers ? 'block' : 'none'};
  }
  .text-content {
    flex: 1;
    padding: 12px 16px;
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  /* ===== 文档模式（Word / Excel） ===== */
  .doc-wrapper {
    flex: 1;
    overflow: auto;
    padding: 0;
  }
  .doc-container {
    padding: 20px 24px;
    font-family: var(--doc-font);
    font-size: 14px;
    line-height: 1.7;
    color: var(--fg-color);
    max-width: 100%;
  }
  .doc-container h1, .doc-container h2, .doc-container h3,
  .doc-container h4, .doc-container h5, .doc-container h6 {
    margin-top: 24px;
    margin-bottom: 12px;
    font-weight: 600;
    line-height: 1.3;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 6px;
  }
  .doc-container h1 { font-size: 22px; }
  .doc-container h2 { font-size: 18px; }
  .doc-container h3 { font-size: 16px; }
  .doc-container h4 { font-size: 15px; border-bottom: none; }
  .doc-container p { margin-bottom: 12px; }
  .doc-container ul, .doc-container ol {
    margin-bottom: 12px;
    padding-left: 28px;
  }
  .doc-container li { margin-bottom: 4px; }
  .doc-container blockquote {
    margin: 12px 0;
    padding: 8px 16px;
    border-left: 4px solid var(--accent-color);
    background: var(--code-bg);
    color: var(--vscode-descriptionForeground, #808080);
  }
  .doc-container code {
    background: var(--code-bg);
    padding: 2px 6px;
    border-radius: 3px;
    font-family: var(--font-family);
    font-size: 0.9em;
  }
  .doc-container pre {
    background: var(--code-bg);
    padding: 12px 16px;
    border-radius: 4px;
    overflow-x: auto;
    margin-bottom: 12px;
  }
  .doc-container pre code {
    background: none;
    padding: 0;
    font-size: 13px;
  }
  .doc-container a {
    color: var(--accent-color);
    text-decoration: none;
  }
  .doc-container a:hover { text-decoration: underline; }
  .doc-container img { max-width: 100%; height: auto; }
  .doc-container hr {
    border: none;
    border-top: 1px solid var(--border-color);
    margin: 20px 0;
  }
  .doc-container strong { font-weight: 600; }
  .doc-container em { font-style: italic; }

  /* 表格样式（Word / Excel 共用） */
  .doc-container table {
    border-collapse: collapse;
    width: 100%;
    margin-bottom: 12px;
    font-size: 13px;
  }
  .doc-container th, .doc-container td {
    border: 1px solid var(--border-color);
    padding: 6px 10px;
    text-align: left;
    vertical-align: top;
  }
  .doc-container th {
    background: var(--table-header-bg);
    font-weight: 600;
  }
  .doc-container tr:nth-child(even) td {
    background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.05));
  }

  /* ===== Excel Sheet 标签栏 ===== */
  .sheet-tabs {
    display: flex;
    gap: 2px;
    padding: 6px 12px 0;
    border-bottom: 1px solid var(--border-color);
    background: var(--vscode-sideBar-background, var(--bg-color));
    flex-shrink: 0;
    overflow-x: auto;
  }
  .sheet-tab {
    padding: 6px 14px;
    font-size: 12px;
    font-family: var(--doc-font);
    cursor: pointer;
    border: 1px solid var(--border-color);
    border-bottom: none;
    border-radius: 4px 4px 0 0;
    background: var(--vscode-sideBar-background, var(--bg-color));
    color: var(--vscode-descriptionForeground, #808080);
    white-space: nowrap;
    user-select: none;
  }
  .sheet-tab:hover {
    color: var(--fg-color);
  }
  .sheet-tab.active {
    background: var(--bg-color);
    color: var(--fg-color);
    font-weight: 600;
    border-bottom-color: var(--bg-color);
    margin-bottom: -1px;
  }

  /* ===== PDF 模式 ===== */
  .pdf-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border-color);
    background: var(--vscode-sideBar-background, var(--bg-color));
    flex-shrink: 0;
    font-family: var(--doc-font);
    font-size: 12px;
    color: var(--fg-color);
    user-select: none;
  }
  .pdf-toolbar button {
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
    color: var(--vscode-button-secondaryForeground, var(--fg-color));
    border: none;
    border-radius: 3px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
  }
  .pdf-toolbar button:hover:not(:disabled) {
    background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.3));
  }
  .pdf-toolbar button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .pdf-page-info {
    min-width: 64px;
    text-align: center;
  }
  .pdf-toolbar .spacer { flex: 1; }
  .pdf-wrapper {
    flex: 1;
    overflow: auto;
    text-align: center;
  }
  .pdf-wrapper canvas {
    margin: 12px auto;
    box-shadow: 0 2px 12px rgba(0,0,0,0.35);
    background: #fff;
    max-width: calc(100% - 24px);
    height: auto;
  }

  /* ===== 视频模式 ===== */
  .video-wrapper {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
    min-height: 0;
  }
  .video-wrapper video {
    max-width: 100%;
    max-height: 100%;
  }
  .video-hint {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    color: rgba(255,255,255,0.75);
    font-family: var(--doc-font);
    font-size: 13px;
    text-align: center;
    padding: 0 24px;
  }

  /* ===== 通用状态 ===== */
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--vscode-descriptionForeground, #808080);
    font-family: var(--doc-font);
    font-size: 13px;
  }
  .error-state {
    padding: 20px;
    color: var(--vscode-errorForeground, #f48771);
    font-family: var(--doc-font);
    font-size: 13px;
    white-space: normal;
  }
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--vscode-descriptionForeground, #808080);
    font-family: var(--doc-font);
    font-size: 13px;
  }
  .loading::after {
    content: '';
    width: 16px;
    height: 16px;
    margin-left: 10px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .load-more-trigger {
    height: 1px;
    width: 100%;
  }

  /* 滚动条 */
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: var(--vscode-scrollbarSlider-background, rgba(121,121,121,0.4));
    border-radius: 5px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: var(--vscode-scrollbarSlider-hoverBackground, rgba(100,100,100,0.6));
  }
</style>
</head>
<body>
  <div id="app">
    <div class="loading">正在加载文件内容...</div>
  </div>

<script src="${pdfjsUri}"></script>
<script>
(function() {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  let currentContent = '';
  let isLoading = false;
  let hasMore = false;
  let currentFileId = '';
  let currentMode = 'empty'; // empty / loading / text / html / excel / pdf

  // pdf.js worker 指向本地资源
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = '${pdfWorkerUri}';
  }

  /* ===== 渲染函数 ===== */

  function renderEmpty() {
    currentMode = 'empty';
    app.innerHTML = '<div class="empty-state">从左侧选择文件开始预览</div>';
  }

  function renderLoading(name) {
    currentMode = 'loading';
    app.innerHTML = '<div class="loading">正在加载' + (name ? ' ' + escapeHtml(name) : '') + ' ...</div>';
  }

  function renderError(message) {
    currentMode = 'empty';
    app.innerHTML = '<div class="error-state">⚠️ ' + escapeHtml(message) + '</div>';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* --- 文本模式 --- */

  function renderTextContent(content, totalSize) {
    currentMode = 'text';
    const lines = content.split('\\n');
    const showLineNumbers = ${showLineNumbers ? 'true' : 'false'};
    const lineNumbersHtml = showLineNumbers
      ? '<div class="line-numbers">' + lines.map((_, i) => i + 1).join('\\n') + '</div>'
      : '';
    app.innerHTML = '<div class="text-container" id="container">' +
      lineNumbersHtml +
      '<div class="text-content" id="content">' + escapeHtml(content) +
      (hasMore ? '<div class="load-more-trigger" id="trigger"></div>' : '') +
      '</div>' +
      '</div>';

    const container = document.getElementById('container');
    if (container && hasMore) {
      container.addEventListener('scroll', onScroll);
    }
  }

  function appendTextChunk(chunk) {
    const contentEl = document.getElementById('content');
    const trigger = document.getElementById('trigger');
    if (!contentEl) return;

    currentContent += chunk;
    const lines = currentContent.split('\\n');
    const lineNumbersEl = document.querySelector('.line-numbers');
    if (lineNumbersEl) {
      lineNumbersEl.textContent = lines.map((_, i) => i + 1).join('\\n');
    }
    if (trigger) trigger.remove();
    contentEl.appendChild(document.createTextNode(chunk));
    if (hasMore) {
      const t = document.createElement('div');
      t.className = 'load-more-trigger';
      t.id = 'trigger';
      contentEl.appendChild(t);
    }
    isLoading = false;
  }

  function onScroll(e) {
    if (isLoading || !hasMore) return;
    const el = e.target;
    const scrollBottom = el.scrollTop + el.clientHeight;
    if (scrollBottom >= el.scrollHeight - 200) {
      isLoading = true;
      vscode.postMessage({ type: 'preview:loadMore', data: { id: currentFileId } });
    }
  }

  /* --- HTML 模式（Word） --- */

  function renderHtmlContent(html) {
    currentMode = 'html';
    app.innerHTML =
      '<div class="doc-wrapper">' +
        '<div class="doc-container" id="docContainer">' + html + '</div>' +
      '</div>';
  }

  /* --- Excel 模式 --- */

  function renderExcelContent(sheets, currentIndex, html) {
    currentMode = 'excel';
    const tabsHtml = sheets.map((s, i) =>
      '<div class="sheet-tab ' + (i === currentIndex ? 'active' : '') + '" data-index="' + i + '">' +
        escapeHtml(s.name) +
      '</div>'
    ).join('');

    app.innerHTML =
      '<div class="sheet-tabs" id="sheetTabs">' + tabsHtml + '</div>' +
      '<div class="doc-wrapper">' +
        '<div class="doc-container" id="docContainer">' + html + '</div>' +
      '</div>';

    // 绑定 Sheet 切换事件
    const tabs = document.querySelectorAll('.sheet-tab');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        const idx = parseInt(this.getAttribute('data-index') || '0', 10);
        vscode.postMessage({
          type: 'preview:excelSwitchSheet',
          data: { id: currentFileId, sheetIndex: idx }
        });
      });
    });
  }

  /* --- PDF 模式 --- */

  let pdfDoc = null;
  let pdfPageNum = 1;
  let pdfZoom = 0;        // 0 = 适应宽度；>0 = 指定倍率
  let pdfFitScale = 1;    // 最近一次计算的适应宽度倍率
  let pdfRendering = false;

  function base64ToUint8Array(base64) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function renderPdfContent(id, base64) {
    currentMode = 'pdf';
    currentFileId = id;
    app.innerHTML =
      '<div class="pdf-toolbar">' +
        '<button id="pdfPrev" title="上一页">&#9664;</button>' +
        '<span class="pdf-page-info" id="pdfPageInfo">- / -</span>' +
        '<button id="pdfNext" title="下一页">&#9654;</button>' +
        '<span class="spacer"></span>' +
        '<button id="pdfZoomOut" title="缩小">&minus;</button>' +
        '<span class="pdf-page-info" id="pdfZoomInfo">适应宽度</span>' +
        '<button id="pdfZoomIn" title="放大">&#65291;</button>' +
      '</div>' +
      '<div class="pdf-wrapper" id="pdfWrapper"><div class="loading">正在解析 PDF...</div></div>';

    document.getElementById('pdfPrev').addEventListener('click', function() { pdfGotoPage(pdfPageNum - 1); });
    document.getElementById('pdfNext').addEventListener('click', function() { pdfGotoPage(pdfPageNum + 1); });
    document.getElementById('pdfZoomIn').addEventListener('click', function() {
      pdfSetZoom(pdfZoom === 0 ? pdfFitScale * 1.25 : Math.min(pdfZoom * 1.25, 5));
    });
    document.getElementById('pdfZoomOut').addEventListener('click', function() {
      pdfSetZoom(pdfZoom === 0 ? pdfFitScale * 0.8 : Math.max(pdfZoom / 1.25, 0.25));
    });

    pdfDoc = null;
    pdfPageNum = 1;
    pdfZoom = 0;
    window.pdfjsLib.getDocument({ data: base64ToUint8Array(base64) }).promise.then(function(doc) {
      if (currentMode !== 'pdf' || currentFileId !== id) return;
      pdfDoc = doc;
      // 解析完成后用画布替换加载提示
      const wrapper = document.getElementById('pdfWrapper');
      if (wrapper) wrapper.innerHTML = '<canvas id="pdfCanvas"></canvas>';
      pdfRenderPage();
    }).catch(function(err) {
      renderError('PDF 解析失败：' + (err && err.message ? err.message : err));
    });
  }

  function pdfGotoPage(n) {
    if (!pdfDoc || n < 1 || n > pdfDoc.numPages) return;
    pdfPageNum = n;
    pdfRenderPage();
  }

  function pdfSetZoom(z) {
    pdfZoom = z;
    pdfRenderPage();
  }

  function pdfRenderPage() {
    if (!pdfDoc || pdfRendering) return;
    pdfRendering = true;
    pdfDoc.getPage(pdfPageNum).then(function(page) {
      let scale = pdfZoom;
      if (scale === 0) {
        const wrapper = document.getElementById('pdfWrapper');
        const base = page.getViewport({ scale: 1 });
        scale = Math.max(((wrapper ? wrapper.clientWidth : 800) - 24) / base.width, 0.25);
        pdfFitScale = scale;
      }
      const viewport = page.getViewport({ scale: scale });
      const canvas = document.getElementById('pdfCanvas');
      if (!canvas) { pdfRendering = false; return; }
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
    }).then(function() {
      pdfRendering = false;
      const info = document.getElementById('pdfPageInfo');
      if (info) info.textContent = pdfPageNum + ' / ' + pdfDoc.numPages;
      const zi = document.getElementById('pdfZoomInfo');
      if (zi) zi.textContent = pdfZoom === 0 ? '适应宽度' : Math.round(pdfZoom * 100) + '%';
      const prev = document.getElementById('pdfPrev');
      const next = document.getElementById('pdfNext');
      if (prev) prev.disabled = pdfPageNum <= 1;
      if (next) next.disabled = pdfPageNum >= pdfDoc.numPages;
    }).catch(function() {
      pdfRendering = false;
    });
  }

  /* --- 视频模式 --- */

  function renderVideoContent(id, src, opacity, autoplay, muted) {
    currentMode = 'video';
    currentFileId = id;
    app.style.position = 'relative';
    app.innerHTML =
      '<div class="video-wrapper" id="videoWrapper">' +
        '<video id="videoPlayer" controls' + (autoplay ? ' autoplay' : '') + (muted ? ' muted' : '') + '>' +
          '<source id="videoSource" src="' + src + '">' +
        '</video>' +
      '</div>';

    const video = document.getElementById('videoPlayer');
    video.style.opacity = opacity / 100;
    if (autoplay) {
      const p = video.play();
      if (p && p.catch) { p.catch(function() {}); }
    }
    // 加载失败时给出具体错误码便于定位（2=网络 3=解码 4=格式不支持）
    const source = document.getElementById('videoSource');
    source.addEventListener('error', function() {
      const code = source.error ? source.error.code : '?';
      const wrapper = document.getElementById('videoWrapper');
      if (wrapper) {
        wrapper.innerHTML = '<div class="video-hint">视频加载失败（错误码 ' + code + '）<br>' +
          '错误码 4 通常为编码不受支持（如 HEVC/h265），建议转码为 mp4(h264) / webm 后重试</div>';
      }
    });
  }

  function applyVideoConfig(opacity, autoplay, muted) {
    const video = document.getElementById('videoPlayer');
    if (!video) return;
    if (typeof opacity === 'number') {
      video.style.opacity = opacity / 100;
    }
    if (typeof autoplay === 'boolean') {
      video.autoplay = autoplay;
      if (autoplay) {
        const p = video.play();
        if (p && p.catch) { p.catch(function() {}); }
      } else {
        video.pause();
      }
    }
    if (typeof muted === 'boolean') {
      video.muted = muted;
    }
  }

  /* ===== 消息处理 ===== */

  window.addEventListener('message', function(event) {
    const message = event.data;
    switch (message.type) {
      case 'file:content':
        currentFileId = message.data.id;
        currentContent = message.data.content;
        hasMore = message.data.hasMore;
        renderTextContent(currentContent, message.data.totalSize);
        break;
      case 'file:contentChunk':
        hasMore = message.data.hasMore;
        appendTextChunk(message.data.chunk);
        break;
      case 'file:htmlContent':
        currentFileId = message.data.id;
        renderHtmlContent(message.data.html);
        break;
      case 'file:excelContent':
        currentFileId = message.data.id;
        renderExcelContent(message.data.sheets, message.data.currentIndex, message.data.html);
        break;
      case 'file:pdfContent':
        if (window.pdfjsLib) {
          renderPdfContent(message.data.id, message.data.data);
        } else {
          renderError('pdf.js 加载失败');
        }
        break;
      case 'file:loading':
        renderLoading(message.data.name);
        break;
      case 'file:videoContent':
        renderVideoContent(message.data.id, message.data.src, message.data.opacity, message.data.autoplay, message.data.muted);
        break;
      case 'config:update':
        applyVideoConfig(message.data.opacity, message.data.autoplay, message.data.muted);
        break;
      case 'info':
        currentMode = 'empty';
        app.innerHTML = '<div class="empty-state">' + escapeHtml(message.message) + '</div>';
        break;
      case 'error':
        renderError(message.message);
        break;
    }
  });

  // 通知扩展端准备就绪
  vscode.postMessage({ type: 'preview:ready' });
})();
</script>
</body>
</html>`;
  }
}
