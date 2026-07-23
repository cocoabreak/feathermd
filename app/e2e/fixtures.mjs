import { mkdirSync, writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import path from "node:path";

const LARGE_MARKDOWN_BYTES = 5 * 1024 * 1024;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(entryName, content) {
  const name = Buffer.from(entryName);
  const data = Buffer.from(content);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

function fixedSizeMarkdown(size, heading) {
  const prefix = Buffer.from(`# ${heading}\n\n`);
  return Buffer.concat([prefix, Buffer.alloc(size - prefix.length, 0x78)]);
}

export function createFixtures(root) {
  mkdirSync(root, { recursive: true });
  const basic = path.join(root, "basic.md");
  const validMermaid = path.join(root, "valid-mermaid.md");
  const invalidMermaid = path.join(root, "invalid-mermaid.md");
  const belowLimit = path.join(root, "below-limit.md");
  const atLimit = path.join(root, "at-limit.md");
  const archive = path.join(root, "notes.zip");

  writeFileSync(
    basic,
    `# Smoke marker\n\nsmoke-marker\n\n${Array.from({ length: 300 }, (_, i) => `## Section ${i}\n\nline ${i}`).join("\n\n")}\n`
  );
  writeFileSync(
    validMermaid,
    [
      "# Mermaid",
      "",
      "```mermaid",
      "graph TD",
      "  F[Filter: SetCharacterEncodingFilter UTF-8] --> S[ActionServlet: action]",
      "  Rounded(Long rounded node label<br/>with explicit break)",
      "  Diamond{Diamond node label<br/>with explicit break}",
      "  Stadium([Stadium node label<br/>with explicit break])",
      "  Single[Single line]",
      "```",
      "",
      "regular paragraph",
      "",
    ].join("\n")
  );
  writeFileSync(invalidMermaid, "# Broken Mermaid\n\n```mermaid\ngraph TD\n  A -- ???\n```\n");
  writeFileSync(belowLimit, fixedSizeMarkdown(LARGE_MARKDOWN_BYTES - 1, "Below limit"));
  writeFileSync(atLimit, fixedSizeMarkdown(LARGE_MARKDOWN_BYTES, "At limit"));
  writeFileSync(archive, createStoredZip("inside.md", "# Archive\n\nzip-smoke-marker\n"));
  return { basic, validMermaid, invalidMermaid, belowLimit, atLimit, archive };
}
