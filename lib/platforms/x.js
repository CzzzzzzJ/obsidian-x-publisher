import { evaluate, setFiles, sleep, waitFor, focusEnd, typeLines } from '../cdp.js';

const BOX = `document.querySelector('[data-testid=tweetTextarea_0]')`;

// 定时：发帖框的日历按钮 → 月、日、年、时（24 小时）、分五个下拉框 → Confirm
async function schedule(ctx) {
  const T = ctx.tabId, s = ctx.schedule;
  if (!await evaluate(T, `(()=>{const b=document.querySelector('[data-testid=scheduleOption]'); if(!b) return false; b.click(); return true})()`)) { ctx.fail('找不到定时按钮'); return; }
  if (!await waitFor(T, `document.querySelectorAll('[role=dialog] select').length>=5`, 15000)) { ctx.fail('定时弹窗没打开'); return; }
  await sleep(500);
  await evaluate(T, `(()=>{const v=['${s.m}','${s.d}','${s.y}','${s.hh}','${s.mm}']; const ss=[...document.querySelectorAll('[role=dialog] select')].slice(0,5);
    const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
    ss.forEach((el,i)=>{set.call(el,v[i]); el.dispatchEvent(new Event('change',{bubbles:true}));}); return 1})()`);
  await sleep(500);
  await evaluate(T, `document.querySelector('[data-testid=scheduledConfirmationPrimaryAction]').click()`);
  await sleep(1500);
  const got = await evaluate(T, `([...document.querySelectorAll('*')].find(e=>e.childElementCount===0&&/Will send on/.test(e.textContent))||{}).textContent||''`);
  if (got) ctx.log(`定时发布：${got.trim()}`);
  else ctx.fail('定时没设上，请在发帖框里手动设置');
}

export default {
  id: 'x',
  name: 'X',
  url: 'https://x.com/compose/post',
  ready: `!!document.querySelector('[data-testid=tweetTextarea_0]') && !!document.querySelector('input[data-testid=fileInput]')`,

  async fill(ctx) {
    const { tabId: T, p } = ctx;
    await focusEnd(T, BOX);
    await typeLines(T, p.text);
    ctx.log(`正文：${p.text.length} 字`);
    await setFiles(T, `document.querySelector('input[data-testid=fileInput]')`, [ctx.video]);
    ctx.log('视频开始上传');
    await sleep(3000);
    if (ctx.schedule) await schedule(ctx);
    ctx.note('不要关掉发帖框，关掉会丢失');
  },

  uploadDone: `!/Uploading \\(\\d+%\\)/.test(document.body.innerText)`,
};
