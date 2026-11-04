// node tools/bgshot.mjs <tabId> <out.png> [css 选择器]  —— 不切换标签页，直接截后台页面（可只截某个元素附近）
import { writeFileSync } from 'node:fs';
import { call, evaluate } from './cdp.mjs';
const [tabId, out, sel] = [+process.argv[2], process.argv[3], process.argv[4]];
let clip;
if (sel) {
  const r = await evaluate(tabId, `(()=>{const e=document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({block:'center'}); const b=e.getBoundingClientRect(); return {x:Math.max(0,b.x-40),y:Math.max(0,b.y-360),width:b.width+500,height:b.height+520}})()`);
  clip = { ...r, scale: 1 };
}
const r = await call({ op: 'cdp', tabId, method: 'Page.captureScreenshot', params: { format: 'png', fromSurface: true, captureBeyondViewport: !!clip, ...(clip ? { clip } : {}) } });
writeFileSync(out, Buffer.from(r.data, 'base64'));
console.log(out);
