import * as vscode from 'vscode';
import * as path from 'path';
import { FileItem } from '../types';
import { StorageService } from '../services/StorageService';
import { FileService } from '../services/FileService';
import { PreviewPanel } from '../preview/PreviewPanel';
import { formatFileSize } from '../utils/path';

/**
 * 侧边栏文件列表 TreeDataProvider
 * 使用 VS Code 原生 TreeView + TreeDragAndDropController，
 * 拖放由 VS Code 工作台直接处理，彻底解决 webview 拖放不稳定的问题。
 */
export class FileTreeProvider implements vscode.TreeDataProvider<FileItem>, vscode.TreeDragAndDropController<FileItem> {
  readonly dropMimeTypes = ['text/uri-list'];
  readonly dragMimeTypes: string[] = []; // 不支持从列表拖出

  private _onDidChangeTreeData = new vscode.EventEmitter<FileItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly storageService: StorageService,
    private readonly fileService: FileService,
    private readonly previewPanel: PreviewPanel
  ) {}

  /* ========== TreeDataProvider ========== */

  getTreeItem(element: FileItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.name);
    item.description = this.formatDescription(element);
    item.tooltip = element.path;
    item.contextValue = 'fileItem';
    item.iconPath = vscode.ThemeIcon.File;
    item.command = {
      command: 'filePreview.openFile',
      title: '打开预览',
      arguments: [element.id],
    };
    return item;
  }

  getChildren(): FileItem[] {
    return this.storageService.getFileList();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /* ========== Drag and Drop ========== */

  handleDrag(
    source: readonly FileItem[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    // 不支持从列表拖出
  }

  async handleDrop(
    target: FileItem | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    const uriListItem = dataTransfer.get('text/uri-list');
    if (!uriListItem) return;

    const uriStr = await uriListItem.asString();
    if (!uriStr) return;

    // text/uri-list 格式：每行一个 URI，以 \r\n 分隔，# 开头的是注释
    const uris: vscode.Uri[] = uriStr
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('#'))
      .map(s => {
        try { return vscode.Uri.parse(s); } catch { return undefined; }
      })
      .filter((u): u is vscode.Uri => !!u);

    if (!uris.length) return;

    let lastAdded: FileItem | undefined;

    for (const uri of uris) {
      // 只接受文件，跳过文件夹
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type !== vscode.FileType.File) continue;
      } catch {
        continue;
      }

      const filePath = uri.fsPath;
      const exists = await this.fileService.exists(filePath);
      if (!exists) continue;

      const size = await this.fileService.getFileSize(filePath);
      const fileName = this.fileService.getFileName(filePath);

      const fileItem: FileItem = {
        id: this.generateId(),
        name: fileName,
        path: filePath,
        type: 'local',
        size,
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
      };

      await this.storageService.addFile(fileItem);
      lastAdded = fileItem;
    }

    if (lastAdded) {
      this.refresh();
      this.previewPanel.renderFile(lastAdded);
    }
  }

  /* ========== 公共方法 ========== */

  /**
   * 通过路径添加文件（供命令调用）
   */
  async addFileByPath(filePath: string): Promise<void> {
    const exists = await this.fileService.exists(filePath);
    if (!exists) {
      vscode.window.showErrorMessage(`文件不存在：${filePath}`);
      return;
    }

    const size = await this.fileService.getFileSize(filePath);
    const fileName = this.fileService.getFileName(filePath);

    const fileItem: FileItem = {
      id: this.generateId(),
      name: fileName,
      path: filePath,
      type: 'local',
      size,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
    };

    await this.storageService.addFile(fileItem);
    this.refresh();
    this.previewPanel.renderFile(fileItem);
  }

  /**
   * 打开文件选择对话框并添加
   */
  async pickAndAddFile(): Promise<void> {
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      filters: {
        '文本文件': ['txt', 'log', 'json', 'xml', 'csv', 'yml', 'yaml', 'ini', 'conf'],
        '文档': ['docx', 'xlsx', 'xls', 'pdf'],
        'Markdown': ['md', 'markdown'],
        '网页': ['html', 'htm'],
        '所有文件': ['*'],
      },
      title: '选择要预览的文件',
    });

    if (!result || !result.length) return;

    let lastAdded: FileItem | undefined;
    for (const uri of result) {
      const filePath = uri.fsPath;
      const exists = await this.fileService.exists(filePath);
      if (!exists) continue;

      const size = await this.fileService.getFileSize(filePath);
      const fileName = this.fileService.getFileName(filePath);

      const fileItem: FileItem = {
        id: this.generateId(),
        name: fileName,
        path: filePath,
        type: 'local',
        size,
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
      };

      await this.storageService.addFile(fileItem);
      lastAdded = fileItem;
    }

    if (lastAdded) {
      this.refresh();
      this.previewPanel.renderFile(lastAdded);
    }
  }

  /**
   * 批量删除（支持单个）：一次确认，仅移出列表，不删除磁盘源文件
   */
  async deleteFiles(items: FileItem[]): Promise<void> {
    if (!items.length) return;

    const label = items.length === 1 ? `「${items[0].name}」` : `${items.length} 个文件`;
    const confirm = await vscode.window.showWarningMessage(
      `确定从列表移除${label}吗？（不会删除磁盘上的源文件）`,
      { modal: true },
      '移除'
    );
    if (confirm !== '移除') return;

    const currentId = this.previewPanel.getCurrentFileId();
    for (const fileItem of items) {
      if (currentId === fileItem.id) {
        this.previewPanel.close();
      }
      // 拖拽文件的落盘内容需一并清理
      if (fileItem.type === 'dropped') {
        try {
          await vscode.workspace.fs.delete(vscode.Uri.file(fileItem.path));
        } catch {
          // 忽略
        }
      }
      await this.storageService.removeFile(fileItem.id);
    }
    this.refresh();
  }

  /**
   * 删除文件（单个）
   */
  async deleteFile(fileItem: FileItem): Promise<void> {
    await this.deleteFiles([fileItem]);
  }

  /**
   * 打开预览
   */
  openFile(id: string): void {
    const fileItem = this.storageService.getFileById(id);
    if (!fileItem) return;

    this.storageService.touchFile(id);
    this.refresh();
    this.previewPanel.renderFile(fileItem);
  }

  /* ========== 私有方法 ========== */

  private formatDescription(item: FileItem): string {
    const typeLabel = item.type === 'dropped' ? '拖拽·' : '';
    const time = new Date(item.createdAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStr = `${pad(time.getMonth() + 1)}/${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
    return `${typeLabel}${formatFileSize(item.size)} · ${timeStr}`;
  }

  private generateId(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
}
