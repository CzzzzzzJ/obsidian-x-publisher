import { parseNote } from './lib/md.js';
import { xEngine } from './lib/engine.js';
import { savedVault, pickVault, regrant, scan, readText, resolveRef, loadImage } from './lib/vault.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const EDITOR_URL = /^https:\/\/(x|twitter)\.com\/compose\/articles\/edit\//;

let vault = null;       // DirectoryHandle
let index = null;       // { notes, byName }
let current = null;     // { note, parsed, media: Map(ref -> resolved|null) }
let stopRequested = false;
let running = false;

// ---------- 日志 ----------
function log(msg, kind = '') {
  const li = document.createElement('li');
  li.textContent = msg;
  if (kind) li.className = kind;
  $('log').appendChild(li);
  li.scrollIntoView({ block: 'nearest' });
}
const progress = (done, total) => { $('barFill').style.width = `${Math.round((done / total) * 100)}%`; };

// ---------- Obsidian 库 ----------
async function loadVault(handle) {
  vault = handle;
  $('vaultName').textContent = handle.name;
  $('btnRegrant').classList.add('hidden');
  $('btnRescan').classList.remove('hidden');
  $('notes').innerHTML = '<li class="p">扫描中…</li>';
  index = await scan(handle);
  $('search').disabled = false;
  renderNotes();
}

function relTime(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  if (m < 1440) return `${Math.round(m / 60)} 小时前`;
  return `${Math.round(m / 1440)} 天前`;
}

function renderNotes() {
  const q = $('search').value.trim().toLowerCase();
  const list = index.notes.filter(n => !q || n.path.toLowerCase().includes(q)).slice(0, 60);
  $('notes').innerHTML = '';
  for (const n of list) {
    const li = document.createElement('li');
    if (current && current.note.path === n.path) li.classList.add('active');
    li.innerHTML = `<div class="n"></div><div class="p"></div>`;
    li.querySelector('.n').textContent = n.name;
    li.querySelector('.p').textContent = `${n.path} · ${relTime(n.mtime)}`;
    li.onclick = () => selectNote(n);
    $('notes').appendChild(li);
  }
  if (!list.length) $('notes').innerHTML = '<li class="p">没有匹配的笔记</li>';
}

async function selectNote(note) {
  const parsed = parseNote(await readText(note.handle));
  const refs = [parsed.coverRef, ...parsed.segments.filter(s => s.type === 'image').map(s => s.ref)].filter(Boolean);
  const media = new Map();
  for (const ref of refs) media.set(ref, await resolveRef(vault, index.byName, note.path, ref));
  current = { note, parsed, media };
  renderNotes();
  renderPreview();
  refreshTarget();
}

function renderPreview() {
  const { parsed, media } = current;
  $('previewCard').classList.remove('hidden');
  $('pvTitle').textContent = parsed.title || '（无标题）';
  const imgs = parsed.segments.filter(s => s.type === 'image').length;
  const vids = parsed.segments.filter(s => s.type === 'video').length;
  const paras = parsed.segments.filter(s => s.type === 'html').reduce((n, s) => n + s.texts.length, 0);
  $('pvMeta').textContent = `封面：${parsed.coverRef ? parsed.coverRef.split('/').pop() : '无'} · ${paras} 段文字 · ${imgs} 张图 · ${vids} 个视频（插占位行）`;
  $('pvList').innerHTML = '';
  for (const s of parsed.segments) {
    const li = document.createElement('li');
    if (s.type === 'html') li.textContent = `📝 ${s.texts[0].t.slice(0, 22)}${s.texts.length > 1 ? ` …（${s.texts.length} 段）` : ''}`;
    else if (s.type === 'image') {
      li.textContent = `🖼 ${s.ref.split('/').pop()}`;
      li.className = media.get(s.ref) ? 'img' : 'bad';
    } else { li.textContent = `🎬 ${s.ref.split('/').pop()}（占位）`; li.className = 'vid'; }
    $('pvList').appendChild(li);
  }
  const warns = [...parsed.warnings];
  for (const [ref, hit] of media) if (!hit) warns.push(`找不到图片：${ref}（会插入占位文字）`);
  $('pvWarn').innerHTML = '';
  warns.forEach(w => { const li = document.createElement('li'); li.textContent = w; $('pvWarn').appendChild(li); });
}

// ---------- 目标标签页 ----------
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function exec(tabId, cmd, arg = null) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: xEngine, args: [cmd, arg] });
  return res && res.result;
}

async function refreshTarget() {
  if (running) return;
  const el = $('target');
  const tab = await activeTab();
  let ok = false;
  if (tab && EDITOR_URL.test(tab.url || '')) {
    try {
      const st = await exec(tab.id, 'state');
      ok = st && st.composer && st.draftOk;
      el.textContent = ok ? `✓ 已连接长文编辑页${st.textBlocks ? `（草稿已有 ${st.textBlocks} 段，内容会追加到末尾）` : ''}` : '编辑器还没加载完，稍等再试';
    } catch (e) { el.textContent = `无法连接编辑页：${e.message}`; }
  } else {
    el.textContent = '请在当前标签页打开 X 长文编辑页（x.com/compose/articles）';
  }
  el.className = `target ${ok ? 'ok' : 'bad'}`;
  $('btnRun').disabled = !(ok && current);
}

// ---------- 插入流程 ----------
async function waitFor(tabId, check, timeoutMs, intervalMs = 1000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (stopRequested) throw new Error('已停止');
    const st = await exec(tabId, 'state');
    if (!st || !st.composer) throw new Error('编辑页丢失，可能被关闭或跳转');
    if (check(st)) return st;
    await sleep(intervalMs);
  }
  return null;
}

const norm = (s) => s.replace(/[\s​]/g, '');

async function run() {
  const tab = await activeTab();
  if (!tab || !EDITOR_URL.test(tab.url || '')) return;
  const tabId = tab.id;        // 锁定这个标签页，之后切换标签也不影响
  const { parsed, media, note } = current;
  const settle = Math.max(3, Math.min(60, +$('optSettle').value || 12)) * 1000;

  let st = await exec(tabId, 'state');
  if (st.textBlocks > 0 && !confirm(`当前草稿已有 ${st.textBlocks} 段内容，新内容会追加到末尾。继续吗？`)) return;

  running = true; stopRequested = false;
  $('btnRun').disabled = true; $('btnStop').classList.remove('hidden');
  $('log').innerHTML = ''; progress(0, 1);
  const total = parsed.segments.length + 3;
  let done = 0;
  const step = () => progress(++done, total);
  const startImgs = st.imgs;

  try {
    log(`开始：${note.path}`, 'info');

    if (parsed.title) {
      await exec(tabId, 'setTitle', parsed.title);
      log(`标题：${parsed.title}`, 'ok');
    }
    step();

    const cover = parsed.coverRef && media.get(parsed.coverRef);
    if (cover) {
      const img = await loadImage(cover.handle);
      await exec(tabId, 'setCover', img);
      await sleep(1500);
      const s = await waitFor(tabId, x => x.hasCover || x.dialogs > 0, 20000);
      if (s && s.dialogs > 0) { await exec(tabId, 'applyDialog'); await sleep(1500); }
      const s2 = await waitFor(tabId, x => x.hasCover && !x.busy, 30000);
      log(s2 ? `封面：${cover.path.split('/').pop()}` : '封面上传可能没成功，请检查', s2 ? 'ok' : 'err');
    }
    step();

    for (const [i, seg] of parsed.segments.entries()) {
      if (stopRequested) throw new Error('已停止');
      const tag = `[${i + 1}/${parsed.segments.length}]`;
      if (seg.type === 'image' && media.get(seg.ref)) {
        const img = await loadImage(media.get(seg.ref).handle);
        let ok = false;
        for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
          const before = (await exec(tabId, 'state')).imgs;
          await exec(tabId, 'pasteImage', img);
          ok = !!(await waitFor(tabId, x => x.imgs > before && !x.busy, 60000));
          if (!ok && attempt === 1) log(`${tag} 图片没上传上，重试一次`, 'info');
        }
        if (!ok) throw new Error(`图片插入失败：${seg.ref}`);
        log(`${tag} 🖼 ${seg.ref.split('/').pop()}（${Math.round(img.size / 1024)}KB）`, 'ok');
        await sleep(settle);    // 图片刚上传完立刻写字，会把图片冲掉
      } else {
        const html = seg.type === 'html' ? seg.html
          : seg.type === 'video' ? `<p><strong>【🎬 此处插入视频：${seg.ref.split('/').pop()}】</strong></p>`
          : `<p><strong>【缺图：${seg.ref}】</strong></p>`;
        const before = (await exec(tabId, 'state')).blocks;
        await exec(tabId, 'pasteHTML', html);
        const s = await waitFor(tabId, x => x.blocks > before, 10000, 500);
        if (!s) throw new Error(`文字写入失败：${(seg.texts && seg.texts[0].t) || seg.ref}`);
        await sleep(800);
        log(`${tag} ${seg.type === 'html' ? `📝 ${seg.texts[0].t.slice(0, 18)}…` : `🎬 占位：${seg.ref.split('/').pop()}`}`, 'ok');
      }
      step();
    }

    const c = await exec(tabId, 'cleanup');
    log(`清理：去掉 ${c.stripped} 个占位字符、${c.removed} 个空段落`, 'info');
    await sleep(800);

    if ($('optVerify').checked) await verify(tabId, parsed);
    step();

    st = await exec(tabId, 'state');
    const expectImgs = parsed.segments.filter(s => s.type === 'image' && media.get(s.ref)).length;
    const gotImgs = st.imgs - startImgs;
    log(`图片：应插 ${expectImgs} 张，实际 ${gotImgs} 张`, gotImgs === expectImgs ? 'ok' : 'err');
    log('完成 ✓ 草稿已自动保存，检查无误后请自己点发布', 'ok');
  } catch (e) {
    log(`中断：${e.message}`, 'err');
  } finally {
    running = false;
    $('btnStop').classList.add('hidden');
    refreshTarget();
  }
}

// 逐段核对：按顺序对齐期望文字和编辑器里的块，漏掉的补回原位
async function verify(tabId, parsed) {
  const expected = [];
  for (const s of parsed.segments) {
    if (s.type === 'html') expected.push(...s.texts);
    else if (s.type === 'video') expected.push({ t: `【🎬 此处插入视频：${s.ref.split('/').pop()}】`, type: 'unstyled' });
  }
  const actual = (await exec(tabId, 'texts')).filter(b => b.type !== 'atomic' && b.text.trim());
  const head = (s) => norm(s).slice(0, 24);
  let p = 0;
  const found = expected.map((e) => {
    for (let j = p; j < actual.length; j++) {
      if (norm(actual[j].text).startsWith(head(e.t))) { p = j + 1; return actual[j].key; }
    }
    return null;
  });
  const missing = expected.map((e, i) => ({ e, i })).filter(x => !found[x.i]);
  if (!missing.length) { log(`核对：${expected.length} 段文字全部到位`, 'ok'); return; }
  log(`核对：发现 ${missing.length} 段缺失，正在补回`, 'err');
  for (const { e, i } of missing) {
    const anchor = found.slice(i + 1).find(Boolean);
    const r = anchor
      ? await exec(tabId, 'insertBefore', { anchorKey: anchor, text: e.t, type: e.type })
      : await exec(tabId, 'appendText', { text: e.t, type: e.type });
    log(`补回：${e.t.slice(0, 20)}…${r && r.ok ? '' : '（失败，请手动补）'}`, r && r.ok ? 'ok' : 'err');
    await sleep(400);
  }
  log('补回的段落不带加粗/链接，请顺手检查一下', 'info');
}

// ---------- 事件 ----------
$('btnPick').onclick = async () => {
  try { await loadVault(await pickVault()); } catch (e) { if (e.name !== 'AbortError') alert(e.message); }
};
$('btnRegrant').onclick = async () => {
  const { handle } = await savedVault();
  if (handle && await regrant(handle)) loadVault(handle);
};
$('btnRescan').onclick = () => vault && loadVault(vault);
$('search').oninput = () => index && renderNotes();
$('btnRun').onclick = run;
$('btnStop').onclick = () => { stopRequested = true; log('正在停止…', 'info'); };

chrome.tabs.onActivated.addListener(refreshTarget);
chrome.tabs.onUpdated.addListener((_, info) => { if (info.status === 'complete' || info.url) refreshTarget(); });

(async () => {
  const { handle, permission } = await savedVault();
  if (handle) {
    $('vaultName').textContent = handle.name;
    if (permission === 'granted') await loadVault(handle);
    else { $('btnRegrant').classList.remove('hidden'); $('notes').innerHTML = '<li class="p">点「授权」继续读取这个库</li>'; }
  } else {
    $('notes').innerHTML = '<li class="p">先点「选择」，选中你的 Obsidian 库文件夹</li>';
  }
  refreshTarget();
})();
