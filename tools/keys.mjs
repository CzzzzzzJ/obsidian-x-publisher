// CDP 真实键盘输入：insertText / pressKey
import { call } from './cdp.mjs';
export const insertText = (tabId, text) => call({ op: 'cdp', tabId, method: 'Input.insertText', params: { text } });
export async function pressKey(tabId, key = 'Enter') {
  const codes = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, ' ': 32 };
  const base = { key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: codes[key], nativeVirtualKeyCode: codes[key] };
  await call({ op: 'cdp', tabId, method: 'Input.dispatchKeyEvent', params: { type: 'rawKeyDown', ...base, ...(key === 'Enter' ? { text: '\r' } : {}) } });
  if (key === 'Enter') await call({ op: 'cdp', tabId, method: 'Input.dispatchKeyEvent', params: { type: 'char', ...base, text: '\r' } });
  await call({ op: 'cdp', tabId, method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', ...base } });
}
