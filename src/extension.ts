import * as vscode from 'vscode';
import { FileTreeProvider } from './sidebar/FileTreeProvider';
import { PreviewPanel } from './preview/PreviewPanel';
import { ConfigPanel } from './preview/ConfigPanel';
import { StorageService } from './services/StorageService';
import { FileService } from './services/FileService';

/**
 * 扩展激活入口
 */
export function activate(context: vscode.ExtensionContext): void {
  // 初始化服务
  const storageService = new StorageService(context.globalState);
  const fileService = new FileService();
  const previewPanel = PreviewPanel.getInstance(context, fileService);

  // 创建 TreeDataProvider
  const treeDataProvider = new FileTreeProvider(storageService, fileService, previewPanel);

  // 创建 TreeView
  const treeView = vscode.window.createTreeView('filePreview.sidebar', {
    treeDataProvider,
    canSelectMany: true,
    showCollapseAll: false,
    dragAndDropController: treeDataProvider,
  });
  context.subscriptions.push(treeView);

  // 选中项变化时打开预览
  context.subscriptions.push(
    treeView.onDidChangeSelection(e => {
      const selected = e.selection[0];
      if (selected) {
        treeDataProvider.openFile(selected.id);
      }
    })
  );

  // 命令：打开预览面板
  context.subscriptions.push(
    vscode.commands.registerCommand('filePreview.open', () => {
      previewPanel.createOrShow();
    })
  );

  // 命令：切换侧边栏
  context.subscriptions.push(
    vscode.commands.registerCommand('filePreview.toggleSidebar', () => {
      vscode.commands.executeCommand('workbench.view.extension.file-preview');
    })
  );

  // 命令：新增文件
  context.subscriptions.push(
    vscode.commands.registerCommand('filePreview.addFile', () => {
      treeDataProvider.pickAndAddFile();
    })
  );

  // 命令：删除文件（支持多选批量删除）
  context.subscriptions.push(
    vscode.commands.registerCommand('filePreview.deleteFile', (item, selectedItems) => {
      const items = selectedItems?.length
        ? selectedItems
        : item
          ? [item]
          : treeView.selection.length
            ? treeView.selection
            : [];
      if (items.length) {
        treeDataProvider.deleteFiles(items);
      }
    })
  );

  // 命令：刷新列表
  context.subscriptions.push(
    vscode.commands.registerCommand('filePreview.refreshList', () => {
      treeDataProvider.refresh();
    })
  );

  // 命令：打开预览文件（TreeItem click 调用）
  context.subscriptions.push(
    vscode.commands.registerCommand('filePreview.openFile', (id: string) => {
      treeDataProvider.openFile(id);
    })
  );

  // 命令：打开二级配置面板（侧边栏标题栏 ⚙）
  const configPanel = ConfigPanel.getInstance(context, previewPanel);
  context.subscriptions.push(
    vscode.commands.registerCommand('filePreview.openConfig', () => {
      configPanel.createOrShow();
    })
  );

  // 命令：老板键 —— 有预览则一键隐藏，无预览则恢复上次预览
  let lastPreviewFileId: string | undefined;
  context.subscriptions.push(
    vscode.commands.registerCommand('filePreview.bossKey', () => {
      const currentId = previewPanel.getCurrentFileId();
      if (currentId) {
        lastPreviewFileId = currentId;
        previewPanel.close();
      } else if (lastPreviewFileId) {
        const item = storageService.getFileById(lastPreviewFileId);
        if (item) {
          treeDataProvider.openFile(item.id);
        } else {
          // 在线链接预览等非列表文件，无法恢复
          lastPreviewFileId = undefined;
        }
      }
    })
  );

  // 命令：视频透明度快捷增减（步长 10，实时应用，状态栏提示当前值）
  const adjustOpacity = (delta: number) => {
    const config = vscode.workspace.getConfiguration('filePreview');
    const current = config.get<number>('videoOpacity', 100);
    const next = Math.min(100, Math.max(0, current + delta));
    config.update('videoOpacity', next, vscode.ConfigurationTarget.Global);
    previewPanel.applyVideoConfig(next, undefined);
    configPanel.notifyOpacity(next);
    vscode.window.setStatusBarMessage(`视频透明度：${next}%`, 2000);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('filePreview.increaseVideoOpacity', () => adjustOpacity(10)),
    vscode.commands.registerCommand('filePreview.decreaseVideoOpacity', () => adjustOpacity(-10))
  );
}

/**
 * 扩展停用
 */
export function deactivate(): void {
  // 清理工作（如有需要）
}
