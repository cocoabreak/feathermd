import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

export function resolveWindowsPowerShell(
  environment = process.env,
  { lstat = lstatSync, realpath = realpathSync.native } = {}
) {
  const systemRoot = environment.SystemRoot;
  if (typeof systemRoot !== "string" || !path.win32.isAbsolute(systemRoot)) {
    throw new Error("Windows SystemRoot is unavailable");
  }
  const expected = path.win32.normalize(
    path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  );
  const stat = lstat(expected);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Windows PowerShell must be a real file");
  }
  const resolved = path.win32.normalize(realpath(expected));
  if (resolved.toLowerCase() !== expected.toLowerCase()) {
    throw new Error("Windows PowerShell resolved outside its system path");
  }
  return resolved;
}

export const windowsPowerShell = resolveWindowsPowerShell();
