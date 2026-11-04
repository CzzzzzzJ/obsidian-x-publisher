// chrome.debugger（CDP）驱动：各平台适配器都通过它操作上传页。
// 文件用 DOM.setFileInputFiles 交本地绝对路径（大视频不经过 JS 内存），
// 文字用 Input.insertText + 真实按键，需要悬停/点击的地方发真实鼠标事件。

const attached = new Set();
chrome.debugger.onDetach.addListener(({ tabId }) => attached.delete(tabId));

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const OTHER_EXT = /chrome-extension:\/\/ URL of different extension/i;

// 别的扩展往页面里注入了 chrome-extension:// iframe 时调试器挂不上（例如 YouTube 上的 YouMind 侧边栏），
// 只在这个标签页里移掉那些节点，刷新页面就会恢复
async function removeForeignFrames(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func: (selfId) => {
      const foreign = (f) => f.src && f.src.startsWith('chrome-extension://') && !f.src.includes(selfId);
      let n = 0;
      document.querySelectorAll('iframe').forEach(f => { if (foreign(f)) { f.remove(); n++; } });
      document.querySelectorAll('*').forEach(e => {
        if (e.shadowRoot && [...e.shadowRoot.querySelectorAll('iframe')].some(foreign)) { e.remove(); n++; }
      });
      return n;
    },
    args: [chrome.runtime.id],
  });
}

export async function attach(tabId) {
  if (attached.has(tabId)) return;
  try { await chrome.debugger.attach({ tabId }, '1.3'); }
  catch (e) { if (!/already attached/i.test(e.message)) throw e; }
  attached.add(tabId);
}

export async function detach(tabId) {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  try { await chrome.debugger.detach({ tabId }); } catch { /* 已经断开 */ }
}

export async function send(tabId, method, params = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      await attach(tabId);
      return await chrome.debugger.sendCommand({ tabId }, method, params);
    } catch (e) {
      // 挂调试器或发命令时都可能因为别的扩展的 iframe 失败：移掉后重试一次
      if (attempt || !OTHER_EXT.test(e.message)) throw e;
      await detach(tabId);
      await removeForeignFrames(tabId);
      await sleep(500);
    }
  }
}

// 在页面里执行表达式（可以 await），取回 JSON 值
export async function evaluate(tabId, expression) {
  const r = await send(tabId, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

// 轮询直到表达式为真值；超时返回 null
export async function waitFor(tabId, expression, timeoutMs = 20000, intervalMs = 500) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const v = await evaluate(tabId, expression); if (v) return v; } catch { /* 页面还在加载 */ }
    await sleep(intervalMs);
  }
  return null;
}

// expr 必须返回一个 <input type=file> 元素（可以穿透 Shadow DOM）
export async function setFiles(tabId, expr, files) {
  const r = await send(tabId, 'Runtime.evaluate', { expression: expr });
  if (!r.result || !r.result.objectId) throw new Error('找不到上传框');
  await send(tabId, 'DOM.setFileInputFiles', { objectId: r.result.objectId, files });
}

export const insertText = (tabId, text) => send(tabId, 'Input.insertText', { text });

const KEYS = { Enter: 13, Escape: 27 };
export async function pressKey(tabId, key = 'Enter') {
  const base = { key, code: key, windowsVirtualKeyCode: KEYS[key], nativeVirtualKeyCode: KEYS[key] };
  const text = key === 'Enter' ? { text: '\r' } : {};
  await send(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base, ...text });
  if (key === 'Enter') await send(tabId, 'Input.dispatchKeyEvent', { type: 'char', ...base, text: '\r' });
  await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

// 多行文字：逐行插入，行间按真实回车（各家富文本编辑器都认）
export async function typeLines(tabId, text) {
  const lines = text.split('\n');
  for (const [i, l] of lines.entries()) {
    if (l) await insertText(tabId, l);
    if (i < lines.length - 1) await pressKey(tabId, 'Enter');
    await sleep(50);
  }
}

// 元素中心坐标（先滚到可见）；expr 返回元素
export async function rectOf(tabId, expr) {
  return evaluate(tabId, `(()=>{const e=${expr}; if(!e) return null; e.scrollIntoView({block:'center'});
    const r=e.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}})()`);
}
const mouse = (tabId, type, x, y, extra = {}) => send(tabId, 'Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra });
export async function hover(tabId, expr) {
  const r = await rectOf(tabId, expr);
  if (!r) throw new Error('找不到要悬停的元素');
  await mouse(tabId, 'mouseMoved', r.x, r.y, { button: 'none' });
}
export async function click(tabId, expr) {
  const r = await rectOf(tabId, expr);
  if (!r) return false;
  await mouse(tabId, 'mouseMoved', r.x, r.y, { button: 'none' });
  await mouse(tabId, 'mousePressed', r.x, r.y, { clickCount: 1 });
  await mouse(tabId, 'mouseReleased', r.x, r.y, { clickCount: 1 });
  return true;
}

// 生成「文字完全等于 text 的最后一个可见元素」的表达式；root 默认 document.body
export const byText = (text, root = 'document.body') => `(()=>{const w=document.createTreeWalker(${root},NodeFilter.SHOW_TEXT);let n;const h=[];
  while((n=w.nextNode())) if(n.nodeValue.trim()===${JSON.stringify(text)}) h.push(n.parentElement);
  return h.filter(e=>e.getClientRects().length).at(-1)||null})()`;
export const clickText = (tabId, text, root) => click(tabId, byText(text, root));
// 同上，但取第一个可见元素
export const firstByText = (text, root = 'document.body') => byText(text, root).replace('.at(-1)', '[0]');

// 原生 setter 赋值（Vue/React 受控输入框）
export const setValue = (tabId, expr, value) => evaluate(tabId, `(()=>{const el=${expr}; if(!el) return null;
  Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return el.value})()`);

// 把光标放到可编辑元素末尾并聚焦
export const focusEnd = (tabId, expr) => evaluate(tabId, `(()=>{const e=${expr}; if(!e) return false; e.focus();
  const s=getSelection(); s.selectAllChildren(e); s.collapseToEnd(); return true})()`);
export const focusSelectAll = (tabId, expr) => evaluate(tabId, `(()=>{const e=${expr}; if(!e) return false; e.focus();
  const s=getSelection(); s.selectAllChildren(e); return true})()`);
