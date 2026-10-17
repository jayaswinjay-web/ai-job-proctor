import { inflateRawSync } from 'node:zlib';

/**
 * Minimal, dependency-free XLSX reader and writer.
 *
 * Scope is deliberately narrow: read the first worksheet of a standard `.xlsx`
 * produced by Excel or LibreOffice, and write a single-sheet workbook. That covers
 * the question import/export requirement without pulling in a large third-party
 * spreadsheet library into a service that handles candidate data.
 *
 * XLSX is a ZIP of XML parts, so this uses only `zlib.inflateRawSync` and a small
 * ZIP directory parser.
 */

/* -------------------------------------------------------------------------- */
/* ZIP                                                                        */
/* -------------------------------------------------------------------------- */

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function readZipDirectory(buffer: Buffer): Map<string, ZipEntry> {
  // Locate the end-of-central-directory record by scanning backwards for its signature.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 22 - 65_536; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('Not a valid XLSX file (no ZIP central directory).');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();

  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    entries.set(name, {
      name,
      compressionMethod: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      uncompressedSize: buffer.readUInt32LE(offset + 24),
      localHeaderOffset: buffer.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipFile(buffer: Buffer, entry: ZipEntry): Buffer {
  const localOffset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Corrupt XLSX entry: ${entry.name}`);
  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const data = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return Buffer.from(data);
  if (entry.compressionMethod === 8) return inflateRawSync(data);
  throw new Error(`Unsupported XLSX compression method ${entry.compressionMethod} in ${entry.name}`);
}

/* -------------------------------------------------------------------------- */
/* XML                                                                        */
/* -------------------------------------------------------------------------- */

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  '#34': '"',
};

function decodeXml(text: string): string {
  return text.replace(/&(#x?[0-9A-Fa-f]+|[a-z]+);/g, (match, code: string) => {
    const key = code.toLowerCase();
    if (XML_ENTITIES[key] !== undefined) return XML_ENTITIES[key]!;
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10));
    return match;
  });
}

/* -------------------------------------------------------------------------- */
/* Reader                                                                     */
/* -------------------------------------------------------------------------- */

export function readWorkbook(buffer: Buffer): Array<Record<string, unknown>> {
  const zip = readZipDirectory(buffer);

  const sharedStrings: string[] = [];
  const sharedEntry = zip.get('xl/sharedStrings.xml');
  if (sharedEntry) {
    const xml = readZipFile(buffer, sharedEntry).toString('utf8');
    for (const match of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      // Shared strings can be a single <t> or a run of <r><t>…</t></r>.
      const parts = [...(match[1] ?? '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1] ?? ''));
      sharedStrings.push(parts.join(''));
    }
  }

  const sheetName = [...zip.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw new Error('This XLSX file contains no worksheets.');
  const sheetXml = readZipFile(buffer, zip.get(sheetName)!).toString('utf8');

  const rows: Array<Array<string>> = [];
  for (const rowMatch of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] ?? '';
      const body = cellMatch[2] ?? '';
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      const columnIndex = ref ? columnFromLetters(ref) : cells.length;

      let value = '';
      if (type === 'inlineStr') {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1] ?? '')).join('');
      } else if (type === 's') {
        const index = Number(decodeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '-1'));
        value = sharedStrings[index] ?? '';
      } else {
        value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
      }
      while (cells.length < columnIndex) cells.push('');
      cells[columnIndex] = value;
    }
    rows.push(cells);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0]!.map((h) => h.trim());
  return nonEmpty.slice(1).map((cells) => {
    const record: Record<string, unknown> = {};
    header.forEach((h, index) => {
      record[h] = cells[index] ?? '';
    });
    return record;
  });
}

function columnFromLetters(letters: string): number {
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function columnLetters(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Writer                                                                     */
/* -------------------------------------------------------------------------- */

export interface SheetData {
  sheetName: string;
  rows: Array<Array<string | number | null | undefined>>;
}

/**
 * Writes a single-sheet `.xlsx` using STORED (uncompressed) ZIP entries. Larger than a
 * compressed file but universally readable, and cheap enough for a report export.
 */
export function writeWorkbook(sheets: SheetData[]): Buffer {
  const parts: Array<{ name: string; content: Buffer }> = [];

  parts.push({
    name: '[Content_Types].xml',
    content: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets
  .map(
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join('\n')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
      'utf8',
    ),
  });

  parts.push({
    name: '_rels/.rels',
    content: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
      'utf8',
    ),
  });

  parts.push({
    name: 'xl/workbook.xml',
    content: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets
    .map(
      (s, i) =>
        `<sheet name="${escapeXml(s.sheetName.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join('')}</sheets>
</workbook>`,
      'utf8',
    ),
  });

  parts.push({
    name: 'xl/_rels/workbook.xml.rels',
    content: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join('\n')}
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
      'utf8',
    ),
  });

  parts.push({
    name: 'xl/styles.xml',
    content: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`,
      'utf8',
    ),
  });

  sheets.forEach((sheet, sheetIndex) => {
    const body = sheet.rows
      .map((row, rowIndex) => {
        const cells = row
          .map((value, colIndex) => {
            if (value === null || value === undefined || value === '') return '';
            const ref = `${columnLetters(colIndex)}${rowIndex + 1}`;
            if (typeof value === 'number' && Number.isFinite(value)) {
              return `<c r="${ref}"><v>${value}</v></c>`;
            }
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
          })
          .join('');
        return `<row r="${rowIndex + 1}">${cells}</row>`;
      })
      .join('');
    parts.push({
      name: `xl/worksheets/sheet${sheetIndex + 1}.xml`,
      content: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`,
        'utf8',
      ),
    });
  });

  return buildZip(parts);
}

function buildZip(parts: Array<{ name: string; content: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const part of parts) {
    const nameBuffer = Buffer.from(part.name, 'utf8');
    const crc = crc32(part.content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(0, 8); // STORED
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x2821, 12); // mod date (fixed for reproducibility)
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(part.content.length, 18);
    localHeader.writeUInt32LE(part.content.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    chunks.push(localHeader, nameBuffer, part.content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x2821, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(part.content.length, 20);
    centralHeader.writeUInt32LE(part.content.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + part.content.length;
  }

  const centralBuffer = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(parts.length, 8);
  eocd.writeUInt16LE(parts.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuffer, eocd]);
}

let crcTable: Uint32Array | null = null;
function crc32(buffer: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Strip control characters Excel rejects.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}