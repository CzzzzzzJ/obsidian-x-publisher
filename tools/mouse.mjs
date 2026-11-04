// CDP 真实鼠标：移到元素中心 / 点击
import { call, evaluate } from './cdp.mjs';
export async function rectOf(tabId, expr) {
  return evaluate(tabId, `(()=>{const e=${expr}; if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`);
}
const ev = (tabId, type, x, y, extra = {}) => call({ op: 'cdp', tabId, method: 'Input.dispatchMouseEvent', params: { type, x, y, button: 'left', ...extra } });
export const hover = (tabId, x, y) => ev(tabId, 'mouseMoved', x, y, { button: 'none' });
export async function clickAt(tabId, x, y) {
  await hover(tabId, x, y);
  await ev(tabId, 'mousePressed', x, y, { clickCount: 1 });
  await ev(tabId, 'mouseReleased', x, y, { clickCount: 1 });
}
