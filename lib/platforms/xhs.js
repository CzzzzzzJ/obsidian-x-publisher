import { evaluate, setFiles, sleep, waitFor, setValue, focusEnd, typeLines, pressKey, hover, click, byText, fire, insertText } from '../cdp.js';
import { pickTopics, checkTitle } from './common.js';

const TITLE = `document.querySelector('input[placeholder="填写标题会有更多赞哦"]')`;
const EDITOR = `document.querySelector('.tiptap.ProseMirror')`;

// 定时发布：打开开关，在日期框里直接输入「2026-11-05 18:00」
async function schedule(ctx) {
  const T = ctx.tabId, s = ctx.schedule;
  const SW = `document.querySelector('.post-time-switch-container .d-switch-simulator')`;
  const IN = `document.querySelector('.post-time-wrapper .d-datepicker-input-filter input')`;
  if (!await evaluate(T, `!!${SW}`)) { ctx.fail('找不到定时发布开关'); return; }
  if (!await evaluate(T, `${SW}.classList.contains('checked')`)) await fire(T, SW);
  if (!await waitFor(T, `!!${IN}`, 5000)) { ctx.fail('定时发布的时间框没出现'); return; }
  await evaluate(T, `(()=>{const i=${IN}; i.focus(); i.select(); return 1})()`);
  await insertText(T, s.text); await sleep(400);
  await pressKey(T, 'Enter'); await sleep(500);
  await evaluate(T, `${IN}.blur()`); await sleep(500);
  const got = await evaluate(T, `${IN}.value`);
  if (got === s.text) ctx.log(`定时发布：${got}`);
  else ctx.fail(`定时没设对：页面上是「${got}」，应该是「${s.text}」`);
}

export default {
  id: 'xhs',
  name: '小红书',
  url: 'https://creator.xiaohongshu.com/publish/publish?source=official&target=video',
  ready: `!!document.querySelector('input[type=file]')`,

  async fill(ctx) {
    const { tabId: T, p } = ctx;
    await setFiles(T, `document.querySelector('input[type=file]')`, [ctx.video]);
    ctx.log('视频开始上传');
    if (!await waitFor(T, `!!${TITLE}`, 30000)) throw new Error('上传后没有出现笔记表单');
    await sleep(1500);
    await click(T, byText('我知道了'));   // 「PK 封面」引导弹窗，有就关掉

    await setValue(T, TITLE, p.title);
    await sleep(300);
    await checkTitle(ctx, `${TITLE}.value`, p.title);

    await focusEnd(T, EDITOR);
    await typeLines(T, p.body);
    if (p.topics && p.topics.length) {
      await pressKey(T, 'Enter'); await pressKey(T, 'Enter');
      const picked = await pickTopics(ctx, p.topics, `[...document.querySelectorAll('.item')]`);
      ctx.log(`话题：${picked.join('、') || '无'}`);
    }
    const len = await evaluate(T, `${EDITOR}.innerText.length`);
    ctx.log(`正文：${p.body.length} 字（编辑器 ${len}）`);
    if (ctx.schedule) await schedule(ctx);
    ctx.note('封面要等视频上传完才能设置，传完会自动补上');
  },

  uploadDone: `(()=>{const t=document.body.innerText; return !t.includes('上传中') && !t.includes('取消上传') && !!document.querySelector('.cover .default')})()`,

  // 视频传完后：悬停封面 → 编辑封面 → 上传 3:4 → 裁剪比例改成 3:4 → 完成
  async afterUpload(ctx) {
    const T = ctx.tabId;
    const cover = ctx.cover('3x4');
    if (!cover) return;
    await hover(T, `document.querySelector('.cover .default')`);
    await sleep(600);
    if (!await click(T, `document.querySelector('.cover-edit-entry-text')`)) throw new Error('找不到「编辑封面」');
    const IMG = `[...document.querySelectorAll('input[type=file]')].find(i=>/image/.test(i.accept))`;
    if (!await waitFor(T, `!!${IMG}`, 20000)) throw new Error('封面编辑器没有打开');
    await sleep(1500);
    await setFiles(T, IMG, [cover]);
    await sleep(3500);
    await click(T, byText('裁剪')); await sleep(1000);
    await click(T, `(${byText('3:4')})?.parentElement`); await sleep(1200);
    if (!await click(T, byText('完成'))) throw new Error('封面编辑器里找不到「完成」');
    await sleep(2500);
    const ok = await evaluate(T, `document.body.innerText.includes('封面效果评估通过')`);
    ctx.log(`封面：3:4${ok ? '（平台评估通过）' : ''}`);
  },

  // 发布后回传链接：笔记管理页的卡片里埋着笔记 ID
  links: {
    url: 'https://creator.xiaohongshu.com/new/note-manager',
    ready: `document.querySelectorAll('.note-card').length > 0`,
    async collect(T, p) {
      const c = await evaluate(T, `(()=>{const c=[...document.querySelectorAll('.note-card')].find(c=>((c.querySelector('.note-card__title')||{}).innerText||'').trim()===${JSON.stringify(p.title)});
        if(!c) return null; let id=''; try{id=JSON.parse(c.getAttribute('data-impression')).noteTarget.value.noteId}catch(e){}
        return {id, text:c.innerText}})()`);
      if (!c || !c.id) return null;
      const time = (c.text.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/) || [''])[0];
      return { status: /定时发布/.test(c.text) ? '定时' : /审核/.test(c.text) ? '审核中' : '已发布', url: `https://www.xiaohongshu.com/explore/${c.id}`, time };
    },
  },
};
