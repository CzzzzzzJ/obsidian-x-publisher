// 视频分发：扫描 NAS 上的发布工程（publish.json），按平台打开上传页并填写。
// 只填写、不发布；最后的「发布」由人点。
import { validate, PLATFORMS } from './bundle.js';
import { waitFor, evaluate, detach, sleep } from './cdp.js';
import bilibili from './platforms/bilibili.js';
import xhs from './platforms/xhs.js';
import douyin from './platforms/douyin.js';
import channels from './platforms/channels.js';
import youtube from './platforms/youtube.js';
import x from './platforms/x.js';

export const ADAPTERS = { bilibili, xhs, douyin, channels, youtube, x };
export const ORDER = ['bilibili', 'xhs', 'douyin', 'channels', 'youtube', 'x'];

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

/**
 * 跑一次分发。
 * opts: { rootPath: NAS 根目录绝对路径, platforms: [id], onChange(state), shouldStop() }
 */
export async function run(project, opts) {
  const b = project.data;
  const abs = (rel) => `${opts.rootPath.replace(/\/$/, '')}/${project.dir}/${rel}`;
  const states = {};
  const pending = [];

  for (const id of ORDER) {
    const p = b.platforms[id];
    if (!p || !opts.platforms.includes(id)) continue;
    const st = states[id] = makeState(id, opts.onChange);
    if (p.skip) { st.note(`跳过：${p.skip}`); st.set('跳过'); continue; }
    if (opts.shouldStop()) { st.set('已停止'); continue; }

    const ad = ADAPTERS[id];
    const ctx = {
      p, video: abs(b.video),
      cover: (k) => ((p.covers || []).includes(k) && b.covers[k]) ? abs(b.covers[k]) : null,
      log: st.log, note: st.note, fail: st.fail,
    };
    try {
      st.set('打开上传页');
      const tab = await chrome.tabs.create({ url: ad.url, active: true });
      st.tabId = ctx.tabId = tab.id;
      if (!await waitFor(tab.id, ad.ready, 60000, 1000)) throw new Error('上传页没有打开（是不是没登录？）');
      await sleep(1500);
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
      if (!done) continue;
      pending.splice(pending.indexOf(item), 1);
      st.log('视频上传完成');
      if (ad.afterUpload) {
        try {
          await chrome.tabs.update(ctx.tabId, { active: true });
          await sleep(800);
          await ad.afterUpload(ctx);
        } catch (e) { st.fail(e.message); }
      }
      st.set(st.failed ? '异常' : '待你发布');
    }
    if (pending.length) await sleep(20000);
  }
  for (const { st } of pending) st.set(opts.shouldStop() ? '已停止' : '上传超时');
  for (const st of Object.values(states)) if (st.tabId) await detach(st.tabId);
  return states;
}
