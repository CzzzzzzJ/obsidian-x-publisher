// 把插件回传的 发布记录.json 写回发布素材 md 头部的「已发布」。
// 用法：node tools/backfill-links.mjs <工程目录> [发布素材.md]
//   md 不传时，按 publish.json 的 source（相对 DOC_ROOT，默认 ~/doc）找；工程目录里的 发布素材.md 备份也会一起更新。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const [dir, mdArg] = process.argv.slice(2);
if (!dir) { console.error('用法：node tools/backfill-links.mjs <工程目录> [发布素材.md]'); process.exit(2); }
const rec = JSON.parse(readFileSync(join(dir, '发布记录.json'), 'utf8'));
const b = JSON.parse(readFileSync(join(dir, 'publish.json'), 'utf8'));
const docRoot = process.env.DOC_ROOT || join(homedir(), 'doc');
const targets = [mdArg || (b.source ? join(docRoot, b.source) : null), join(dir, '发布素材.md')].filter(p => p && existsSync(p));
if (!targets.length) { console.error('找不到发布素材 md'); process.exit(1); }

const fmt = (t) => typeof t === 'number' ? new Date(t).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : (t || '');
const day = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
const lines = Object.values(rec.platforms).map(v =>
  `> - ${v.name}：${v.url || '（无链接）'}（${v.status}${v.time ? ` · ${fmt(v.time)}` : ''}）  `);
const block = [`> 已发布：${day} 回填  `, ...lines].join('\n');

for (const p of targets) {
  const md = readFileSync(p, 'utf8').split('\n');
  const i = md.findIndex(l => /^> 已发布：/.test(l));
  if (i < 0) { console.log(`⚠️  ${p} 头部没有「> 已发布：」这一行，跳过`); continue; }
  let j = i + 1;
  while (j < md.length && /^> - /.test(md[j])) j++;      // 替换上次回填的列表
  md.splice(i, j - i, ...block.split('\n'));
  writeFileSync(p, md.join('\n'));
  console.log(`已更新 ${p}`);
}
console.log(block);
