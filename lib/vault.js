// 通过 File System Access API 读取本地 Obsidian 库。
// 目录授权句柄存在 IndexedDB 里，下次打开面板时只需确认一次权限。

const DB = 'obsidian-x-publisher', STORE = 'handles', KEY = 'vault';
const SKIP_DIRS = new Set(['.obsidian', '.git', '.trash', 'node_modules', '.claude']);

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, val) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function savedVault() {
  const handle = await idbGet(KEY);
  if (!handle) return { handle: null, permission: 'none' };
  return { handle, permission: await handle.queryPermission({ mode: 'read' }) };
}

// 需要在用户点击事件里调用
export async function pickVault() {
  const handle = await window.showDirectoryPicker({ id: 'obsidian-vault', mode: 'read' });
  await idbSet(KEY, handle);
  return handle;
}
export async function regrant(handle) {
  return (await handle.requestPermission({ mode: 'read' })) === 'granted';
}

// 递归列出所有 .md（含修改时间），并建立文件名索引用于解析 ![[图片]]
export async function scan(root) {
  const notes = [], byName = new Map();
  async function walk(dir, prefix) {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'directory') {
        if (!SKIP_DIRS.has(name) && !name.startsWith('.')) await walk(h, prefix + name + '/');
        continue;
      }
      const path = prefix + name;
      const lower = name.toLowerCase();
      if (!byName.has(lower)) byName.set(lower, []);
      byName.get(lower).push({ path, handle: h });
      if (lower.endsWith('.md')) {
        const f = await h.getFile();
        notes.push({ path, name: name.replace(/\.md$/i, ''), mtime: f.lastModified, handle: h });
      }
    }
  }
  await walk(root, '');
  notes.sort((a, b) => b.mtime - a.mtime);
  return { notes, byName };
}

export async function readText(fileHandle) {
  return (await fileHandle.getFile()).text();
}

async function handleAt(root, path) {
  const parts = path.split('/').filter(p => p && p !== '.');
  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === '..') return null;
    dir = await dir.getDirectoryHandle(parts[i]);
  }
  return dir.getFileHandle(parts[parts.length - 1]);
}

// 解析嵌入引用：先按笔记所在目录的相对路径，再按库根目录，最后按文件名（同名取路径最短的）
export async function resolveRef(root, index, notePath, ref) {
  const clean = ref.replace(/^\.?\//, '');
  const noteDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/') + 1) : '';
  for (const candidate of [noteDir + clean, clean]) {
    try { const h = await handleAt(root, candidate); if (h) return { path: candidate, handle: h }; } catch { /* 继续 */ }
  }
  const hits = index.get(clean.split('/').pop().toLowerCase()) || [];
  if (!hits.length) return null;
  return [...hits].sort((a, b) => a.path.length - b.path.length)[0];
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// 读取图片；超过 4MB 或格式 X 不收时，压成 JPEG（长边不超过 2400）
export async function loadImage(fileHandle) {
  const file = await fileHandle.getFile();
  const okType = ['image/png', 'image/jpeg', 'image/webp'].includes(file.type);
  if (okType && file.size <= 4 * 1024 * 1024) {
    return { b64: toBase64(await file.arrayBuffer()), name: file.name, mime: file.type, size: file.size };
  }
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
  return { b64: toBase64(await blob.arrayBuffer()), name: file.name.replace(/\.\w+$/, '.jpg'), mime: 'image/jpeg', size: blob.size };
}
