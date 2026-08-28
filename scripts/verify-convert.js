/**
 * 转换管道验证脚本（node scripts/verify-convert.js）
 * 生成真实的 .xlsx / .docx 样本，跑一遍 FileService 完整转换链路
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
let JSZip;
try { JSZip = require('jszip'); } catch { JSZip = require('mammoth/node_modules/jszip'); }
const { FileService } = require('../out/services/FileService.js');

async function main() {
  const svc = new FileService();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'visx-convert-'));

  /* ---------- Excel：两个 Sheet，含特殊字符 ---------- */
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['姓名', '年龄', '备注'],
    ['张三', 28, '北京'],
    ['李|四', 32, '上海\n浦东'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws1, '人员');
  const ws2 = XLSX.utils.aoa_to_sheet([
    ['产品', '销量'],
    ['A', 100],
    ['B', 200],
  ]);
  XLSX.utils.book_append_sheet(wb, ws2, '销量');
  const xlsxPath = path.join(tmp, 'sample.xlsx');
  XLSX.writeFile(wb, xlsxPath);

  console.log('[xlsx] getFileType =', svc.getFileType(xlsxPath));
  const { sheets } = await svc.readXlsxAsMarkdown(xlsxPath);
  console.log('[xlsx] sheets =', sheets.map(s => s.name).join(', '));
  console.log('--- sheet[0] markdown ---');
  console.log(sheets[0].content);
  console.log('--- sheet[0] html ---');
  console.log(svc.markdownToHtml(sheets[0].content));

  /* ---------- Word：最小可用 .docx（标题+段落+粗体+表格） ---------- */
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
</w:styles>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>测试标题</w:t></w:r></w:p>
    <w:p><w:r><w:t>这是普通段落，包含</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>粗体</w:t></w:r><w:r><w:t>文本。</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>列1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>列2</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>`);
  const docxBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const docxPath = path.join(tmp, 'sample.docx');
  fs.writeFileSync(docxPath, docxBuffer);

  console.log('\n[docx] getFileType =', svc.getFileType(docxPath));
  const docxHtml = await svc.readDocxAsHtml(docxPath);
  console.log('--- docx html ---');
  console.log(docxHtml);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nDONE');
}

main().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
