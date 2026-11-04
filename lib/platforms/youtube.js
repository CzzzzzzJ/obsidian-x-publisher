import { evaluate, setFiles, sleep, waitFor, insertText, pressKey, typeLines, focusSelectAll, setValue } from '../cdp.js';
import { checkTitle } from './common.js';

const BOX = (i) => `[...document.querySelectorAll('#textbox[contenteditable]')][${i}]`;
const TAG_INPUT = `document.querySelector('input[aria-label="标签"], input[aria-label="Tags"]')`;

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

    await focusSelectAll(T, BOX(1));
    await typeLines(T, p.desc);
    ctx.log(`说明：${p.desc.length} 字`);

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
    ctx.note('还需要你选「是否面向儿童」（必填）和公开范围');
  },

  uploadDone: `(()=>{const t=(document.querySelector('ytcp-video-upload-progress')||{}).innerText||''; return /上传完毕|Upload complete|处理|Processing|检查完毕|Checks complete/.test(t) && !/正在上传|Uploading/.test(t)})()`,
};
