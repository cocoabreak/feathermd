import assert from "node:assert/strict";
import test from "node:test";
import { resolveWindowsPowerShell } from "./windows-powershell.mjs";

const expected = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const realFile = {
  isFile: () => true,
  isSymbolicLink: () => false,
};

test("resolves only the real PowerShell executable under SystemRoot", () => {
  assert.equal(
    resolveWindowsPowerShell(
      { SystemRoot: "C:\\Windows" },
      { lstat: () => realFile, realpath: () => expected }
    ),
    expected
  );
  assert.throws(() => resolveWindowsPowerShell({ SystemRoot: "relative" }), /SystemRoot/);
  assert.throws(
    () =>
      resolveWindowsPowerShell(
        { SystemRoot: "C:\\Windows" },
        { lstat: () => realFile, realpath: () => "C:\\temp\\powershell.exe" }
      ),
    /outside/
  );
});
