/**
 * 全局类型定义
 */

/** 文件条目类型 */
export interface FileItem {
  /** 唯一标识 */
  id: string;
  /** 文件名 */
  name: string;
  /** 文件绝对路径：本地文件为原路径，拖拽文件为 globalStorage 中的落盘路径 */
  path: string;
  /** 文件类型：本地文件 / 拖拽文件 */
  type: 'local' | 'dropped';
  /** 文件大小（字节） */
  size: number;
  /** 添加时间戳 */
  createdAt: number;
  /** 最后访问时间戳 */
  lastOpenedAt?: number;
}

/** 从扩展发送到预览 Webview 的消息 */
export type ExtensionMessage =
  | { type: 'file:content'; data: { id: string; content: string; totalSize: number; hasMore: boolean } }
  | { type: 'file:contentChunk'; data: { id: string; chunk: string; hasMore: boolean } }
  | { type: 'file:htmlContent'; data: { id: string; html: string } }
  | { type: 'file:excelContent'; data: { id: string; sheets: { name: string }[]; currentIndex: number; html: string } }
  | { type: 'file:pdfContent'; data: { id: string; data: string } }
  | { type: 'file:videoContent'; data: { id: string; src: string; opacity: number; autoplay: boolean; muted: boolean } }
  | { type: 'file:loading'; data: { name: string } }
  | { type: 'config:update'; data: { opacity?: number; autoplay?: boolean; muted?: boolean } }
  | { type: 'error'; message: string }
  | { type: 'info'; message: string };

/** 从 Webview 发送到扩展的消息 */
export type WebviewMessage =
  | { type: 'preview:ready' }
  | { type: 'preview:loadMore'; data: { id: string; offset?: number } }
  | { type: 'preview:excelSwitchSheet'; data: { id: string; sheetIndex: number } }
  | { type: 'config:ready' }
  | { type: 'config:change'; data: { opacity?: number; autoplay?: boolean; muted?: boolean; fontSize?: number; lineNumbers?: boolean } }
  | { type: 'config:openUrl'; data: { url: string } };

/** 配置面板 → 扩展回发的当前配置 */
export type ConfigCurrentMessage =
  | { type: 'config:current'; data: { opacity: number; autoplay: boolean; muted: boolean; fontSize: number; lineNumbers: boolean } };
