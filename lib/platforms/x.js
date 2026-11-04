import { evaluate, setFiles, sleep, waitFor, focusEnd, typeLines } from '../cdp.js';

const BOX = `document.querySelector('[data-testid=tweetTextarea_0]')`;

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
    ctx.note('不要关掉发帖框，关掉会丢失');
  },

  uploadDone: `!/Uploading \\(\\d+%\\)/.test(document.body.innerText)`,
};
