import { evaluate, setFiles, insertText, pressKey, sleep, waitFor, setValue, byText, click } from '../cdp.js';
import { checkTitle } from './common.js';

const TITLE = `document.querySelector('input[placeholder="请输入稿件标题"]')`;
const TAG_INPUT = `document.querySelector('input[placeholder="按回车键Enter创建标签"]')`;
const TAGS = `[...document.querySelectorAll('.tag-pre-wrp .label-item-v2-content')].map(e=>e.innerText.trim())`;

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

    // 封面：封面制作弹窗里勾「双比例同步」，再传 4:3，让 16:9 也用同一张
    const cover = ctx.cover('4x3');
    if (cover) {
      await evaluate(T, `document.querySelector('.cover-module-main .cover-empty, .cover-module-main .cover-slot').click()`);
      if (!await waitFor(T, `!![...document.querySelectorAll('input[type=file]')].find(i=>/image\\/png/.test(i.accept))`, 15000)) throw new Error('封面弹窗没有打开');
      await sleep(800);
      await evaluate(T, `(()=>{const c=document.querySelector('.operation .sync'); if(c && c.querySelector('input').value!=='true') c.querySelector('label.sync-checkbox').click(); return 1})()`);
      await sleep(500);
      await setFiles(T, `[...document.querySelectorAll('input[type=file]')].find(i=>/image\\/png/.test(i.accept))`, [cover]);
      await sleep(4000);
      if (!await click(T, byText('完成'))) throw new Error('封面弹窗里找不到「完成」');
      await sleep(2000);
      ctx.log('封面：4:3（16:9 同步）');
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
    ctx.note('还需要你选「创作声明」（必填）');
  },

  uploadDone: `document.body.innerText.includes('上传完成')`,
};
