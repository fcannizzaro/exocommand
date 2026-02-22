import { chmod } from "node:fs/promises";

const indexPath = "dist/index.js";
const file = Bun.file(indexPath);
const content = await file.text();

if (!content.startsWith("#!")) {
  await Bun.write(indexPath, `#!/usr/bin/env node\n${content}`);
}

await chmod(indexPath, 0o755);