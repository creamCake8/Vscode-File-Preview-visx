import * as vscode from 'vscode';
import { FileItem } from '../types';

/**
 * 存储服务：基于 globalState 实现文件列表持久化
 */
export class StorageService {
  private static readonly FILE_LIST_KEY = 'filePreview.fileList';

  constructor(private readonly globalState: vscode.Memento) {}

  /**
   * 获取文件列表
   */
  getFileList(): FileItem[] {
    const list = this.globalState.get<FileItem[]>(StorageService.FILE_LIST_KEY, []);
    // 按添加时间倒序（最新的在前面）
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 新增文件（插入首位）
   */
  async addFile(fileItem: FileItem): Promise<void> {
    const list = this.globalState.get<FileItem[]>(StorageService.FILE_LIST_KEY, []);
    // 避免重复：如果路径相同则移到首位
    const filtered = list.filter(f => f.id !== fileItem.id && f.path !== fileItem.path);
    filtered.unshift(fileItem);
    await this.globalState.update(StorageService.FILE_LIST_KEY, filtered);
  }

  /**
   * 删除文件
   */
  async removeFile(id: string): Promise<void> {
    const list = this.globalState.get<FileItem[]>(StorageService.FILE_LIST_KEY, []);
    const filtered = list.filter(f => f.id !== id);
    await this.globalState.update(StorageService.FILE_LIST_KEY, filtered);
  }

  /**
   * 根据 ID 获取文件
   */
  getFileById(id: string): FileItem | undefined {
    const list = this.globalState.get<FileItem[]>(StorageService.FILE_LIST_KEY, []);
    return list.find(f => f.id === id);
  }

  /**
   * 更新文件信息
   */
  async updateFile(id: string, updates: Partial<FileItem>): Promise<void> {
    const list = this.globalState.get<FileItem[]>(StorageService.FILE_LIST_KEY, []);
    const updated = list.map(f => (f.id === id ? { ...f, ...updates } : f));
    await this.globalState.update(StorageService.FILE_LIST_KEY, updated);
  }

  /**
   * 更新最后访问时间并移到列表首位
   */
  async touchFile(id: string): Promise<void> {
    const list = this.globalState.get<FileItem[]>(StorageService.FILE_LIST_KEY, []);
    const index = list.findIndex(f => f.id === id);
    if (index === -1) {
      return;
    }
    const [item] = list.splice(index, 1);
    item.lastOpenedAt = Date.now();
    list.unshift(item);
    await this.globalState.update(StorageService.FILE_LIST_KEY, list);
  }
}
