// 检查 README 与 docs/ 里的相对链接是否指向存在的文件，避免文档改名后留下死链。
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const files = ["README.md", "CONTRIBUTING.md", "TESTING.md", "CHANGELOG.md"]
  .concat(readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`))
  .filter((f) => existsSync(join(root, f)));

let bad = 0;
for (const file of files) {
  const text = readFileSync(join(root, file), "utf8").replace(/```[\s\S]*?```/g, "");
  const links = [...text.matchAll(/\]\(([^)\s]+)\)|src="([^"]+)"/g)].map((m) => m[1] || m[2]);
  for (const link of links) {
    if (/^(https?:|mailto:|#)/.test(link)) continue;
    const target = decodeURIComponent(link.split("#")[0]);
    if (!target) continue;
    if (!existsSync(join(root, dirname(file), target))) {
      console.error(`死链：${file} -> ${link}`);
      bad++;
    }
  }
}
console.log(`检查了 ${files.length} 个文档${bad ? `，发现 ${bad} 个死链` : "，没有死链"}`);
process.exit(bad ? 1 : 0);
