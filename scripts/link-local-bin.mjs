import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const binDir = join(process.cwd(), "node_modules", ".bin");

const wrappers = [
  { name: "jarvis", target: "../../dist/src/cli.js" },
  { name: "jarvis-core", target: "../../dist/src/server.js" }
];

await mkdir(binDir, { recursive: true });

for (const wrapper of wrappers) {
  const path = join(binDir, wrapper.name);
  const content = `#!/usr/bin/env sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")
exec node "$basedir/${wrapper.target}" "$@"
`;

  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

console.log(`linked local CLI wrappers in ${binDir}`);
