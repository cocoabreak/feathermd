import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function javascriptFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return javascriptFiles(target);
    return entry.name.endsWith(".js") ? [target] : [];
  });
}

const hits = javascriptFiles("build").filter((file) =>
  readFileSync(file, "utf8").includes("__e2e")
);
if (hits.length > 0) {
  throw new Error(`production成果物にwindow.__e2eが残っています: ${hits.join(", ")}`);
}
globalThis.console.log("production成果物にwindow.__e2eは含まれていません。");
