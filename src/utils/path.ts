import * as path from 'path';

/**
 * 路径工具函数
 */

/**
 * 从路径中提取文件名
 */
export function getFileName(filePath: string): string {
  return path.basename(filePath);
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * 生成唯一 ID
 */
export function generateId(): string {
  return `fp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
