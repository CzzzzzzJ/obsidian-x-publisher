// Obsidian Markdown → X 长文片段
// 输出：{ title, coverRef, segments: [{type:'html', html, texts:[{t, type}]}, {type:'image', ref}, {type:'video', ref}], warnings }
// 约定：
//   - frontmatter 里的 title / cover 优先
//   - 否则第一个 H1 作为标题；H1 之后、正文文字之前的第一张图作为封面
//   - 每一行非空文字是一个段落（与 X 长文的段落一致）

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;

function escapeHTML(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 行内语法 → HTML
export function inline(src) {
  const codes = [];
  let s = src.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = escapeHTML(s);
  s = s.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target.split('/').pop());
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/(^|[^"'>=])(https?:\/\/[^\s<，。；、）)]+)/g, '$1<a href="$2">$2</a>');
  s = s.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<strong>${a || b}</strong>`);
  s = s.replace(/==(.+?)==/g, '<strong>$1</strong>');
  s = s.replace(/~~(.+?)~~/g, '<s>$1</s>');
  s = s.replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_(?!\s)([^_]+?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => escapeHTML(codes[+i]));
  return s;
}

export function plainText(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// 单独一行的嵌入：![[a.png|300]] 或 ![alt](path)
function parseEmbed(line) {
  const t = line.trim();
  let m = t.match(/^!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
  if (m) return m[1].trim();
  m = t.match(/^!\[[^\]]*\]\(<?([^)>]+?)>?(?:\s+"[^"]*")?\)$/);
  if (m) return decodeURI(m[1].trim());
  return null;
}

function parseFrontmatter(text) {
  const fm = {};
  if (!text.startsWith('---')) return { fm, body: text };
  const end = text.indexOf('\n---', 3);
  if (end < 0) return { fm, body: text };
  for (const line of text.slice(3, end).split('\n')) {
    const m = line.match(/^([\w一-龥-]+):\s*(.*)$/);
    if (m) fm[m[1].trim().toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return { fm, body: text.slice(end + 4).replace(/^\n/, '') };
}

export function parseNote(raw) {
  const warnings = [];
  const { fm, body } = parseFrontmatter(raw.replace(/\r\n/g, '\n'));
  const text = body.replace(/%%[\s\S]*?%%/g, '').replace(/<!--[\s\S]*?-->/g, '');

  let title = fm.title || '';
  let coverRef = fm.cover ? (parseEmbed(fm.cover) || fm.cover.replace(/^\[\[|\]\]$/g, '')) : '';
  let titleFromH1 = !title;
  let sawContent = false;      // H1 之后是否已出现正文文字
  let afterTitle = !titleFromH1;

  const segments = [];
  let html = [], texts = [];
  let list = null;              // {tag, items:[]}
  let quote = null;             // [lines]
  let code = null;              // [lines]

  const flushList = () => {
    if (!list) return;
    html.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list.items.forEach(i => texts.push({ t: plainText(inline(i)), type: list.tag === 'ul' ? 'unordered-list-item' : 'ordered-list-item' }));
    list = null;
  };
  const flushQuote = () => {
    if (!quote) return;
    const lines = quote.filter(l => l.trim() !== '');
    let calloutTitle = null;
    if (lines.length && /^\[!\w+\][+-]?/.test(lines[0])) {
      calloutTitle = lines.shift().replace(/^\[!\w+\][+-]?\s*/, '');
    }
    const parts = [];
    if (calloutTitle) parts.push(`<strong>${inline(calloutTitle)}</strong>`);
    lines.forEach(l => parts.push(inline(l)));
    if (parts.length) {
      html.push(`<blockquote>${parts.join('<br>')}</blockquote>`);
      texts.push({ t: plainText(parts.join('\n')), type: 'blockquote' });
    }
    quote = null;
  };
  const flushHTML = () => {
    flushList(); flushQuote();
    if (html.length) segments.push({ type: 'html', html: html.join(''), texts: texts.filter(x => x.t) });
    html = []; texts = [];
  };
  const pushMedia = (ref) => {
    const isVideo = VIDEO_EXT.test(ref);
    if (!isVideo && !IMAGE_EXT.test(ref)) { warnings.push(`跳过不支持的嵌入：${ref}`); return; }
    if (!isVideo && !coverRef && afterTitle && !sawContent && titleFromH1) { coverRef = ref; return; }
    flushHTML();
    segments.push({ type: isVideo ? 'video' : 'image', ref });
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');

    // 标题取自 H1 时，H1 之前的内容（备注、清单）不进正文
    if (titleFromH1 && !title) {
      const h1 = line.match(/^#\s+(.*)$/);
      if (h1) { title = plainText(inline(h1[1])); afterTitle = true; }
      continue;
    }

    if (code) {
      if (/^```/.test(line.trim())) { html.push(`<pre>${escapeHTML(code.join('\n'))}</pre>`); texts.push({ t: code.join('\n'), type: 'code-block' }); code = null; }
      else code.push(rawLine);
      continue;
    }
    if (/^```/.test(line.trim())) { flushList(); flushQuote(); code = []; sawContent = true; continue; }

    if (!line.startsWith('>')) flushQuote();

    const embed = parseEmbed(line);
    if (embed) { flushList(); flushQuote(); pushMedia(embed); continue; }

    if (!line.trim()) { flushList(); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushList();
      if (h[1].length === 1 && titleFromH1 && !title) { title = plainText(inline(h[2])); afterTitle = true; continue; }
      const tag = h[1].length <= 2 ? 'h2' : 'h3';
      html.push(`<${tag}>${inline(h[2])}</${tag}>`); texts.push({ t: plainText(inline(h[2])), type: tag === 'h2' ? 'header-two' : 'header-three' });
      sawContent = true; continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { flushList(); continue; }   // 分割线：X 长文用段落间距代替

    if (line.startsWith('>')) {
      flushList(); (quote = quote || []).push(line.replace(/^>\s?/, '')); sawContent = true; continue;
    }
    let m = line.match(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/);
    if (m) {
      if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
      list.items.push(m[1]); sawContent = true; continue;
    }
    m = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (m) {
      if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
      list.items.push(m[1]); sawContent = true; continue;
    }
    flushList();
    // 段落里夹带的图片拆成独立片段
    const inlineEmbeds = [...line.matchAll(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]|!\[[^\]]*\]\(([^)]+)\)/g)];
    if (inlineEmbeds.length) {
      let rest = line;
      for (const e of inlineEmbeds) {
        const [before, after] = rest.split(e[0]);
        if (before.trim()) { html.push(`<p>${inline(before.trim())}</p>`); texts.push({ t: plainText(inline(before.trim())), type: 'unstyled' }); sawContent = true; }
        pushMedia((e[1] || e[2]).trim());
        rest = after || '';
      }
      if (rest.trim()) { html.push(`<p>${inline(rest.trim())}</p>`); texts.push({ t: plainText(inline(rest.trim())), type: 'unstyled' }); sawContent = true; }
      continue;
    }
    html.push(`<p>${inline(line.trim())}</p>`); texts.push({ t: plainText(inline(line.trim())), type: 'unstyled' });
    sawContent = true;
  }
  if (code) { html.push(`<pre>${escapeHTML(code.join('\n'))}</pre>`); texts.push({ t: code.join('\n'), type: 'code-block' }); }
  flushHTML();

  if (!title) warnings.push('没有找到标题（H1 或 frontmatter title）');
  return { title, coverRef, segments, warnings };
}
