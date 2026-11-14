// 视频分发：扫描 NAS 上的发布工程（publish.json），按平台打开上传页并填写。
// 只填写、不发布；最后的「发布」由人点。
import { validate, PLATFORMS } from './bundle.js';
import { bjTime } from './platforms/common.js';
import { waitFor, evaluate, detach, sleep } from './cdp.js';
import bilibili from './platforms/bilibili.js';
import xhs from './platforms/xhs.js';
import douyin from './platforms/douyin.js';
import channels from './platforms/channels.js';
import youtube from './platforms/youtube.js';
import x from './platforms/x.js';
import { adapters as extraAdapters } from './platforms/extra.js';

export const ADAPTERS = { bilibili, xhs, douyin, channels, youtube, x, ...extraAdapters };
export const ORDER = ['bilibili', 'xhs', 'douyin', 'channels', 'youtube', 'x', ...Object.keys(extraAdapters)];

// 在 NAS 根目录（如 视频导出/）下找 publish.json，最多往下 3 层
export async function scanProjects(root) {
  const out = [];
  async function walk(dir, path, depth) {
    let pj = null;
    const subs = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'file' && name === 'publish.json') pj = h;
      else if (h.kind === 'directory' && !name.startsWith('.') && depth < 3) subs.push([name, h]);
    }
    if (pj) {
      try {
        const data = JSON.parse(await (await pj.getFile()).text());
        const f = await pj.getFile();
        out.push({ dir: path, handle: dir, data, mtime: f.lastModified });
      } catch (e) { out.push({ dir: path, handle: dir, error: `publish.json 解析失败：${e.message}` }); }
      return;    // 工程目录里不再往下找
    }
    for (const [name, h] of subs) await walk(h, path ? `${path}/${name}` : name, depth + 1);
  }
  await walk(root, '', 0);
  return out.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
}

// 列出工程目录里的所有文件（相对路径），用于校验
export async function listFiles(dir) {
  const files = new Set();
  async function walk(d, prefix) {
    for await (const [name, h] of d.entries()) {
      if (h.kind === 'directory') await walk(h, prefix + name + '/');
      else files.add(prefix + name);
    }
  }
  await walk(dir, '');
  return files;
}

export async function check(project) {
  return validate(project.data, await listFiles(project.handle));
}

// 一个平台的运行状态；onChange 由界面订阅
function makeState(id, onChange) {
  const st = { id, name: PLATFORMS[id].name, status: '等待', logs: [], tabId: null, failed: false };
  const push = (kind, msg) => { st.logs.push({ kind, msg }); onChange(st); };
  st.log = (m) => push('ok', m);
  st.note = (m) => push('info', m);
  st.fail = (m) => { st.failed = true; push('err', m); };
  st.set = (s) => { st.status = s; onChange(st); };
  return st;
}

// 有些步骤在后台标签页里做不成（比如要真实悬停的按钮）：短暂切到前台重试，做完切回用户原来的页面
async function withFocus(tabId, fn) {
  const tab = await chrome.tabs.get(tabId);
  const [prev] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  await chrome.tabs.update(tabId, { active: true });
  await sleep(1000);
  try { return await fn(); }
  finally { if (prev && prev.id !== tabId) await chrome.tabs.update(prev.id, { active: true }).catch(() => {}); }
}

const LOGIN_URL = /login|passport|signin|accounts\.google\.com|\/i\/flow\/login/i;

/**
 * 登录预检：后台同时打开各平台上传页，判断是否已登录。
 * 返回 { id: { ok, tabId, reason } }；keepTabs=false 时检查完就关掉页面。
 */
export async function preflight(ids, { windowId, keepTabs = true } = {}) {
  const out = {};
  await Promise.all(ids.map(async (id) => {
    const ad = ADAPTERS[id];
    let tab;
    try {
      tab = await chrome.tabs.create({ url: ad.url, active: false, ...(windowId ? { windowId } : {}) });
      const end = Date.now() + 60000;
      let res = null;
      while (!res && Date.now() < end) {
        await sleep(1000);
        const t = await chrome.tabs.get(tab.id).catch(() => null);
        if (!t) { res = { ok: false, reason: '页面被关掉了' }; break; }
        if (LOGIN_URL.test(t.url || '')) { res = { ok: false, reason: `${ad.name}没有登录（跳到了登录页）` }; break; }
        // 有的平台（抖音）掉登录后不跳转，同一个地址直接显示扫码登录框
        if (await evaluate(tab.id, `/扫码登录/.test(document.body.innerText) && /验证码登录|密码登录/.test(document.body.innerText)`).catch(() => false)) { res = { ok: false, reason: `${ad.name}没有登录（页面显示扫码登录）` }; break; }
        const ready = await evaluate(tab.id, ad.ready).catch(() => false);
        if (ready) {
          // 页面能打开但还要确认身份的（比如知识站要管理员）
          const who = ad.loggedIn ? await evaluate(tab.id, ad.loggedIn).catch(() => false) : true;
          res = who ? { ok: true } : { ok: false, reason: `${ad.name}没有登录${ad.loginHint ? `（${ad.loginHint}）` : ''}` };
        }
      }
      out[id] = { ...(res || { ok: false, reason: '上传页 60 秒没打开（可能没登录或网络慢）' }), tabId: tab.id, secs: Math.round((Date.now() - end + 60000) / 1000) };
    } catch (e) {
      out[id] = { ok: false, reason: e.message, tabId: tab && tab.id };
    }
    if (!keepTabs && tab) { await detach(tab.id); chrome.tabs.remove(tab.id).catch(() => {}); }   // 不等关闭完成：有「离开此网站？」弹窗时会一直挂着
  }));
  return out;
}

/**
 * 跑一次分发。在扩展后台（service worker）里运行，关掉面板也不受影响。
 * opts: { rootPath: NAS 根目录绝对路径, platforms: [id], windowId, onChange(state), shouldStop() }
 */
export async function run(project, opts) {
  const b = project.data;
  const abs = (rel) => `${opts.rootPath.replace(/\/$/, '')}/${project.dir}/${rel}`;
  const states = {};
  const pending = [];

  const todo = ORDER.filter(id => b.platforms[id] && opts.platforms.includes(id) && !b.platforms[id].skip);
  for (const id of todo) { const st = states[id] = makeState(id, opts.onChange); st.set('检查登录'); }
  const pre = await preflight(todo, { windowId: opts.windowId });

  for (const id of ORDER) {
    const p = b.platforms[id];
    if (!p || !opts.platforms.includes(id)) continue;
    const st = states[id] || (states[id] = makeState(id, opts.onChange));
    if (p.skip) { st.note(`跳过：${p.skip}`); st.set('跳过'); continue; }
    if (!pre[id].ok) {
      st.tabId = pre[id].tabId;
      st.fail(`${pre[id].reason}，这个平台先跳过；登录后可以单独重填`);
      st.set('未登录');
      continue;
    }
    if (opts.shouldStop()) { st.set('已停止'); continue; }

    const ad = ADAPTERS[id];
    const ctx = {
      p, video: abs(b.video), projectId: b.id, durationSec: b.durationSec || 0,
      cover: (k) => ((p.covers || []).includes(k) && b.covers[k]) ? abs(b.covers[k]) : null,
      log: st.log, note: st.note, fail: st.fail,
      schedule: b.schedule ? bjTime(b.schedule) : null,    // 北京时间各字段；null = 立即发布
      withFocus: (fn) => withFocus(ctx.tabId, fn),          // 后台做不成的步骤，短暂切到前台
    };
    try {
      // 用预检时在后台打开的页面，不抢用户正在看的页面
      st.tabId = ctx.tabId = pre[id].tabId;
      await sleep(1000);
      st.set('填写中');
      await ad.fill(ctx);
      st.set(st.failed ? '异常' : (ad.uploadDone ? '上传中' : '已填写'));
      if (ad.uploadDone) pending.push({ st, ad, ctx });
    } catch (e) {
      st.fail(e.message);
      st.set('异常');
    }
  }

  // 等视频传完；需要传完才能做的步骤（小红书、视频号的封面）在这里补
  const deadline = Date.now() + 4 * 3600 * 1000;
  while (pending.length && Date.now() < deadline && !opts.shouldStop()) {
    for (const item of [...pending]) {
      const { st, ad, ctx } = item;
      let done = false;
      try { done = await evaluate(ctx.tabId, ad.uploadDone); }
      catch (e) { st.fail(`页面丢失：${e.message}`); st.set('异常'); pending.splice(pending.indexOf(item), 1); continue; }
      if (!done) {
        // 适配器可以提供进度表达式（比如上传百分比），显示在状态卡上
        if (ad.progress) { const txt = await evaluate(ctx.tabId, ad.progress).catch(() => ''); if (txt && txt !== st.status) st.set(txt); }
        continue;
      }
      pending.splice(pending.indexOf(item), 1);
      st.log('视频上传完成');
      if (ad.afterUpload) {
        try { await ad.afterUpload(ctx); }
        catch (e) {
          st.note(`后台补封面没成功（${e.message}），切到这个页面重试一次`);
          try { await withFocus(ctx.tabId, () => ad.afterUpload(ctx)); }
          catch (e2) { st.fail(e2.message); }
        }
      }
      st.set(st.failed ? '异常' : '待你发布');
    }
    if (pending.length) await sleep(20000);
  }
  for (const { st } of pending) st.set(opts.shouldStop() ? '已停止' : '上传超时');
  for (const st of Object.values(states)) if (st.tabId) await detach(st.tabId);
  return states;
}

/**
 * 发布后回传链接：后台打开各平台的作品管理页，按标题找到这一期，取回状态和链接。
 * 返回 { id: { status, url, time, note } }；没找到的 status 为「未找到」。
 */
export async function collectLinks(project, platforms, { windowId } = {}) {
  const b = project.data;
  const out = {};
  for (const id of ORDER) {
    const p = b.platforms[id];
    const ad = ADAPTERS[id];
    if (!p || !platforms.includes(id)) continue;
    if (!ad.links) { out[id] = { status: '不支持', url: '' }; continue; }
    let tab;
    try {
      tab = await chrome.tabs.create({ url: ad.links.url, active: false, ...(windowId ? { windowId } : {}) });
      const t = await chrome.tabs.get(tab.id);
      if (!await waitFor(tab.id, ad.links.ready, 45000, 1000)) {
        const now = await chrome.tabs.get(tab.id).catch(() => t);
        out[id] = { status: LOGIN_URL.test(now.url || '') ? '未登录' : '页面没打开', url: '' };
        continue;
      }
      let r = null;
      for (let i = 0; i < 3 && !r; i++) {        // 列表是异步加载的，多试几次
        await sleep(2500);
        r = await ad.links.collect(tab.id, p, b).catch((e) => ({ status: '出错', url: '', note: e.message }));
      }
      out[id] = r || { status: '未找到', url: '', note: '管理页里没找到同标题的作品（可能还没发，或标题改过）' };
    } catch (e) {
      out[id] = { status: '出错', url: '', note: e.message };
    } finally {
      if (tab) { await detach(tab.id); await chrome.tabs.remove(tab.id).catch(() => {}); }
    }
  }
  return out;
}
