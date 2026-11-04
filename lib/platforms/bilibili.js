import { evaluate, setFiles, insertText, pressKey, sleep, waitFor, setValue, byText, click, fire } from '../cdp.js';
import { checkTitle } from './common.js';

const TITLE = `document.querySelector('input[placeholder="请输入稿件标题"]')`;
const TAG_INPUT = `document.querySelector('input[placeholder="按回车键Enter创建标签"]')`;
const TAGS = `[...document.querySelectorAll('.tag-pre-wrp .label-item-v2-content')].map(e=>e.innerText.trim())`;

// 主封面槽里出现了真图（不再是「添加主封面」的空位）
const COVER_SET = `(()=>{const e=document.querySelector('.cover-module-main .cover-empty'); return !e || !e.offsetParent})()`;
const IMG_INPUT = `[...document.querySelectorAll('input[type=file]')].find(i=>/image\\/png/.test(i.accept))`;
const CLOSE_MODAL = `(()=>{const m=[...document.querySelectorAll('*')].find(e=>e.childElementCount===0&&e.textContent.trim()==='封面制作'&&e.getClientRects().length);
  let p=m; for(let i=0;i<6&&p;i++){const x=p.querySelector('[class*=close]'); if(x){x.click(); return true} p=p.parentElement} return false})()`;

async function setCover(T, file) {
  const open = await evaluate(T, `!![...document.querySelectorAll('*')].find(e=>e.childElementCount===0&&e.textContent.trim()==='封面制作'&&e.getClientRects().length)`);
  if (!open) await evaluate(T, `document.querySelector('.cover-module-main .cover-empty, .cover-module-main .cover-slot').click()`);
  if (!await waitFor(T, `!!${IMG_INPUT}`, 15000)) throw new Error('封面弹窗没有打开');
  await sleep(1000);
  await evaluate(T, `(()=>{const c=document.querySelector('.operation .sync'); if(c && c.querySelector('input').value!=='true') c.querySelector('label.sync-checkbox').click(); return 1})()`);
  await sleep(500);
  await setFiles(T, IMG_INPUT, [file]);
  await sleep(4500);
  await click(T, byText('完成'));
  await sleep(2500);
}

// 定时发布：打开开关 → 日历里点日期（跨月就翻页）→ 时间面板点小时、分钟
const TC = '.time-container';
async function schedule(ctx) {
  const T = ctx.tabId, s = ctx.schedule;
  await evaluate(T, `(()=>{const w=document.querySelector('${TC} .switch-container'); if(!w.classList.contains('switch-container-active')) w.click(); return 1})()`);
  if (!await waitFor(T, `!!document.querySelector('${TC} .date-picker-date')`, 5000)) { ctx.fail('定时发布的开关没打开'); return; }
  const tz = await evaluate(T, `(document.querySelector('${TC} .bcc-select-input-inner')||{}).value||''`);
  if (!/UTC\+08:00/.test(tz)) ctx.note(`B 站定时的时区是「${tz}」，不是北京时间，请检查`);

  await fire(T, `document.querySelector('${TC} .date-picker-date')`); await sleep(500);
  const want = `${s.y}年${s.m}月`;
  for (let i = 0; i < 3; i++) {
    const title = await evaluate(T, `(document.querySelector('${TC} .date-picker-nav-title')||{}).textContent||''`);
    if (title.trim() === want) break;
    await fire(T, `document.querySelector('${TC} .next-btn-day')`); await sleep(400);
  }
  await fire(T, `[...document.querySelectorAll('${TC} .date-wrp .date-item, ${TC} .date-wrp .date-item-selected')].find(e=>e.textContent.trim()==='${s.d}')`);
  await sleep(500);

  await fire(T, `document.querySelector('${TC} .date-picker-timer')`); await sleep(500);
  const col = (i, v) => `[...(document.querySelectorAll('${TC} .time-picker-panel-select-wrp')[${i}]||{children:[]}).children].find(e=>e.textContent.trim()==='${String(v).padStart(2, '0')}')`;
  await fire(T, col(0, s.hh)); await sleep(400);
  await fire(T, col(1, s.mm)); await sleep(400);
  await fire(T, `document.querySelector('${TC} .date-picker-timer')`); await sleep(400);   // 收起时间面板

  const got = await evaluate(T, `[...document.querySelectorAll('${TC} .date-show')].map(e=>e.textContent.trim()).join(' ')`);
  if (got === s.text) ctx.log(`定时发布：${got}`);
  else ctx.fail(`定时没设对：页面上是「${got}」，应该是「${s.text}」`);
}

export default {
  id: 'bilibili',
  name: 'B 站',
  url: 'https://member.bilibili.com/platform/upload/video/frame',
  ready: `!!document.querySelector('.bcc-upload-wrapper input[type=file]')`,

  async fill(ctx) {
    const { tabId: T, p } = ctx;
    await setFiles(T, `document.querySelector('.bcc-upload-wrapper input[type=file]')`, [ctx.video]);
    ctx.log('视频开始上传');
    if (!await waitFor(T, `!!${TITLE}`, 30000)) throw new Error('上传后没有出现稿件表单');
    await sleep(1500);

    // 封面：B 站的封面编辑器要渲染画布，后台标签页里做不成，切到前台做，做完回读确认
    const cover = ctx.cover('4x3');
    if (cover) {
      await ctx.withFocus(async () => {
        for (let attempt = 1; attempt <= 2; attempt++) {
          await setCover(T, cover);
          if (await evaluate(T, COVER_SET)) { ctx.log('封面：4:3（16:9 同步）'); return; }
          await evaluate(T, CLOSE_MODAL); await sleep(800);
        }
        ctx.fail('封面没设上，请手动上传 4:3 封面');
      });
    }

    await setValue(T, TITLE, p.title);
    await sleep(300);
    await checkTitle(ctx, `${TITLE}.value`, p.title);

    const desc = await evaluate(T, `(()=>{const ed=[...document.querySelectorAll('.ql-editor')].find(e=>(e.dataset.placeholder||'').startsWith('填写更全面'));
      const q=ed && ed.closest('.ql-container').__quill; if(!q) return null; q.setText(${JSON.stringify(p.desc)}); return ed.innerText.length})()`);
    if (desc == null) ctx.fail('简介编辑器没找到，简介没有填');
    else ctx.log(`简介：${p.desc.length} 字`);

    // 标签：先删掉自动生成的，再逐个输入；被拒收的（比如和活动标签冲突）直接跳过
    for (let i = 0; i < 12; i++) {
      const n = await evaluate(T, `(()=>{const c=document.querySelector('.tag-pre-wrp .label-item-v2-container svg.close'); if(!c) return 0; c.dispatchEvent(new MouseEvent('click',{bubbles:true})); return 1})()`);
      if (!n) break; await sleep(300);
    }
    const skipped = [];
    for (const t of p.tags || []) {
      const before = (await evaluate(T, TAGS)).length;
      await evaluate(T, `${TAG_INPUT}.focus()`);
      await insertText(T, t); await sleep(500);
      await pressKey(T, 'Enter'); await sleep(900);
      const after = await evaluate(T, TAGS);
      if (after.length <= before) {
        skipped.push(t);
        await setValue(T, TAG_INPUT, '');
      }
    }
    const got = await evaluate(T, TAGS);
    ctx.log(`标签：${got.join('、')}`);
    if (skipped.length) ctx.note(`B 站拒收、已跳过的标签：${skipped.join('、')}`);
    if (ctx.schedule) await schedule(ctx);
    ctx.note('还需要你选「创作声明」（必填）');
  },

  uploadDone: `document.body.innerText.includes('上传完成')`,
};
