// 侧边栏「视频分发」页签
import { idbGet, idbSet } from './lib/vault.js';
import { scanProjects, check, ORDER } from './lib/publish.js';
import { PLATFORMS } from './lib/bundle.js';

const $ = (id) => document.getElementById(id);
const KEY = 'nasRoot', PATH_KEY = 'nasPath';
const DEFAULT_PATH = '/Volumes/sata11-176XXXX6901/视频导出';

let root = null;        // NAS 目录句柄
let projects = [];
let current = null;     // { project, result }
let running = false;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---------- NAS 目录 ----------
async function loadRoot(handle) {
  root = handle;
  $('nasName').textContent = handle.name;
  $('btnNasRegrant').classList.add('hidden');
  $('btnNasRescan').classList.remove('hidden');
  $('projects').innerHTML = '<li class="p">扫描中…</li>';
  projects = await scanProjects(handle);
  renderProjects();
}

function renderProjects() {
  $('projects').innerHTML = '';
  if (!projects.length) { $('projects').innerHTML = '<li class="p">这个目录下没有找到 publish.json</li>'; return; }
  for (const pr of projects) {
    const li = el('li');
    if (current && current.project.dir === pr.dir) li.classList.add('active');
    li.append(el('div', 'n', pr.data ? pr.data.name : pr.dir), el('div', 'p', pr.error || pr.dir));
    li.onclick = () => selectProject(pr);
    $('projects').appendChild(li);
  }
}

// ---------- 工程预览 + 校验 ----------
async function selectProject(pr) {
  if (running) return;
  if (pr.error) { alert(pr.error); return; }
  const result = await check(pr);
  current = { project: pr, result };
  renderProjects();
  const b = pr.data;
  $('projCard').classList.remove('hidden');
  $('projTitle').textContent = b.name;
  const when = b.schedule ? new Date(b.schedule).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  $('projMeta').textContent = `${pr.dir} · 视频 ${b.video} · 封面 ${Object.keys(b.covers || {}).join(' / ')} · ${when ? `定时 ${when}` : '立即发布'}`;

  $('projCheck').innerHTML = '';
  result.errors.forEach(m => $('projCheck').appendChild(el('li', '', `❌ ${m}`)));
  result.warnings.forEach(m => $('projCheck').appendChild(el('li', 'info', `⚠️ ${m}`)));
  if (!result.errors.length) $('projCheck').appendChild(el('li', 'ok', '✅ 校验通过'));

  $('platList').innerHTML = '';
  for (const id of ORDER) {
    const p = b.platforms[id];
    if (!p) continue;
    const li = el('li', p.skip ? 'skip' : '');
    const cb = el('input'); cb.type = 'checkbox'; cb.value = id; cb.checked = !p.skip; cb.disabled = !!p.skip;
    const title = p.title || p.shortTitle || (p.text || '').split('\n')[0];
    const desc = el('div');
    desc.append(el('div', 'pn', PLATFORMS[id].name),
      el('div', 'pd', p.skip ? `跳过：${p.skip}` : `${title}｜封面 ${(p.covers || []).join('+') || '无'}`));
    li.append(cb, desc);
    $('platList').appendChild(li);
  }
  $('btnPublish').disabled = running || !!result.errors.length;
}

// ---------- 状态卡 ----------
const cards = {};
function renderState(st) {
  let card = cards[st.id];
  if (!card) {
    card = cards[st.id] = el('section', 'card st');
    const row = el('div', 'row');
    const left = el('div'); left.append(el('span', 'name', st.name), document.createTextNode(' '));
    const pill = el('span', 'pill'); left.appendChild(pill);
    const go = el('button', 'ghost', '切到页面');
    go.onclick = () => st.tabId && chrome.tabs.update(st.tabId, { active: true });
    row.append(left, go);
    card.append(row, el('ol'));
    card._pill = pill; card._ol = card.querySelector('ol'); card._go = go;
    $('statusList').appendChild(card);
  }
  card._pill.textContent = st.status;
  card._pill.className = 'pill ' + ({ 待你发布: 'ok', 已填写: 'ok', 异常: 'err', 上传超时: 'err', 填写中: 'run', 上传中: 'run', 打开上传页: 'run' }[st.status] || '');
  card._go.classList.toggle('hidden', !st.tabId);
  card._ol.innerHTML = '';
  st.logs.forEach(l => card._ol.appendChild(el('li', l.kind, l.msg)));
}

// 后台推来的任务状态 → 状态卡
function renderJob(job) {
  running = !!(job && job.running);
  $('btnPubStop').classList.toggle('hidden', !running);
  if (current) $('btnPublish').disabled = running || !!current.result.errors.length;
  $('statusList').innerHTML = ''; for (const k in cards) delete cards[k];
  if (!job) return;
  const head = el('div', 'label', running ? `正在填写：${job.name}` : `上一轮：${job.name}`);
  const hint = el('div', 'hint', running ? '可以关掉面板或切到别的页面，填完会弹通知' : (job.interrupted ? '浏览器中途重启过插件后台，这一轮没有跑完' : '检查各平台页面后自己点发布'));
  const box = el('div', 'job-head'); box.append(head, hint);
  $('statusList').appendChild(box);
  job.states.forEach(renderState);
}

async function publish() {
  if (!current || running) return;
  const platforms = [...$('platList').querySelectorAll('input:checked')].map(i => i.value);
  if (!platforms.length) return;
  const rootPath = $('nasPath').value.trim();
  if (!rootPath.startsWith('/')) { alert('请先填 NAS 目录在本机的绝对路径'); return; }
  try { localStorage.setItem(PATH_KEY, rootPath); } catch { /* 无痕模式 */ }
  const win = await chrome.windows.getCurrent();
  // 文件夹句柄不能跨进程传，只传相对路径和 publish.json 内容；流程在插件后台跑
  const r = await chrome.runtime.sendMessage({
    type: 'publish:start', rootPath, platforms, windowId: win.id,
    project: { dir: current.project.dir, data: current.project.data },
  });
  if (!r || !r.ok) alert(`没能开始：${r ? r.error : '插件后台没有响应'}`);
}

// ---------- 初始化 ----------
export async function initVideo() {
  let path = DEFAULT_PATH;
  try { path = localStorage.getItem(PATH_KEY) || DEFAULT_PATH; } catch { /* 无痕模式 */ }
  $('nasPath').value = path;

  $('btnNasPick').onclick = async () => {
    try {
      const h = await window.showDirectoryPicker({ id: 'nas-root', mode: 'read' });
      await idbSet(KEY, h);
      loadRoot(h);
    } catch (e) { if (e.name !== 'AbortError') alert(e.message); }
  };
  $('btnNasRegrant').onclick = async () => {
    const h = await idbGet(KEY);
    if (h && (await h.requestPermission({ mode: 'read' })) === 'granted') loadRoot(h);
  };
  $('btnNasRescan').onclick = () => root && loadRoot(root);
  $('btnPublish').onclick = publish;
  $('btnPubStop').onclick = () => chrome.runtime.sendMessage({ type: 'publish:stop' });
  chrome.runtime.onMessage.addListener((msg) => { if (msg.type === 'job') renderJob(msg.job); });
  renderJob(await chrome.runtime.sendMessage({ type: 'publish:get' }));

  const h = await idbGet(KEY);
  if (h) {
    $('nasName').textContent = h.name;
    if ((await h.queryPermission({ mode: 'read' })) === 'granted') await loadRoot(h);
    else { $('btnNasRegrant').classList.remove('hidden'); $('projects').innerHTML = '<li class="p">点「授权」继续读取这个目录</li>'; }
  } else {
    $('projects').innerHTML = '<li class="p">点「选择」，选中 NAS 上的「视频导出」文件夹</li>';
  }

  // 开发接口（仅供本机开发桥接调用）
  window.__dev = {
    projects: () => projects.map(p => ({ dir: p.dir, name: p.data && p.data.name, error: p.error })),
    check: async (dir) => { const pr = projects.find(p => p.dir === dir); await selectProject(pr); return current.result; },
    // 按工程目录发起一轮；platforms 不传就用勾选的
    start: async (dir, platforms) => {
      const pr = projects.find(p => p.dir === dir); await selectProject(pr);
      if (platforms) $('platList').querySelectorAll('input').forEach(i => { i.checked = platforms.includes(i.value); });
      await publish(); return true;
    },
    // 不经过文件夹授权，直接用传入的 publish.json 内容发起（开发验证用）
    startRaw: async (project, platforms, rootPath) => {
      const win = await chrome.windows.getCurrent();
      return chrome.runtime.sendMessage({ type: 'publish:start', project, platforms, rootPath, windowId: win.id });
    },
    job: () => chrome.runtime.sendMessage({ type: 'publish:get' }),
    state: () => ({ running, statuses: Object.fromEntries(Object.entries(cards).map(([k, c]) => [k, { status: c._pill.textContent, logs: [...c._ol.children].map(li => li.textContent) }])) }),
  };
}
