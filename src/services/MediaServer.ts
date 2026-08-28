import * as http from 'http';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
};

/**
 * 本地媒体服务：
 * webview 的 localResourceRoots 对任意路径的本地视频不可靠，
 * 改由扩展宿主启动 127.0.0.1 HTTP 服务流式提供媒体文件（支持 Range，可拖进度条）。
 * URL 中带随机 token，避免本机其他进程猜测端口后任意读文件。
 */
export class MediaServer implements vscode.Disposable {
  private server: http.Server | undefined;
  private port = 0;
  private readonly token = Math.random().toString(36).slice(2) + Date.now().toString(36);

  async start(): Promise<number> {
    if (this.server) return this.port;
    await new Promise<void>((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        this.handle(req, res).catch(() => {
          try { res.writeHead(500); res.end(); } catch { /* 已响应则忽略 */ }
        });
      });
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        this.port = typeof addr === 'object' && addr ? addr.port : 0;
        this.server = srv;
        resolve();
      });
    });
    return this.port;
  }

  urlFor(filePath: string): string {
    return `http://127.0.0.1:${this.port}/v/${this.token}/${encodeURIComponent(filePath)}`;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parts = (req.url ?? '').split('?')[0].split('/').filter(Boolean);
    if (parts.length < 3 || parts[0] !== 'v' || parts[1] !== this.token) {
      res.writeHead(404);
      res.end();
      return;
    }

    const filePath = decodeURIComponent(parts.slice(2).join('/'));
    const stat = await fsp.stat(filePath).catch(() => undefined);
    if (!stat || !stat.isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }

    const mime = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
      const start = m && m[1] ? parseInt(m[1], 10) : 0;
      const end = Math.min(m && m[2] ? parseInt(m[2], 10) : stat.size - 1, stat.size - 1);
      if (start >= stat.size || start > end) {
        res.writeHead(416);
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': mime,
      });
      const stream = fs.createReadStream(filePath, { start, end });
      stream.pipe(res);
      req.on('close', () => stream.destroy());
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
        'Content-Type': mime,
      });
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      req.on('close', () => stream.destroy());
    }
  }

  dispose(): void {
    if (this.server) {
      try { this.server.closeAllConnections(); } catch { /* 低版本 Node 无此方法 */ }
      this.server.close(() => {});
      this.server = undefined;
    }
  }
}
