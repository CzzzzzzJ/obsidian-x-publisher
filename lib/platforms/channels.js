import { evaluate, setFiles, sleep, waitFor, insertText, focusEnd, typeLines, pressKey, click, byText, fire } from '../cdp.js';
import { checkTitle } from './common.js';

// 视频号助手的表单在 wujie 微前端的 Shadow DOM 里
const R = `document.querySelector('wujie-app').shadowRoot`;
const SHORT = `${R}.querySelector('input[placeholder="填写短标题有机会获得更多流量"]')`;
const EDITOR = `${R}.querySelector('.input-editor')`;
const IMG = `[...${R}.querySelectorAll('input[type=file]')].find(i=>/image/.test(i.accept))`;

// 定时发表：选「定时」→ 点开日期框 → 日历里点日期（跨月翻页）→ 时、分两列各点一下
async function schedule(ctx) {
  const T = ctx.tabId, s = ctx.schedule;
  const W = `${R}.querySelector('.post-time-wrap')`;
  const INPUTS = `[...${W}.querySelectorAll('input[type=text]')].map(i=>i.value)`;
  await evaluate(T, `(()=>{const l=[...${W}.querySelectorAll('label')].find(l=>l.textContent.trim()==='定时'); l && l.click(); return 1})()`);
  if (!await waitFor(T, `!!${W}.querySelector('input[placeholder="请选择发表时间"]')`, 5000)) { ctx.fail('找不到定时发表的时间框'); return; }
  await evaluate(T, `${W}.querySelector('input[placeholder="请选择发表时间"]').focus()`);
  await fire(T, `${W}.querySelector('input[placeholder="请选择发表时间"]')`); await sleep(600);
  const want = `${s.y}年${s.m}月`;
  for (let i = 0; i < 3; i++) {
    const title = await evaluate(T, `[...${W}.querySelectorAll('.weui-desktop-picker__panel__label')].map(e=>e.textContent.trim()).join('')`);
    if (title === want) break;
    await fire(T, `${W}.querySelector('.weui-desktop-picker__panel__hd .weui-desktop-btn__icon__right')`); await sleep(400);
  }
  await fire(T, `[...${W}.querySelectorAll('.weui-desktop-picker__table a')].find(a=>a.textContent.trim()==='${s.d}' && !/faded|disabled/.test(a.className))`);
  await sleep(500);
  await fire(T, `${W}.querySelector('input[placeholder="请选择时间"]')`); await sleep(500);
  const pick = (cls, v) => fire(T, `[...${W}.querySelectorAll('.weui-desktop-picker__time__${cls} li')].find(l=>l.textContent.trim()==='${String(v).padStart(2, '0')}')`);
  await pick('hour', s.hh); await sleep(300);
  await pick('minute', s.mm); await sleep(500);
  await fire(T, `${W}.querySelector('.label')`); await sleep(300);   // 点别处收起面板
  const got = (await evaluate(T, INPUTS))[0];
  if (got === s.text) ctx.log(`定时发表：${got}`);
  else ctx.fail(`定时没设对：页面上是「${got}」，应该是「${s.text}」`);
}

export default {
  id: 'channels',
  name: '视频号',
  url: 'https://channels.weixin.qq.com/platform/post/create',
  ready: `!!(document.querySelector('wujie-app')?.shadowRoot?.querySelector('input[type=file][accept^=video]'))`,

  async fill(ctx) {
    const { tabId: T, p } = ctx;
    await setFiles(T, `${R}.querySelector('input[type=file][accept^=video]')`, [ctx.video]);
    ctx.log('视频开始上传');
    if (!await waitFor(T, `!!${SHORT} && !!${EDITOR}`, 30000)) throw new Error('上传后没有出现表单');
    await sleep(1500);

    await evaluate(T, `${SHORT}.focus()`);
    await insertText(T, p.shortTitle);
    await sleep(300);
    await checkTitle(ctx, `${SHORT}.value`, p.shortTitle, '短标题');

    await focusEnd(T, EDITOR);
    await typeLines(T, p.body);
    // 话题直接输入「#话题 」就会高亮，不用选联想
    if (p.topics && p.topics.length) {
      await pressKey(T, 'Enter');
      for (const t of p.topics) { await insertText(T, '#' + t + ' '); await sleep(400); }
      const got = await evaluate(T, `[...${EDITOR}.querySelectorAll('.topic, [class*=topic]')].map(e=>e.innerText.trim())`);
      ctx.log(`话题：${got.join(' ')}`);
    }
    ctx.log(`描述：${p.body.length} 字`);
    if (ctx.schedule) await schedule(ctx);
    ctx.note('封面要等视频上传完才能设置，传完会自动补上');
  },

  uploadDone: `!${R}.textContent.includes('取消上传')`,

  // 视频传完后：个人主页卡片 3:4、分享卡片 4:3
  async afterUpload(ctx) {
    const T = ctx.tabId;
    const set = async (wrap, file, label) => {
      if (!await click(T, `${R}.querySelector('${wrap} .edit-btn')`)) throw new Error(`找不到${label}的「编辑」`);
      await sleep(1500);
      await click(T, byText('直接编辑', R));        // 分享卡片会先问「使用此素材作为封面？」
      if (!await waitFor(T, `!!${IMG}`, 15000)) throw new Error(`${label}编辑框没有打开`);
      await sleep(800);
      await setFiles(T, IMG, [file]);
      await sleep(3500);
      if (!await click(T, byText('确认', R))) throw new Error(`${label}编辑框里找不到「确认」`);
      await sleep(2000);
      ctx.log(`${label}：已设置`);
    };
    const v = ctx.cover('3x4'), h = ctx.cover('4x3');
    if (v) await set('.vertical-cover-wrap', v, '个人主页卡片 3:4');
    if (h) await set('.horizon-cover-wrap', h, '分享卡片 4:3');
  },
};
