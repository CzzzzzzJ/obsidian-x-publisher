import { evaluate, setFiles, sleep, waitFor, insertText, pressKey, typeLines, focusSelectAll, setValue } from '../cdp.js';
import { checkTitle } from './common.js';

const BOX = (i) => `[...document.querySelectorAll('#textbox[contenteditable]')][${i}]`;
const TAG_INPUT = `document.querySelector('input[aria-label="标签"], input[aria-label="Tags"]')`;

// 定时发布在最后一步「公开范围」里；要先回答「是否面向儿童」才能往后走
async function schedule(ctx) {
  const T = ctx.tabId, s = ctx.schedule;
  await evaluate(T, `(()=>{const r=document.querySelector('tp-yt-paper-radio-button[name=VIDEO_MADE_FOR_KIDS_NOT_MFK]'); if(r && r.getAttribute('aria-checked')!=='true') r.click(); return 1})()`);
  ctx.note('已选「不，内容不是面向儿童的」（定时发布要先回答这一项），如果不对请改');
  await sleep(800);
  await evaluate(T, `document.querySelector('button[test-id=REVIEW]').click()`);
  if (!await waitFor(T, `!!document.querySelector('#second-container-expand-button')`, 10000)) { ctx.fail('没进到「公开范围」这一步'); return; }
  await sleep(800);
  if (!await evaluate(T, `!!document.querySelector('#datepicker-trigger')`)) await evaluate(T, `document.querySelector('#second-container-expand-button').click()`);
  if (!await waitFor(T, `!!document.querySelector('#datepicker-trigger')`, 5000)) { ctx.fail('「安排时间」没有展开'); return; }
  await sleep(600);
  const tz = await evaluate(T, `[...document.querySelectorAll('ytcp-visibility-scheduler *')].filter(e=>e.childElementCount===0&&/GMT|UTC/.test(e.textContent)).map(e=>e.textContent.trim())[0]||''`);
  if (tz && !/\+0?8:?00/.test(tz)) ctx.note(`YouTube 时区是「${tz}」，不是北京时间，请检查`);

  const dateText = `${s.y}年${s.m}月${s.d}日`;
  if ((await evaluate(T, `document.querySelector('#datepicker-trigger').innerText.trim()`)) !== dateText) {
    await evaluate(T, `document.querySelector('#datepicker-trigger').click()`); await sleep(1000);
    const DI = `[...document.querySelectorAll('ytcp-date-picker input, tp-yt-paper-dialog input')].find(i=>i.getClientRects().length && /年/.test(i.value))`;
    await evaluate(T, `(()=>{const i=${DI}; i.focus(); i.select(); return 1})()`);
    await insertText(T, dateText); await sleep(300);
    await pressKey(T, 'Enter'); await sleep(600);
    await pressKey(T, 'Escape'); await sleep(400);
  }
  const TI = `document.querySelector('ytcp-visibility-scheduler input, ytcp-datetime-picker input')`;
  await evaluate(T, `(()=>{const i=${TI}; i.focus(); i.select(); return 1})()`);
  await insertText(T, s.hm); await sleep(300);
  await pressKey(T, 'Enter'); await sleep(600);
  const got = await evaluate(T, `document.querySelector('#datepicker-trigger').innerText.trim()+' '+${TI}.value`);
  if (got === `${dateText} ${s.hm}`) ctx.log(`定时发布：${got}`);
  else ctx.fail(`定时没设对：页面上是「${got}」，应该是「${dateText} ${s.hm}」`);
}

export default {
  id: 'youtube',
  name: 'YouTube',
  url: 'https://www.youtube.com/upload',
  ready: `!!document.querySelector('input[type=file][name=Filedata]')`,

  async fill(ctx) {
    const { tabId: T, p } = ctx;
    await setFiles(T, `document.querySelector('input[type=file][name=Filedata]')`, [ctx.video]);
    ctx.log('视频开始上传（默认私享）');
    if (!await waitFor(T, `document.querySelectorAll('#textbox[contenteditable]').length>=2`, 30000)) throw new Error('上传后没有出现详细信息表单');
    await sleep(2000);

    await focusSelectAll(T, BOX(0));
    await insertText(T, p.title);
    await sleep(500);
    await checkTitle(ctx, `${BOX(0)}.innerText`, p.title);

    // 说明框在后台标签页里不认回车键：直接插入带换行符的整段文字，再回读核对行数
    await focusSelectAll(T, BOX(1));
    await insertText(T, p.desc);
    await sleep(500);
    const lines = await evaluate(T, `${BOX(1)}.innerText.split('\\n').length`);
    if (lines < p.desc.split('\n').length) ctx.fail(`说明的换行没保留（页面 ${lines} 行，应为 ${p.desc.split('\n').length} 行）`);
    else ctx.log(`说明：${p.desc.length} 字`);

    const thumb = ctx.cover('16x9');
    if (thumb) {
      await setFiles(T, `[...document.querySelectorAll('input[type=file]')].find(i=>/image/.test(i.accept))`, [thumb]);
      await sleep(3000);
      ctx.log('缩略图：16:9');
    }

    if (p.tags && p.tags.length) {
      await evaluate(T, `(()=>{const b=document.querySelector('#toggle-button'); if(b && !${TAG_INPUT}) b.click(); return 1})()`);
      if (!await waitFor(T, `!!${TAG_INPUT}`, 8000)) ctx.fail('找不到标签输入框，标签没有填');
      else {
        await setValue(T, TAG_INPUT, '');
        await evaluate(T, `${TAG_INPUT}.focus()`);
        for (const t of p.tags) { await insertText(T, t); await sleep(200); await pressKey(T, 'Enter'); await sleep(300); }
        ctx.log(`标签：${p.tags.join('、')}`);
      }
    }
    if (ctx.schedule) await schedule(ctx);
    else ctx.note('还需要你选「是否面向儿童」（必填）和公开范围');
  },

  uploadDone: `(()=>{const t=(document.querySelector('ytcp-video-upload-progress')||{}).innerText||''; return /上传完毕|Upload complete|处理|Processing|检查完毕|Checks complete/.test(t) && !/正在上传|Uploading/.test(t)})()`,
};
