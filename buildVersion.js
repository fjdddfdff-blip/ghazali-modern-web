import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const APP_INPUTS = ["index.html", "package.json", "vite.config.js", "buildVersion.js", "src", "public"];

export function getBuildVersion(root) {
  const hash = createHash("sha256");

  function addInput(path) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = join(path, entry.name);
      if (entry.isDirectory()) addInput(fullPath);
      else if (entry.isFile()) addFile(fullPath);
    }
  }

  function addFile(path) {
    hash.update(relative(root, path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }

  for (const input of APP_INPUTS) {
    const path = join(root, input);
    if (input.includes(".")) addFile(path);
    else addInput(path);
  }

  return `1.0.0+${hash.digest("hex").slice(0, 12)}`;
}
