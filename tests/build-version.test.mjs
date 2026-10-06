import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getBuildVersion } from "../buildVersion.js";

test("the displayed version starts at 1 and changes when app code changes", () => {
  const root = mkdtempSync(join(tmpdir(), "ghazali-version-"));
  try {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "public"));
    for (const name of ["index.html", "package.json", "vite.config.js", "buildVersion.js"]) {
      writeFileSync(join(root, name), name);
    }
    writeFileSync(join(root, "src", "main.js"), "first release");
    writeFileSync(join(root, "public", "legacy.js"), "first release");

    const first = getBuildVersion(root);
    assert.match(first, /^1\.0\.0\+[a-f0-9]{12}$/);
    assert.equal(getBuildVersion(root), first);

    writeFileSync(join(root, "public", "legacy.js"), "second release");
    assert.notEqual(getBuildVersion(root), first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
