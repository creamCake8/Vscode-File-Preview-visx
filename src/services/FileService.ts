import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { marked } from 'marked';

const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const open = promisify(fs.open);
const read = promisify(fs.read);
const close = promisify(fs.close);

/** 文件类型 */
export type FileType = 'text' | 'markdown' | 'html' | 'word' | 'excel' | 'pdf' | 'video' | 'unknown';

/**
 * 文件服务：负责文件读取、校验、分片读取、格式转换
 */
export class FileService {
  /** 大文件阈值（1MB） */
  private static readonly LARGE_FILE_THRESHOLD = 1024 * 1024;

  /** 每次分片读取的块大小（64KB） */
  private static readonly CHUNK_SIZE = 64 * 1024;

  /**
   * 检查文件是否存在且为文件
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      const stats = await stat(filePath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  /**
   * 获取文件大小
   */
  async getFileSize(filePath: string): Promise<number> {
    try {
      const stats = await stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  /**
   * 判断是否为大文件
   */
  async isLargeFile(filePath: string): Promise<boolean> {
    const size = await this.getFileSize(filePath);
    return size >= FileService.LARGE_FILE_THRESHOLD;
  }

  /**
   * 读取文本文件（完整读取）
   */
  async readTxtFile(filePath: string): Promise<string> {
    const buffer = await readFile(filePath);
    return buffer.toString('utf-8');
  }

  /**
   * 读取文件原始内容（供 PDF 等二进制格式使用）
   */
  async readFileBuffer(filePath: string): Promise<Buffer> {
    return readFile(filePath);
  }

  /**
   * 分片读取文件首屏内容
   * @param filePath 文件路径
   * @param maxBytes 最大读取字节数（默认 512KB）
   */
  async readFileHead(filePath: string, maxBytes: number = 512 * 1024): Promise<{ content: string; hasMore: boolean; totalSize: number }> {
    const totalSize = await this.getFileSize(filePath);
    const bytesToRead = Math.min(maxBytes, totalSize);

    if (bytesToRead === 0) {
      return { content: '', hasMore: false, totalSize: 0 };
    }

    const fd = await open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await read(fd, buffer, 0, bytesToRead, 0);
      const content = buffer.toString('utf-8', 0, bytesRead);
      return {
        content,
        hasMore: bytesRead < totalSize,
        totalSize,
      };
    } finally {
      await close(fd);
    }
  }

  /**
   * 从指定偏移量开始读取一块内容
   */
  async readFileChunk(filePath: string, offset: number, chunkSize: number = FileService.CHUNK_SIZE): Promise<{ chunk: string; hasMore: boolean }> {
    const totalSize = await this.getFileSize(filePath);
    if (offset >= totalSize) {
      return { chunk: '', hasMore: false };
    }

    const bytesToRead = Math.min(chunkSize, totalSize - offset);
    const fd = await open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await read(fd, buffer, 0, bytesToRead, offset);
      const chunk = buffer.toString('utf-8', 0, bytesRead);
      return {
        chunk,
        hasMore: offset + bytesRead < totalSize,
      };
    } finally {
      await close(fd);
    }
  }

  /**
   * 从路径提取文件名
   */
  getFileName(filePath: string): string {
    return path.basename(filePath);
  }

  /**
   * 根据扩展名判断文件类型
   */
  getFileType(filePath: string): FileType {
    const ext = path.extname(filePath).toLowerCase();
    const textExts = ['.txt', '.log', '.json', '.xml', '.csv', '.yml', '.yaml', '.ini', '.conf', '.js', '.ts', '.css', '.py', '.java', '.c', '.cpp', '.h', '.go', '.rs', '.sh', '.bat', '.sql'];
    if (textExts.includes(ext)) return 'text';
    if (ext === '.md' || ext === '.markdown') return 'markdown';
    if (ext === '.html' || ext === '.htm') return 'html';
    if (ext === '.docx') return 'word';
    if (ext === '.xlsx' || ext === '.xls') return 'excel';
    if (ext === '.pdf') return 'pdf';
    if (['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv'].includes(ext)) return 'video';
    // 未知类型当作文本尝试
    return 'text';
  }

  /**
   * 检查文件头部是否为二进制格式
   * 用于把旧版 Office (.doc)、损坏文件等拦截在纯文本渲染之外
   */
  async isBinaryFile(filePath: string): Promise<boolean> {
    const fd = await open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(8);
      const { bytesRead } = await read(fd, buffer, 0, 8, 0);
      if (bytesRead >= 4) {
        // OLE 复合文档（旧版 .doc / .xls / .ppt）
        if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) return true;
        // ZIP（.docx/.xlsx 等容器）
        if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return true;
        // PDF
        if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return true;
      }
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) return true;
      }
      return false;
    } finally {
      await close(fd);
    }
  }

  /**
   * 读取 Word (.docx) 并转换为 HTML
   * 注：mammoth 的 convertToMarkdown 不支持表格（会被拍平成段落），
   * 因此 Word 直接走 convertToHtml；Markdown 渲染管道（marked）用于 Excel 和 .md 文件
   */
  async readDocxAsHtml(filePath: string): Promise<string> {
    const buffer = await readFile(filePath);
    const result = await mammoth.convertToHtml({ buffer });
    return result.value;
  }

  /**
   * 读取 Excel (.xlsx/.xls)，每个 Sheet 转换为 Markdown 表格
   */
  async readXlsxAsMarkdown(filePath: string): Promise<{ sheets: { name: string; content: string }[]; defaultSheet: number }> {
    const buffer = await readFile(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });

    const sheets = workbook.SheetNames.map(name => ({
      name,
      content: this.worksheetToMarkdown(workbook.Sheets[name]),
    }));

    return { sheets, defaultSheet: 0 };
  }

  /**
   * Markdown 转 HTML（marked）
   */
  markdownToHtml(markdown: string): string {
    return marked.parse(markdown) as string;
  }

  /**
   * 工作表转 Markdown 表格
   * 用 sheet_to_json 取二维数组，自行拼接 GFM 表格语法（支持 marked 渲染）
   */
  private worksheetToMarkdown(worksheet: XLSX.WorkSheet): string {
    const rows = XLSX.utils.sheet_to_json<string[]>(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    if (!rows.length) return '*（空表格）*';

    const width = Math.max(...rows.map(r => r.length));
    const pad = (n: number) => String(n).padStart(2, '0');
    const esc = (v: unknown) => {
      if (v instanceof Date) {
        return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}`;
      }
      return String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
    };

    const cell = (row: unknown[], i: number) => esc(row[i] ?? '');
    const line = (row: unknown[]) =>
      '| ' + Array.from({ length: width }, (_, i) => cell(row, i)).join(' | ') + ' |';

    const lines: string[] = [];
    lines.push(line(rows[0]));
    lines.push('| ' + Array.from({ length: width }, () => '---').join(' | ') + ' |');
    for (let r = 1; r < rows.length; r++) {
      lines.push(line(rows[r]));
    }
    return lines.join('\n');
  }
}
