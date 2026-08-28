import * as vscode from 'vscode';
import { PreviewPanel } from './PreviewPanel';

/**
 * 二级配置面板（单例）
 * 由侧边栏 TreeView 标题栏的 ⚙ 按钮打开
 * 包含：视频透明度滑块 / 自动播放 / 字体大小 / 行号 / 在线链接 / 快捷键说明
 */
export class ConfigPanel {
  private static instance: ConfigPanel | undefined;
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly previewPanel: PreviewPanel
  ) {}

  static getInstance(context: vscode.ExtensionContext, previewPanel: PreviewPanel): ConfigPanel {
    if (!ConfigPanel.instance) {
      ConfigPanel.instance = new ConfigPanel(context, previewPanel);
    }
    return ConfigPanel.instance;
  }

  createOrShow(): void {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    if (this.panel) {
      this.panel.reveal(column);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'filePreview.config',
      'VisX 配置',
      { viewColumn: column, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(
      (message: { type: string; data?: any }) => this.handleMessage(message),
      undefined,
      this.context.subscriptions
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  /**
   * 外部（快捷键等）修改透明度后同步到配置页；页面未打开时无操作
   */
  notifyOpacity(value: number): void {
    this.post({ type: 'config:current', data: { opacity: value } });
  }

  private async handleMessage(message: { type: string; data?: any }): Promise<void> {
    const config = vscode.workspace.getConfiguration('filePreview');

    switch (message.type) {
      case 'config:ready': {
        this.post({
          type: 'config:current',
          data: {
            opacity: config.get<number>('videoOpacity', 100),
            autoplay: config.get<boolean>('videoAutoplay', false),
            muted: config.get<boolean>('videoMuted', true),
            fontSize: config.get<number>('fontSize', 14),
            lineNumbers: config.get<boolean>('lineNumbers', true),
          },
        });
        break;
      }
      case 'config:change': {
        const d = message.data ?? {};
        if (typeof d.opacity === 'number') {
          await config.update('videoOpacity', d.opacity, vscode.ConfigurationTarget.Global);
          this.previewPanel.applyVideoConfig(d.opacity, undefined, undefined);
        }
        if (typeof d.autoplay === 'boolean') {
          await config.update('videoAutoplay', d.autoplay, vscode.ConfigurationTarget.Global);
          this.previewPanel.applyVideoConfig(undefined, d.autoplay, undefined);
        }
        if (typeof d.muted === 'boolean') {
          await config.update('videoMuted', d.muted, vscode.ConfigurationTarget.Global);
          this.previewPanel.applyVideoConfig(undefined, undefined, d.muted);
        }
        if (typeof d.fontSize === 'number') {
          await config.update('fontSize', d.fontSize, vscode.ConfigurationTarget.Global);
          this.previewPanel.refreshCurrent();
        }
        if (typeof d.lineNumbers === 'boolean') {
          await config.update('lineNumbers', d.lineNumbers, vscode.ConfigurationTarget.Global);
          this.previewPanel.refreshCurrent();
        }
        break;
      }
      case 'config:openUrl': {
        const url = String(message.data?.url ?? '').trim();
        if (/^https?:\/\/.+/i.test(url)) {
          await this.previewPanel.renderUrl(url);
        }
        break;
      }
    }
  }

  private post(message: unknown): void {
    this.panel?.webview.postMessage(message);
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--vscode-editor-background, #1e1e1e);
    color: var(--vscode-editor-foreground, #cccccc);
    font-family: var(--vscode-font-family, "Segoe UI", sans-serif);
    font-size: 13px;
    padding: 16px 20px;
    line-height: 1.6;
  }
  .section { margin-bottom: 24px; }
  .section-title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground, #808080);
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
    padding-bottom: 6px;
    margin-bottom: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
  }
  .row label.main { flex: 0 0 110px; }
  .row .value {
    flex: 0 0 48px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--vscode-descriptionForeground, #808080);
  }
  input[type="range"] {
    flex: 1;
    accent-color: var(--vscode-focusBorder, #3794ff);
    cursor: pointer;
  }
  input[type="number"] {
    width: 72px;
    padding: 3px 6px;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #cccccc);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.4));
    border-radius: 3px;
    font-family: inherit;
    font-size: 13px;
  }
  input[type="checkbox"] {
    width: 15px;
    height: 15px;
    accent-color: var(--vscode-focusBorder, #3794ff);
    cursor: pointer;
  }
  input[type="text"] {
    flex: 1;
    padding: 5px 8px;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #cccccc);
    border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.4));
    border-radius: 3px;
    font-family: inherit;
    font-size: 13px;
  }
  input[type="text"]:focus, input[type="number"]:focus {
    outline: 1px solid var(--vscode-focusBorder, #3794ff);
  }
  button.primary {
    padding: 5px 14px;
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #ffffff);
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
  }
  button.primary:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
  .hint {
    color: var(--vscode-descriptionForeground, #808080);
    font-size: 12px;
  }
  kbd {
    display: inline-block;
    padding: 1px 6px;
    background: var(--vscode-keybindingLabel-background, rgba(128,128,128,0.17));
    border: 1px solid var(--vscode-keybindingLabel-border, rgba(128,128,128,0.35));
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, Consolas, monospace);
    font-size: 11px;
    margin: 0 2px;
  }
  .shortcut-row { margin-bottom: 6px; }
</style>
</head>
<body>
  <div class="section">
    <div class="section-title">视频</div>
    <div class="row">
      <label class="main">透明度</label>
      <input type="range" id="opacity" min="0" max="100" step="5">
      <span class="value" id="opacityValue">-</span>
    </div>
    <div class="hint">透明度越低视频越隐蔽；快捷键 <kbd>Ctrl+Alt+↑</kbd>/<kbd>Ctrl+Alt+↓</kbd> 可随时增减</div>
    <div class="row" style="margin-top:10px">
      <label class="main">自动播放</label>
      <input type="checkbox" id="autoplay">
    </div>
    <div class="row">
      <label class="main">静音播放</label>
      <input type="checkbox" id="muted">
    </div>
    <div class="hint">静音开启时自动播放不会被浏览器拦截；需要声音可接耳机后在播放器解除静音</div>
  </div>

  <div class="section">
    <div class="section-title">阅读</div>
    <div class="row">
      <label class="main">字体大小</label>
      <input type="number" id="fontSize" min="10" max="32" step="1">
      <span class="value">px</span>
    </div>
    <div class="row">
      <label class="main">显示行号</label>
      <input type="checkbox" id="lineNumbers">
    </div>
  </div>

  <div class="section">
    <div class="section-title">在线链接</div>
    <div class="row">
      <input type="text" id="url" placeholder="https://example.com/video.mp4">
      <button class="primary" id="openUrl">打开</button>
    </div>
    <div class="hint">支持视频直链（.mp4/.webm 等）与网页/文本链接，回车即可打开</div>
  </div>

  <div class="section">
    <div class="section-title">快捷键</div>
    <div class="shortcut-row"><kbd>Ctrl+Shift+H</kbd> 老板键：一键隐藏预览，再按一次恢复</div>
    <div class="shortcut-row"><kbd>Ctrl+Alt+↑</kbd> / <kbd>Ctrl+Alt+↓</kbd> 视频透明度增减（步长 10）</div>
  </div>

<script>
(function() {
  const vscode = acquireVsCodeApi();
  vscode.postMessage({ type: 'config:ready' });

  const opacity = document.getElementById('opacity');
  const opacityValue = document.getElementById('opacityValue');
  const autoplay = document.getElementById('autoplay');
  const muted = document.getElementById('muted');
  const fontSize = document.getElementById('fontSize');
  const lineNumbers = document.getElementById('lineNumbers');
  const urlInput = document.getElementById('url');

  function send(data) {
    vscode.postMessage({ type: 'config:change', data: data });
  }

  opacity.addEventListener('input', function() {
    opacityValue.textContent = this.value + '%';
    send({ opacity: Number(this.value) });
  });
  autoplay.addEventListener('change', function() { send({ autoplay: this.checked }); });
  muted.addEventListener('change', function() { send({ muted: this.checked }); });
  fontSize.addEventListener('change', function() {
    const v = Math.min(32, Math.max(10, Number(this.value) || 14));
    this.value = v;
    send({ fontSize: v });
  });
  lineNumbers.addEventListener('change', function() { send({ lineNumbers: this.checked }); });

  function openUrl() {
    const url = urlInput.value.trim();
    if (url) vscode.postMessage({ type: 'config:openUrl', data: { url: url } });
  }
  document.getElementById('openUrl').addEventListener('click', openUrl);
  urlInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') openUrl(); });

  window.addEventListener('message', function(event) {
    const msg = event.data;
    if (msg.type === 'config:current') {
      if (typeof msg.data.opacity === 'number') {
        opacity.value = msg.data.opacity;
        opacityValue.textContent = msg.data.opacity + '%';
      }
      if (typeof msg.data.autoplay === 'boolean') autoplay.checked = msg.data.autoplay;
      if (typeof msg.data.muted === 'boolean') muted.checked = msg.data.muted;
      if (typeof msg.data.fontSize === 'number') fontSize.value = msg.data.fontSize;
      if (typeof msg.data.lineNumbers === 'boolean') lineNumbers.checked = msg.data.lineNumbers;
    }
  });
})();
</script>
</body>
</html>`;
  }
}
