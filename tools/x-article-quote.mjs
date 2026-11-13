// 定时「长文 + 视频帖引用长文」：
//   node tools/x-article-quote.mjs --draft <长文编辑页 URL> --video <成片绝对路径> --text <视频帖文案 txt> --at <ISO 时间> [--prep 20] [--dry]
// 流程：at 前 prep 分钟打开发帖框、填文案、上传视频 → 到点发布长文 → 找到长文对应的帖子链接
//       → 贴到视频帖末尾（X 自动变成引用）→ 发出视频帖 → 核对主页。--dry 只做到「视频传完」，然后放弃草稿，不发布任何东西。
// 依赖：tools/bridge-server.mjs 在跑、插件侧边栏开着（开发桥接）。
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
// 发布中控目录（飞书通知、锁文件），没有就只打日志
const HUB = process.env.PUBLISH_HUB || join(homedir(), 'publish-hub');
import { call, evaluate } from './cdp.mjs';
import { insertText, pressKey } from './keys.mjs';
import { setFiles } from './setfiles.mjs';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split(/\s(?=--)/).map(s => { const [k, ...v] = s.replace(/^--/, '').split(' '); return [k, v.join(' ') || true]; }));
const DRY = !!args.dry, AT = new Date(args.at || Date.now()), PREP = +(args.prep || 20);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toLocaleTimeString('zh-CN', { hour12: false }), ...a);
let notify = async (t) => log('[通知]', t);
try { notify = (await import(join(HUB, 'src/feishu.mjs'))).notify; } catch {}
async function waitFor(T, expr, ms, step = 1000) { const end = Date.now() + ms; while (Date.now() < end) { try { if (await evaluate(T, expr)) return true; } catch {} await sleep(step); } return false; }
async function ensureBridge() {
  for (let i = 0; i < 6; i++) { try { await call({ op: 'ping' }); return; } catch { await sleep(10000); } }
  throw new Error('插件桥接没响应（侧边栏开着吗？）');
}
const text = readFileSync(args.text, 'utf8').trim();
const first = text.split('\n')[0].trim();

if (!DRY && Date.now() > +AT + 30 * 60000) { log('已过发布时间 30 分钟以上，不再执行（防止补跑发重）'); process.exit(0); }

try {
  await ensureBridge();
  const wait1 = AT - PREP * 60000 - Date.now();
  if (wait1 > 0) { log(`等到 ${new Date(AT - PREP * 60000).toLocaleString('zh-CN')} 开始准备`); await sleep(wait1); }
  await ensureBridge();

  // ② 发帖框：文案 + 视频
  const C = await call({ op: 'open', url: 'https://x.com/compose/post' });
  if (!await waitFor(C, `!!document.querySelector('[data-testid=tweetTextarea_0]') && !!document.querySelector('input[data-testid=fileInput]')`, 60000)) throw new Error('发帖框没打开');
  await evaluate(C, `document.querySelector('[data-testid=tweetTextarea_0]').focus()`);
  const lines = text.split('\n');
  for (const [i, l] of lines.entries()) { if (l) await insertText(C, l); if (i < lines.length - 1) await pressKey(C, 'Enter'); await sleep(60); }
  log(`文案已填：${text.length} 字`);
  await setFiles(C, 'input[data-testid=fileInput]', [args.video]);
  log('视频开始上传');
  await sleep(5000);
  const uploaded = await waitFor(C, `!/Uploading \\(\\d+%\\)|上传中/.test(document.body.innerText) && !!document.querySelector('[data-testid=attachments] video, [data-testid=attachments] [data-testid=videoPlayer], [data-testid=attachments] img')`, 30 * 60000, 5000);
  if (!uploaded) throw new Error('视频 30 分钟没传完');
  log('视频上传完成');

  if (DRY) {
    log('dry-run 发帖框内容：\n' + await evaluate(C, `document.querySelector('[data-testid=tweetTextarea_0]').innerText`));
    log('发帖按钮可点：', await waitFor(C, `!!document.querySelector('[data-testid=tweetButton]:not([aria-disabled=true])')`, 180000, 3000));
    log('dry-run：不发布，放弃草稿');
    await evaluate(C, `document.querySelector('[data-testid=app-bar-close]')?.click()`); await sleep(1500);
    await evaluate(C, `([...document.querySelectorAll('[data-testid=confirmationSheetCancel],[data-testid=confirmationSheetConfirm]')].find(b=>/Discard|放弃|不保存/.test(b.innerText))||document.querySelector('[data-testid=confirmationSheetCancel]'))?.click()`);
    await sleep(1500); await call({ op: 'close', tabIds: [C] }).catch(() => {});
    process.exit(0);
  }

  // 等到点
  const wait2 = AT - Date.now();
  if (wait2 > 0) { log(`等到 ${AT.toLocaleString('zh-CN')} 发布`); await sleep(wait2); }

  // ③ 发布长文（一次性锁：同一篇草稿只执行一次）
  const LOCK = join(HUB, 'state', `x-article-${args.draft.split('/').pop()}.lock`);
  const { existsSync, writeFileSync, mkdirSync } = await import('node:fs');
  if (existsSync(LOCK)) throw new Error(`锁文件已存在（${LOCK}），这篇长文之前已执行过发布，本次不再发`);
  mkdirSync(join(HUB, 'state'), { recursive: true }); writeFileSync(LOCK, new Date().toISOString());
  const A = await call({ op: 'open', url: args.draft });
  if (!await waitFor(A, `[...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='Publish')`, 60000)) throw new Error('长文编辑页没有 Publish 按钮');
  const title = await evaluate(A, `(document.querySelector('textarea[placeholder="Add a title"]')?.value||'').trim()`);
  await evaluate(A, `[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='Publish').at(-1).click()`);
  await sleep(2500);
  // 可能有确认弹窗
  await evaluate(A, `(()=>{const d=document.querySelector('[role=dialog]'); if(!d) return 0; const b=[...d.querySelectorAll('button')].find(b=>/^Publish$|^发布$/.test(b.innerText.trim())); if(b){b.click(); return 1} return 0})()`);
  if (!await waitFor(A, `!/\\/compose\\/articles\\/edit\\//.test(location.href)`, 60000)) throw new Error('点了 Publish，长文没跳出编辑页，可能没发出去');
  log('长文已发布：', await evaluate(A, 'location.href'));

  // 找长文对应的帖子
  const me = await evaluate(A, `document.querySelector('a[data-testid=AppTabBar_Profile_Link]')?.href || 'https://x.com/czzzzzzJ_'`);
  let status = null;
  for (let i = 0; i < 6 && !status; i++) {
    await evaluate(A, `(location.href = ${JSON.stringify(me)}, 1)`);
    await waitFor(A, `document.querySelectorAll('article').length > 0`, 30000); await sleep(3000);
    status = await evaluate(A, `(()=>{const key=${JSON.stringify((title || '').slice(0, 12))};
      for (const a of document.querySelectorAll('article')) { if (a.querySelector('[data-testid=socialContext]')?.innerText.match(/Pinned|置顶/)) continue;
        if (key && !a.innerText.includes(key)) continue; const t=a.querySelector('time'); if (t && Date.now()-new Date(t.getAttribute('datetime'))<15*60000) return t.parentElement.href; }
      return null})()`);
    if (!status) await sleep(10000);
  }
  if (!status) throw new Error('长文发出去了，但在主页上没找到它的帖子链接，视频帖未发');
  log('长文帖子：', status);
  await call({ op: 'close', tabIds: [A] }).catch(() => {});

  // ④ 视频帖末尾贴上长文帖子链接 → 引用；发出
  await call({ op: 'activate', tabId: C });
  await evaluate(C, `(()=>{const e=document.querySelector('[data-testid=tweetTextarea_0]'); e.focus(); const s=getSelection(); s.selectAllChildren(e); s.collapseToEnd();})()`);
  await pressKey(C, 'Enter'); await insertText(C, status);
  await sleep(4000);
  if (!await waitFor(C, `!!document.querySelector('[data-testid=tweetButton]:not([aria-disabled=true])')`, 20 * 60000, 5000)) throw new Error('发帖按钮 20 分钟都不可点（视频还在处理？）');
  await evaluate(C, `document.querySelector('[data-testid=tweetButton]').click()`);
  log('视频帖已点发送');
  await sleep(15000);

  // ⑤ 核对
  const V = await call({ op: 'open', url: me });
  await waitFor(V, `document.querySelectorAll('article').length > 0`, 30000); await sleep(4000);
  const posted = await evaluate(V, `(()=>{const key=${JSON.stringify(first.slice(0, 16))}; const hits=[...document.querySelectorAll('article')].filter(a=>(a.querySelector('[data-testid=tweetText]')?.innerText||'').includes(key)); return {n:hits.length, url:hits[0]?.querySelector('time')?.parentElement.href||''}})()`);
  await call({ op: 'close', tabIds: [V] }).catch(() => {});
  const msg = `X 第 4 期：长文 ${status}；视频帖 ${posted.url || '（主页上没找到，去看一眼）'}${posted.n > 1 ? `；⚠️ 视频帖出现了 ${posted.n} 条` : ''}`;
  log(msg); await notify(msg);
} catch (e) {
  log('❌', e.message); await notify(`X 第 4 期长文 + 视频帖出错：${e.message}`); process.exit(1);
}
