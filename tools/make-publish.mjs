// 从发布素材 md 生成 publish.json，写进 NAS 工程目录，并校验。
// 用法：node tools/make-publish.mjs <发布素材.md> <工程目录> [--require 麦当mdldm] [--schedule "2026-11-05 18:00"]
//
// md 约定（mdldm-publish-assets skill 的模板）：
//   头部：「> 序号：31」「> 定时发布：2026-11-05 18:00」
//   ## 三、B站       **标题：** / **简介：** / **标签：**（#标签 空格分隔）
//   ## 四、小红书     **标题：** / **正文：**（正文最后一行是 #话题）
//   ## 五、抖音       **标题：** / **正文：**
//   ## 六、视频号     **短标题：** / **描述：**
//   ## 七、YouTube   **标题：** / **简介：** / **标签：**（逗号分隔）
//   ## 八、X         整节就是推文
// 工程目录里：成片.mp4、封面/cover-3x4.png、cover-4x3.png、cover-16x9.jpg（有哪个用哪个）
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { validate } from '../lib/bundle.js';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const require_ = opt('--require') || '麦当mdldm';
const scheduleArg = opt('--schedule');
const [mdPath, dir] = args;
if (!mdPath || !dir) { console.error('用法：node tools/make-publish.mjs <发布素材.md> <工程目录> [--require 标签] [--schedule "YYYY-MM-DD HH:mm"]'); process.exit(2); }

const md = readFileSync(mdPath, 'utf8').replace(/\r\n/g, '\n');
const clean = (s) => s.split('\n').map(l => l.replace(/\s+$/, '')).join('\n').trim();

// 按「## 一、xxx」切节，节名去掉序号
const sections = {};
md.split(/\n(?=## )/).forEach(chunk => {
  const m = chunk.match(/^## (?:[一二三四五六七八九十〇]+、)?(.+)\n/);
  if (m) sections[m[1].trim()] = chunk.slice(m[0].length).replace(/\n---\s*$/, '').trim();
});
const sec = (name) => {
  const k = Object.keys(sections).find(x => x.startsWith(name));
  return k ? sections[k] : null;
};
// 取 **标签：** 后到下一个 **xx：** 之前的内容
function field(text, label) {
  const re = new RegExp(`\\*\\*${label}：\\*\\*[^\\n]*\\n([\\s\\S]*?)(?=\\n\\*\\*[^*\\n]+：\\*\\*|$)`);
  const m = text.match(re);
  return m ? clean(m[1]) : null;
}
const hashTags = (line) => (line.match(/#[^\s#]+/g) || []).map(t => t.slice(1));
// 正文最后一行如果全是 #话题，拆出来
function splitTopics(body) {
  const lines = body.split('\n');
  const last = lines[lines.length - 1].trim();
  if (last && last.split(/\s+/).every(w => w.startsWith('#'))) return { body: clean(lines.slice(0, -1).join('\n')), topics: hashTags(last) };
  return { body, topics: [] };
}

const header = (k) => { const m = md.match(new RegExp(`^> ${k}：\\s*(.+?)\\s*$`, 'm')); return m ? m[1] : null; };
const title = (md.match(/^# (.+)$/m) || [])[1] || basename(dir);
const episode = +(header('序号') || 0) || undefined;

let schedule = scheduleArg || header('定时发布');
if (schedule && !/T/.test(schedule)) schedule = schedule.trim().replace(' ', 'T') + ':00+08:00';

// 工程目录里的文件
const files = [];
const walk = (d) => readdirSync(d).forEach(n => { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(relative(dir, p)); });
walk(dir);
const video = files.includes('成片.mp4') ? '成片.mp4' : null;
const covers = {};
for (const [k, n] of [['3x4', 'cover-3x4.png'], ['4x3', 'cover-4x3.png'], ['16x9', 'cover-16x9.jpg']]) if (files.includes(`封面/${n}`)) covers[k] = `封面/${n}`;
const has = (k) => !!covers[k];
const pick = (...ks) => ks.filter(has);

const platforms = {};
let s;
if ((s = sec('B站'))) platforms.bilibili = { covers: pick('4x3'), title: field(s, '标题'), desc: field(s, '简介'), tags: hashTags(field(s, '标签') || '') };
if ((s = sec('小红书'))) { const b = splitTopics(field(s, '正文') || ''); platforms.xhs = { covers: pick('3x4'), title: field(s, '标题'), body: b.body, topics: b.topics }; }
if ((s = sec('抖音'))) { const b = splitTopics(field(s, '正文') || ''); platforms.douyin = { covers: pick('4x3', '3x4'), title: field(s, '标题'), body: b.body, topics: b.topics }; }
if ((s = sec('视频号'))) { const b = splitTopics(field(s, '描述') || ''); platforms.channels = { covers: pick('4x3', '3x4'), shortTitle: field(s, '短标题'), body: b.body, topics: b.topics }; }
if ((s = sec('YouTube'))) platforms.youtube = { covers: pick('16x9'), title: field(s, '标题'), desc: field(s, '简介'), tags: (field(s, '标签') || '').split(/[,，]/).map(x => x.trim()).filter(Boolean) };
if ((s = sec('X'))) platforms.x = { covers: [], text: clean(s) };

const out = {
  version: 1,
  id: basename(dir),
  ...(episode ? { episode } : {}),
  name: title,
  source: mdPath.replace(/^.*?\/doc\//, ''),
  ...(files.includes('发布素材.md') ? { source_backup: '发布素材.md' } : {}),
  video,
  ...(files.includes('字幕.srt') ? { subtitle: '字幕.srt' } : {}),
  requiredTags: [require_],
  ...(schedule ? { schedule } : {}),
  covers,
  platforms,
};
// 重新生成时保留手动加的 skip（比如某平台已经发过）
const target = join(dir, 'publish.json');
if (existsSync(target)) {
  const old = JSON.parse(readFileSync(target, 'utf8'));
  for (const [k, p] of Object.entries(old.platforms || {})) if (p.skip && out.platforms[k]) out.platforms[k].skip = p.skip;
}
writeFileSync(target, JSON.stringify(out, null, 2) + '\n');

const { errors, warnings } = validate(out, new Set(files));
console.log(`已写入 ${target}`);
console.log(`平台：${Object.keys(platforms).join('、')}；封面：${Object.keys(covers).join(' / ')}；定时：${schedule || '无'}`);
warnings.forEach(w => console.log(`⚠️  ${w}`));
errors.forEach(e => console.log(`❌ ${e}`));
console.log(errors.length ? `校验未通过：${errors.length} 个问题` : '✅ 校验通过');
process.exit(errors.length ? 1 : 0);
