// 在 X 长文编辑页的页面主环境（world: 'MAIN'）里执行。
// chrome.scripting.executeScript 会把函数序列化后注入，所以这个函数必须自包含，不能引用外部变量。
// 编辑器是 Draft.js：通过 React fiber 拿到 editorState / onChange，直接操作内容；文字和图片用模拟粘贴写入。
export function xEngine(cmd, arg) {
  const ZW = '​';
  const composer = () => document.querySelector('[data-testid="composer"]');
  const titleBox = () => [...document.querySelectorAll('textarea')].find(t => t.placeholder === 'Add a title');
  const coverInput = () => document.querySelector('input[data-testid="fileInput"]');
  const button = (label, root = document) =>
    [...root.querySelectorAll('[role=button],button')].find(b => (b.getAttribute('aria-label') || b.innerText || '').trim() === label);

  const draft = () => {
    const ed = composer();
    if (!ed) return null;
    const key = Object.keys(ed).find(k => k.startsWith('__reactFiber'));
    for (let f = ed[key]; f; f = f.return) {
      const p = f.memoizedProps;
      if (p && p.editorState && typeof p.onChange === 'function') return p;
    }
    return null;
  };
  const push = (fn, changeType = 'insert-fragment') => {
    const p = draft(), es = p.editorState, c = es.getCurrentContent();
    p.onChange(es.constructor.push(es, c.set('blockMap', fn(c.getBlockMap(), c)), changeType));
  };
  const newKey = () => Math.random().toString(36).slice(2, 7);
  // 生成 n 个无样式的字符元数据（从任意非空段落借一个，清掉样式和链接）
  const plainChars = (bm, n) => {
    const src = bm.find(b => b.getLength() > 0);
    if (!src) return null;
    const meta = src.getCharacterList().first().set('style', src.getCharacterList().first().getStyle().clear()).set('entity', null);
    let cl = src.getCharacterList().clear();
    for (let i = 0; i < n; i++) cl = cl.push(meta);
    return cl;
  };

  // 光标强制放到最后一块末尾（DOM selection 对 Draft 不可靠）
  const selectEnd = () => {
    const p = draft(), es = p.editorState, last = es.getCurrentContent().getLastBlock();
    const sel = es.getSelection().merge({
      anchorKey: last.getKey(), focusKey: last.getKey(),
      anchorOffset: last.getLength(), focusOffset: last.getLength(), isBackward: false, hasFocus: true,
    });
    p.onChange(es.constructor.forceSelection(es, sel));
  };
  // 末尾补一个空段落，保证图片插在独立的一行
  const appendEmpty = () => {
    const p = draft(), es = p.editorState, c = es.getCurrentContent(), last = c.getLastBlock();
    if (last.getType() === 'unstyled' && last.getText() === '') return;
    const key = newKey();
    const block = last.merge({ key, type: 'unstyled', text: '', depth: 0,
      characterList: last.getCharacterList().clear(), data: last.getData().clear() });
    const sel = es.getSelection().merge({ anchorKey: key, focusKey: key, anchorOffset: 0, focusOffset: 0, isBackward: false, hasFocus: true });
    const next = es.constructor.push(es, c.set('blockMap', c.getBlockMap().set(key, block)), 'split-block');
    p.onChange(es.constructor.forceSelection(next, sel));
  };
  const paste = (dt) => {
    selectEnd();
    setTimeout(() => {
      const ed = composer();
      ed.focus();
      ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, 150);
  };
  const fileFrom = ({ b64, name, mime }) => {
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new File([u], name, { type: mime });
  };
  const state = () => {
    const ed = composer();
    if (!ed) return { composer: false };
    const blocks = [...ed.querySelectorAll('[data-block="true"]')];
    return {
      composer: true,
      draftOk: !!draft(),
      blocks: blocks.length,
      imgs: ed.querySelectorAll('img').length,
      busy: !!document.querySelector('[role=progressbar]'),
      textBlocks: blocks.filter(b => b.innerText.trim()).length,
      hasCover: !!button('Remove photo'),
      dialogs: document.querySelectorAll('[role=dialog]').length,
      title: (titleBox() || {}).value || '',
      url: location.href,
    };
  };

  switch (cmd) {
    case 'state':
      return state();

    case 'setTitle': {
      const ta = titleBox();
      if (!ta) return { ok: false, error: '找不到标题输入框' };
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, arg);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true };
    }

    case 'pasteHTML': {
      // 先垫一个零宽占位段落：片段第一块会并入光标所在块并继承它的格式，占位块替真正的内容吃掉这次合并
      const html = `<p>${ZW}</p>` + arg;
      const dt = new DataTransfer();
      dt.setData('text/html', html);
      dt.setData('text/plain', html.replace(/<[^>]+>/g, '\n'));
      paste(dt);
      return { ok: true };
    }

    case 'pasteImage': {
      appendEmpty();
      const dt = new DataTransfer();
      dt.items.add(fileFrom(arg));
      setTimeout(() => paste(dt), 100);
      return { ok: true };
    }

    case 'setCover': {
      const rm = button('Remove photo');
      if (rm) rm.click();
      const inp = coverInput();
      if (!inp) return { ok: false, error: '找不到封面上传入口' };
      const dt = new DataTransfer();
      dt.items.add(fileFrom(arg));
      setTimeout(() => { inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); }, rm ? 600 : 0);
      return { ok: true };
    }

    case 'applyDialog': {
      // 封面若弹出裁剪框，确认应用
      const ds = [...document.querySelectorAll('[role=dialog]')];
      const d = ds[ds.length - 1];
      const b = d && button('Apply', d);
      if (b) { b.click(); return { ok: true, clicked: true }; }
      return { ok: true, clicked: false };
    }

    case 'cleanup': {
      // 去掉零宽占位字符和多余空段落（保留最后一块）
      let stripped = 0, removed = 0;
      push((bm) => {
        bm = bm.map((b) => {
          const t = b.getText();
          if (!t.includes(ZW)) return b;
          let cl = b.getCharacterList();
          for (let i = t.length - 1; i >= 0; i--) if (t[i] === ZW) { cl = cl.delete(i); stripped++; }
          return b.set('text', t.split(ZW).join('')).set('characterList', cl);
        });
        const lastKey = bm.last().getKey();
        return bm.filter((b, k) => {
          const drop = k !== lastKey && b.getType() === 'unstyled' && b.getText().trim() === '';
          if (drop) removed++;
          return !drop;
        });
      }, 'remove-range');
      return { ok: true, stripped, removed };
    }

    case 'texts': {
      const p = draft();
      return p.editorState.getCurrentContent().getBlocksAsArray().map(b => ({ key: b.getKey(), type: b.getType(), text: b.getText() }));
    }

    case 'insertBefore': {
      // 漏掉的段落补回原位：以下一段为锚点，在它前面插入一个同类型的新块（行内格式不保留）
      const { anchorKey, text, type } = arg;
      let done = false;
      push((bm) => {
        const anchor = bm.get(anchorKey);
        const cl = plainChars(bm, text.length);
        if (!anchor || !cl) return bm;
        const nb = anchor.merge({ key: newKey(), type: type || 'unstyled', text, characterList: cl, data: anchor.getData().clear(), depth: 0 });
        let out = bm.clear();
        bm.forEach((b, k) => { if (k === anchorKey) out = out.set(nb.getKey(), nb); out = out.set(k, b); });
        done = true;
        return out;
      });
      return { ok: done };
    }

    case 'appendText': {
      // 补在文末
      const { text, type } = arg;
      push((bm) => {
        const last = bm.last();
        const cl = plainChars(bm, text.length);
        if (!cl) return bm;
        const nb = last.merge({ key: newKey(), type: type || 'unstyled', text, characterList: cl, data: last.getData().clear(), depth: 0 });
        return bm.set(nb.getKey(), nb);
      });
      return { ok: true };
    }

    default:
      return { ok: false, error: `未知命令 ${cmd}` };
  }
}
