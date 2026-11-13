// 扩展后台：点击工具栏图标打开侧边栏；视频分发的填写流程也跑在这里，关掉面板不受影响。
import { run, preflight, collectLinks } from './lib/publish.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

const DONE = ['待你发布', '已填写', '跳过'];
const BAD = ['异常', '上传超时', '已停止'];

let job = null;   // { name, running, stop, states: { id: state }, startedAt, finishedAt }

const snapshot = () => job && {
  name: job.name, running: job.running, startedAt: job.startedAt, finishedAt: job.finishedAt,
  states: Object.values(job.states).map(s => ({ id: s.id, name: s.name, status: s.status, logs: s.logs, tabId: s.tabId })),
};

// 工具栏图标：跑的时候显示「完成数/总数」，结束后 ✓ 或 !
function badge() {
  const snap = snapshot();
  if (!snap) return chrome.action.setBadgeText({ text: '' });
  const all = snap.states.filter(s => s.status !== '跳过');
  const done = all.filter(s => DONE.includes(s.status)).length;
  const bad = all.some(s => BAD.includes(s.status));
  if (snap.running) {
    chrome.action.setBadgeText({ text: `${done}/${all.length}` });
    chrome.action.setBadgeBackgroundColor({ color: '#2f6bff' });
  } else {
    chrome.action.setBadgeText({ text: bad ? '!' : '✓' });
    chrome.action.setBadgeBackgroundColor({ color: bad ? '#e5484d' : '#1f9d55' });
  }
  chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
}

let pending = null;
function publishState() {
  if (pending) return;
  pending = setTimeout(async () => {
    pending = null;
    const snap = snapshot();
    badge();
    await chrome.storage.session.set({ job: snap }).catch(() => {});
    chrome.runtime.sendMessage({ type: 'job', job: snap }).catch(() => { /* 面板没开 */ });
  }, 150);
}

function notifyDone() {
  const snap = snapshot();
  const all = snap.states.filter(s => s.status !== '跳过');
  const ok = all.filter(s => DONE.includes(s.status)).map(s => s.name);
  const bad = all.filter(s => !DONE.includes(s.status)).map(s => `${s.name}（${s.status}）`);
  chrome.notifications.create('publish-done', {
    type: 'basic', iconUrl: 'icons/icon128.png', priority: 2,
    title: bad.length ? `${snap.name}：${bad.length} 个平台需要处理` : `${snap.name}：全部待你发布`,
    message: [ok.length ? `待你发布：${ok.join('、')}` : '', bad.length ? `需要处理：${bad.join('、')}` : ''].filter(Boolean).join('\n'),
  });
}

// 点通知：切到第一个需要看的平台页面
chrome.notifications.onClicked.addListener(async () => {
  const snap = snapshot();
  const st = snap && (snap.states.find(s => BAD.includes(s.status) && s.tabId) || snap.states.find(s => s.tabId));
  if (!st) return;
  const tab = await chrome.tabs.get(st.tabId).catch(() => null);
  if (tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }
});

async function start({ project, rootPath, platforms, windowId }) {
  if (job && job.running) throw new Error('上一轮还在跑，先停止或等它结束');
  job = { name: project.data.name, running: true, stop: false, states: {}, startedAt: Date.now() };
  publishState();
  run(project, {
    rootPath, platforms, windowId,
    onChange: (st) => { job.states[st.id] = st; publishState(); },
    shouldStop: () => job.stop,
  }).catch((e) => {
    job.states._err = { id: '_err', name: '整体', status: '异常', logs: [{ kind: 'err', msg: e.message }] };
  }).finally(() => {
    job.running = false; job.finishedAt = Date.now();
    publishState();
    notifyDone();
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'publish:start') {
    start(msg).then(() => reply({ ok: true }), (e) => reply({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'publish:check') {
    preflight(msg.platforms, { windowId: msg.windowId, keepTabs: false })
      .then((r) => reply({ ok: true, result: r }), (e) => reply({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'publish:links') {
    collectLinks(msg.project, msg.platforms, { windowId: msg.windowId })
      .then((r) => reply({ ok: true, result: r }), (e) => reply({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'publish:stop') { if (job) job.stop = true; reply({ ok: true }); return; }
  if (msg.type === 'publish:get') {
    if (job) { reply(snapshot()); return; }
    // service worker 重启过：内存里的任务没了，从 session 里取回最后一次的状态给面板看
    chrome.storage.session.get('job').then(({ job: saved }) => {
      if (saved && saved.running) { saved.running = false; saved.interrupted = true; }
      reply(saved || null);
    });
    return true;
  }
  if (msg.type === 'publish:clear') { if (!job || !job.running) { job = null; chrome.storage.session.remove('job'); badge(); } reply({ ok: true }); }
});
