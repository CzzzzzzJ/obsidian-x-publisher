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
    ss.forEach((el,i)=>{set.call(el,v[i]); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));}); return 1})()`);
  // 回读下拉框，没设上就报异常（2026-11-12 出现过小时/分钟没生效、停在默认时间）
  const vals = await evaluate(T, `[...document.querySelectorAll('[role=dialog] select')].slice(0,5).map(s=>s.value).join(',')`);
  // 按数字比：页面上分钟是「0」，期望值可能写成「00」（2026-11-12 第 37 期因此误报）
  const want = [s.m, s.d, s.y, s.hh, s.mm].map(Number).join(',');
  if (vals.split(',').map(Number).join(',') !== want) { ctx.fail(`定时下拉框没设上：页面 ${vals}，应为 ${want}`); return; }
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

  // 发布后回传链接：先看主页有没有发出来，没有再看定时列表
  links: {
    url: 'https://x.com/home',
    ready: `!!document.querySelector('a[data-testid=AppTabBar_Profile_Link]')`,
    async collect(T, p) {
      const first = p.text.split('\n')[0].trim();
      const me = await evaluate(T, `document.querySelector('a[data-testid=AppTabBar_Profile_Link]').href`);
      await evaluate(T, `(location.href = ${JSON.stringify(me)}, 1)`);
      if (await waitFor(T, `document.querySelectorAll('article [data-testid=tweetText]').length > 0`, 20000)) {
        await sleep(1500);
        const hit = await evaluate(T, `(()=>{const a=[...document.querySelectorAll('article')].find(a=>((a.querySelector('[data-testid=tweetText]')||{}).innerText||'').trim().startsWith(${JSON.stringify(first)}));
          if(!a) return null; const t=a.querySelector('time'); return {url:t&&t.parentElement.href, time:t&&t.getAttribute('datetime')}})()`);
        if (hit && hit.url) return { status: '已发布', url: hit.url, time: hit.time };
      }
      await evaluate(T, `(location.href = 'https://x.com/compose/post/unsent/scheduled', 1)`);
      if (!await waitFor(T, `[...document.querySelectorAll('[role=dialog]')].some(d=>/Scheduled|定时/.test(d.innerText))`, 20000)) return null;
      await sleep(1500);
      const s = await evaluate(T, `(()=>{const d=[...document.querySelectorAll('[role=dialog]')].map(d=>d.innerText).find(t=>t.includes(${JSON.stringify(first)})); if(!d) return null; const m=d.match(/Will send on ([^\\n]+)/); return m?m[1]:''})()`);
      if (s === null) return null;
      return { status: '定时', url: '', time: s, note: '发出后再回填一次就能拿到链接' };
    },
  },
};
