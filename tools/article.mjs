// node tools/article.mjs <笔记.md> <长文编辑页 tabId> [每张图后的等待秒数，默认 8]
// 不经过侧边栏的文件夹授权，直接把一篇 Obsidian 笔记写进已打开的 X 长文草稿（x.com/compose/articles/edit/...）。
// 用的是和侧边栏同一套解析（lib/md.js）和编辑器引擎（lib/engine.js），图片引用按笔记所在目录解析。
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, basename, extname } from 'node:path';
import { parseNote } from '../lib/md.js';
import { xEngine } from '../lib/engine.js';
import { evaluate } from './cdp.mjs';

const [mdPath, tabArg, settleArg] = process.argv.slice(2);
if (!mdPath || !tabArg) { console.error('用法：node tools/article.mjs <笔记.md> <tabId> [settle秒]'); process.exit(2); }
const tabId = +tabArg, settle = (+settleArg || 8) * 1000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const exec = (cmd, arg = null) => evaluate(tabId, `(${xEngine.toString()})(${JSON.stringify(cmd)}, ${JSON.stringify(arg)})`, 120000);
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
function loadImage(ref) {
  const p = [join(dirname(mdPath), ref), ref].find(existsSync);
  if (!p) return null;
  const buf = readFileSync(p);
  return { b64: buf.toString('base64'), name: basename(p), mime: MIME[extname(p).toLowerCase()] || 'image/png', size: buf.length };
}
async function waitFor(check, timeoutMs, intervalMs = 1000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const st = await exec('state'); if (check(st)) return st; await sleep(intervalMs); }
  return null;
}

const parsed = parseNote(readFileSync(mdPath, 'utf8'));
let st = await exec('state');
if (!st || !st.composer || !st.draftOk) throw new Error('长文编辑页没就绪');
if (st.textBlocks > 0) throw new Error(`草稿里已有 ${st.textBlocks} 段内容，请换一篇空草稿`);
const startImgs = st.imgs;
console.log(`标题：${parsed.title}`);
if (parsed.title) await exec('setTitle', parsed.title);

const cover = parsed.coverRef && loadImage(parsed.coverRef);
if (cover) {
  await exec('setCover', cover); await sleep(1500);
  const s = await waitFor(x => x.hasCover || x.dialogs > 0, 20000);
  if (s && s.dialogs > 0) { await exec('applyDialog'); await sleep(1500); }
  console.log((await waitFor(x => x.hasCover && !x.busy, 30000)) ? `封面 ✓ ${cover.name}` : '封面可能没传上');
}

for (const [i, seg] of parsed.segments.entries()) {
  const tag = `[${i + 1}/${parsed.segments.length}]`;
  const img = seg.type === 'image' && loadImage(seg.ref);
  if (img) {
    let ok = false;
    for (let a = 1; a <= 2 && !ok; a++) {
      const before = (await exec('state')).imgs;
      await exec('pasteImage', img);
      ok = !!(await waitFor(x => x.imgs > before && !x.busy, 60000));
    }
    if (!ok) throw new Error(`图片插入失败：${seg.ref}`);
    console.log(`${tag} 🖼 ${img.name}`);
    await sleep(settle);
  } else {
    const html = seg.type === 'html' ? seg.html : `<p><strong>【缺图：${seg.ref}】</strong></p>`;
    const b0 = await exec('state');
    await exec('pasteHTML', html);
    const s = await waitFor(x => x.blocks !== b0.blocks || x.imgs < b0.imgs, 10000, 500);
    if (s && (s.blocks < b0.blocks || s.imgs < b0.imgs)) { await exec('undo'); throw new Error(`粘贴覆盖了已有内容（已撤销）：${seg.texts?.[0]?.t}`); }
    if (!s) throw new Error(`文字写入失败：${seg.texts?.[0]?.t || seg.ref}`);
    await sleep(800);
    console.log(`${tag} 📝 ${(seg.texts?.[0]?.t || '').slice(0, 20)}`);
  }
}
const c = await exec('cleanup');
console.log(`清理：${c.stripped} 个占位字符、${c.removed} 个空段落`);
st = await exec('state');
const expect = parsed.segments.filter(s => s.type === 'image' && loadImage(s.ref)).length;
console.log(`图片：应插 ${expect} 张，实际 ${st.imgs - startImgs} 张；正文 ${st.textBlocks} 段`);
