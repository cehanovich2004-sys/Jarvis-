import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const ignored = new Set([".git", "node_modules", "dist", "coverage", ".pnpm-store"]);
const extensions = new Set([".json", ".md", ".mjs", ".ts", ".toml", ".yaml"]);

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (ignored.has(entry.name)) {
      continue;
    }

    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collect(path)));
      continue;
    }

    const extension = entry.name.includes(".") ? entry.name.slice(entry.name.lastIndexOf(".")) : "";
    if (extensions.has(extension) || entry.name === ".gitignore") {
      files.push(path);
    }
  }

  return files;
}

const files = await collect(root);
const failures = [];

for (const file of files) {
  const content = await readFile(file, "utf8");
  const relative = file.slice(root.length + 1);

  if (!content.endsWith("\n")) {
    failures.push(`${relative}: missing final newline`);
  }

  const lines = content.split("\n");
  lines.forEach((line, index) => {
    if (/[ \t]$/.test(line)) {
      failures.push(`${relative}:${index + 1}: trailing whitespace`);
    }
  });
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`format: checked ${files.length} files`);

