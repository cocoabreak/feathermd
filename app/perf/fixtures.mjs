import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

export const PERFORMANCE_FIXTURES = [
  {
    id: "plain-v1",
    fileName: "plain-v1.md",
    byteSize: 574,
    sha256: "4b59e9d56849cf37a870fe68230bcd01fa9597c9ffb59edc5d2276a8179c672a",
    markers: ["perf-plain-marker-v1"],
  },
  {
    id: "rich-v1",
    fileName: "rich-v1.md",
    byteSize: 557,
    sha256: "a6d74cef1fc8d740502edcb1c1f5dc4fc3949097efe97ad6cf1bfadebabe435c",
    markers: [
      "perf-rich-marker-v1",
      "perf-shiki-javascript-marker-v1",
      "perf-shiki-rust-marker-v1",
      "perf-katex-marker-v1",
      "perf-mermaid-marker-v1",
    ],
  },
];

export function validatePerformanceFixtures(root = fixtureDir) {
  return PERFORMANCE_FIXTURES.map((fixture) => {
    const bytes = readFileSync(path.join(root, fixture.fileName));
    const text = bytes.toString("utf8");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.includes(0x0d)) throw new Error(`${fixture.id} must use LF line endings`);
    if (bytes.length !== fixture.byteSize) {
      throw new Error(
        `${fixture.id} byte size changed: expected ${fixture.byteSize}, got ${bytes.length}`
      );
    }
    if (digest !== fixture.sha256) throw new Error(`${fixture.id} content hash changed`);
    for (const marker of fixture.markers) {
      if (!text.includes(marker)) throw new Error(`${fixture.id} is missing marker ${marker}`);
    }
    if (/https?:\/\//i.test(text)) throw new Error(`${fixture.id} must not use remote resources`);
    return { ...fixture, path: path.join(root, fixture.fileName) };
  });
}
