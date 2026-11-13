import { evaluate, setFiles, sleep, waitFor, insertText, focusEnd, typeLines, pressKey, click, byText, firstByText } from '../cdp.js';
import { pickTopics, checkTitle } from './common.js';

const TITLE = `document.querySelector('input[placeholder="填写作品标题，为作品获得更多流量"]')`;
const EDITOR = `document.querySelector('.editor-kit-container[contenteditable=true]')`;
// 封面弹窗里「上传封面」那个输入框（同一弹窗里还有「生成参考图」的输入框，别传错）
const COVER_INPUT = `[...document.querySelectorAll('input.semi-upload-hidden-input')].find(i=>{let p=i;for(let k=0;k<4;k++)p=p.parentElement;return p.innerText.includes('上传封面')})`;

// 定时发布：选「定时发布」，在日期框里直接输入「2026-11-05 18:00」，Esc 收起日历
async function schedule(ctx) {
  const T = ctx.tabId, s = ctx.schedule;
  const IN = `document.querySelector('[class*=schedule-part] input.semi-input')`;
  const ok = await evaluate(T, `(()=>{const l=[...document.querySelectorAll('[class*=schedule-part] label')].find(l=>l.textContent.includes('定时发布')); if(!l) return false; l.click(); return true})()`);
  if (!ok || !await waitFor(T, `!!${IN}`, 5000)) { ctx.fail('找不到定时发布的选项'); return; }
  await evaluate(T, `(()=>{const i=${IN}; i.focus(); i.select(); return 1})()`);
  await insertText(T, s.text); await sleep(500);
  await pressKey(T, 'Enter'); await sleep(400);
  await pressKey(T, 'Escape'); await sleep(400);
  await evaluate(T, `${IN}.blur()`); await sleep(400);
  const got = await evaluate(T, `${IN}.value`);
  if (got === s.text) ctx.log(`定时发布：${got}`);
  else ctx.fail(`定时没设对：页面上是「${got}」，应该是「${s.text}」`);
}

export default {
  id: 'douyin',
  name: '抖音',
  url: 'https://creator.douyin.com/creator-micro/content/upload',
  ready: `!!document.querySelector('input[type=file]')`,

  async fill(ctx) {
    const { tabId: T, p } = ctx;
    await setFiles(T, `document.querySelector('input[type=file]')`, [ctx.video]);
    ctx.log('视频开始上传');
    if (!await waitFor(T, `!!${TITLE}`, 30000)) throw new Error('上传后没有出现作品表单');
    await sleep(1500);

    await evaluate(T, `${TITLE}.focus()`);
    await insertText(T, p.title);
    await sleep(300);
    await checkTitle(ctx, `${TITLE}.value`, p.title);

    await focusEnd(T, EDITOR);
    await typeLines(T, p.body);
    if (p.topics && p.topics.length) {
      await pressKey(T, 'Enter');
      // 联想下拉里每一项是 [class*=tag-hash]；外层 item-container 包着全部项，不能点它
      const picked = await pickTopics(ctx, p.topics, `[...document.querySelectorAll('[class*=mention-suggest] [class*=tag-hash]')]`, { realClick: true });
      ctx.log(`话题：${picked.join('、') || '无'}`);
    }
    ctx.log(`简介：${p.body.length} 字`);

    // 封面：横 4:3、竖 3:4 在同一个弹窗的两个页签里
    const h = ctx.cover('4x3'), v = ctx.cover('3x4');
    if (h || v) {
      if (!await click(T, firstByText('选择封面'))) throw new Error('找不到「选择封面」');
      if (!await waitFor(T, `!!${COVER_INPUT}`, 15000)) throw new Error('封面弹窗没有打开');
      await sleep(1500);
      if (h) { await setFiles(T, COVER_INPUT, [h]); await sleep(3000); ctx.log('横封面：4:3'); }
      if (v) {
        await click(T, firstByText('设置竖封面')); await sleep(2000);
        await setFiles(T, COVER_INPUT, [v]); await sleep(3000); ctx.log('竖封面：3:4');
      }
      if (!await click(T, byText('完成'))) throw new Error('封面弹窗里找不到「完成」');
      await sleep(2000);
    }
    if (ctx.schedule) await schedule(ctx);
  },

  uploadDone: `!document.body.innerText.includes('上传过程中')`,

  // 发布后回传链接：作品管理页的 React 数据里有作品 ID 和发布时间
  links: {
    url: 'https://creator.douyin.com/creator-micro/content/manage',
    ready: `document.querySelectorAll('[class*=video-card-info]').length > 0`,
    async collect(T, p) {
      const a = await evaluate(T, `(()=>{const out=[];
        for (const c of document.querySelectorAll('[class*=video-card-info]')) {
          const k=Object.keys(c).find(k=>k.startsWith('__reactFiber')); let f=c[k];
          for (let i=0;i<25&&f;i++,f=f.return){ const pr=f.memoizedProps; if(!pr) continue;
            const v=Object.values(pr).find(v=>v&&typeof v==='object'&&v.aweme_id&&v.desc!==undefined);
            if(v){ out.push({id:v.aweme_id, title:v.item_title||'', desc:v.desc||'', t:v.publish_time||v.create_time, review:!!(v.status&&v.status.in_reviewing)}); break; } } }
        return out.find(x=>x.title===${JSON.stringify(p.title)} || x.desc.startsWith(${JSON.stringify(p.title)}))||null})()`);
      if (!a) return null;
      const sched = a.t * 1000 > Date.now();
      return { status: sched ? '定时' : a.review ? '审核中' : '已发布', url: `https://www.douyin.com/video/${a.id}`, time: a.t * 1000 };
    },
  },
};
