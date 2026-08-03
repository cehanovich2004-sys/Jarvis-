import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const ignored = new Set([".git", "node_modules", "dist", "coverage", ".pnpm-store"]);
const scannedExtensions = new Set([".ts", ".mjs", ".json", ".toml"]);

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
    if (scannedExtensions.has(extension)) {
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

  if (relative.endsWith(".json")) {
    try {
      JSON.parse(content);
    } catch (error) {
      failures.push(`${relative}: invalid JSON: ${error.message}`);
    }
  }

  if (relative.startsWith("src/") || relative.startsWith("tests/")) {
    if (content.includes("0.0.0.0")) {
      failures.push(`${relative}: public bind literal is forbidden`);
    }

    if (/console\.(log|debug|info|warn|error)\(/.test(content) && !relative.endsWith("cli.ts") && !relative.endsWith("server.ts")) {
      failures.push(`${relative}: unexpected console usage`);
    }
  }

  if (relative.startsWith(".codex/agents/") && /sandbox_mode\s*=\s*"danger-full-access"/.test(content)) {
    failures.push(`${relative}: danger-full-access sandbox is forbidden`);
  }

  if (/api[_-]?key\s*[:=]\s*["'][^"']+["']/i.test(content)) {
    failures.push(`${relative}: possible hard-coded API key`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`lint: checked ${files.length} files`);

