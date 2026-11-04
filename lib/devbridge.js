// 开发桥接：只在「加载已解压的扩展程序」（开发模式）时启用。
// 侧边栏打开期间长轮询本机 tools/bridge-server.mjs，把收到的命令转成 chrome.debugger（CDP）调用。
// 用来对着真实的平台上传页开发和调试适配器；正式安装的插件不会启用。

const BASE = 'http://127.0.0.1:8765';
import { send, detach } from './cdp.js';

async function handle(cmd) {
  switch (cmd.op) {
    case 'ping': return { ok: true, version: chrome.runtime.getManifest().version };
    case 'tabs': return (await chrome.tabs.query({})).map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active, windowId: t.windowId }));
    case 'activate': await chrome.tabs.update(cmd.tabId, { active: true }); return { ok: true };
    case 'cdp':
      return send(cmd.tabId, cmd.method, cmd.params || {});
    case 'detach':
      await detach(cmd.tabId);
      return { ok: true };
    case 'panel':
      // 调用侧边栏注册的开发接口：window.__dev[name](...args)
      return window.__dev[cmd.name](...(cmd.args || []));
    case 'open': return (await chrome.tabs.create({ url: cmd.url, active: false })).id;
    case 'close': await chrome.tabs.remove(cmd.tabIds); return { ok: true };
    case 'reload': setTimeout(() => chrome.runtime.reload(), 100); return { ok: true };
    default: throw new Error(`未知命令 ${cmd.op}`);
  }
}

export async function startDevBridge() {
  const self = await chrome.management.getSelf();
  if (self.installType !== 'development') return;
  for (;;) {
    let cmd;
    try {
      const r = await fetch(`${BASE}/poll`);
      if (r.status === 204) continue;
      cmd = await r.json();
    } catch {
      await new Promise(res => setTimeout(res, 3000));
      continue;
    }
    let body;
    try { body = { id: cmd.id, ok: true, result: await handle(cmd) }; }
    catch (e) { body = { id: cmd.id, ok: false, error: String(e && e.message || e) }; }
    try { await fetch(`${BASE}/result`, { method: 'POST', body: JSON.stringify(body) }); } catch { /* 服务端已关 */ }
  }
}
