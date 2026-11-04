// node tools/validate.mjs <NAS 工程目录>  —— 校验 publish.json：文件是否齐全、各平台字段和字数
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { validate, PLATFORMS, len } from '../lib/bundle.js';

const dir = process.argv[2];
if (!dir) { console.error('用法：node tools/validate.mjs <工程目录>'); process.exit(2); }
const b = JSON.parse(readFileSync(join(dir, 'publish.json'), 'utf8'));
const files = new Set();
const walk = (d) => readdirSync(d).forEach(n => { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.add(relative(dir, p)); });
walk(dir);
const { errors, warnings } = validate(b, files);
console.log(`工程：${b.name}（${b.id}）`);
for (const [id, p] of Object.entries(b.platforms)) {
  const spec = PLATFORMS[id]; if (!spec || p.skip) continue;
  const f = Object.keys(spec.fields).map(k => `${k} ${len(p[k])}/${spec.fields[k][1]}`).join('，');
  console.log(`  ${spec.name}：${f}；封面 ${(p.covers || []).join('+') || '无'}`);
}
warnings.forEach(w => console.log(`⚠️  ${w}`));
errors.forEach(e => console.log(`❌ ${e}`));
console.log(errors.length ? `校验未通过：${errors.length} 个问题` : '✅ 校验通过');
process.exit(errors.length ? 1 : 0);
