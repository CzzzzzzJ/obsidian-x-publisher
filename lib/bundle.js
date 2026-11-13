// 一期视频的工程文件 publish.json：读取、校验。
// 工程目录在 NAS：/Volumes/<共享>/视频导出/<系列>/<期>/，里面放 成片.mp4、字幕.srt、封面/、publish.json。
// publish.json 里的文件路径都相对于这个目录。

import { specs as extraSpecs } from './platforms/extra-specs.js';

export const PLATFORMS = {
  bilibili: { name: 'B 站', fields: { title: [1, 80], desc: [0, 2000] }, tags: { max: 10, each: 20 }, links: true },
  xhs: { name: '小红书', fields: { title: [1, 20], body: [1, 1000] }, topics: true, links: false },
  douyin: { name: '抖音', fields: { title: [1, 30], body: [0, 1000] }, topics: true, maxTopics: 5, links: false },
  channels: { name: '视频号', fields: { shortTitle: [6, 16], body: [0, 1000] }, topics: true, links: false },
  youtube: { name: 'YouTube', fields: { title: [1, 100], desc: [0, 5000] }, tags: { total: 500 }, links: true, noAngle: true },
  x: { name: 'X', fields: { text: [1, 25000] }, links: true },
  ...extraSpecs,
};

// 小红书、抖音、视频号：不直接引流，最多说「整理成文档了，私信我」
const LEAD = /mdldm\.club|知识站|文档库|飞书|主页.{0,8}(搜|看|找)|评论区.{0,8}(链接|领|拿)|点链接|戳链接/;

export const len = (s) => [...(s || '')].length;

// X 的计数：中日韩字符算 2，链接一律算 23
export function xWeight(text) {
  let n = 0;
  const rest = text.replace(/https?:\/\/\S+/g, () => { n += 23; return ''; });
  for (const ch of rest) n += /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏＀-￯]|\p{Extended_Pictographic}/u.test(ch) ? 2 : 1;
  return n;
}

// 返回 { errors: [], warnings: [] }；files 是工程目录里存在的相对路径集合（由调用方提供）
export function validate(b, files = null) {
  const errors = [], warnings = [];
  const has = (p) => !files || files.has(p);
  if (b.version !== 1) errors.push(`不认识的 version：${b.version}`);
  if (!b.video) errors.push('缺少 video');
  else if (!has(b.video)) errors.push(`找不到视频：${b.video}`);
  for (const [k, p] of Object.entries(b.covers || {})) if (!has(p)) errors.push(`找不到封面 ${k}：${p}`);
  if (b.schedule) {
    const t = Date.parse(b.schedule), now = Date.now();
    if (isNaN(t)) errors.push(`定时发布时间看不懂：${b.schedule}（要写成 2026-11-05T18:00:00+08:00）`);
    else if (t < now + 2 * 3600e3) errors.push(`定时发布要晚于现在 2 小时以上：${b.schedule}`);
    else if (t > now + 14 * 86400e3) errors.push(`定时发布最多 14 天以内：${b.schedule}`);
  }

  for (const [id, p] of Object.entries(b.platforms || {})) {
    const spec = PLATFORMS[id];
    if (!spec) { warnings.push(`未知平台 ${id}，会跳过`); continue; }
    const tag = spec.name;
    if (p.skip) { warnings.push(`${tag}：跳过（${p.skip}）`); continue; }
    for (const c of p.covers || []) if (!(b.covers || {})[c]) errors.push(`${tag}：封面 ${c} 没有在 covers 里定义`);
    for (const [f, [min, max]] of Object.entries(spec.fields)) {
      const n = len(p[f]);
      if (n < min) errors.push(`${tag}：${f} ${n ? `只有 ${n} 字，至少 ${min} 字` : '为空'}`);
      if (n > max) errors.push(`${tag}：${f} ${n} 字，超过上限 ${max}`);
    }
    const all = Object.keys(spec.fields).map(f => p[f] || '').join('\n') + (p.topics || []).join(' ');
    if (!spec.links) {
      if (/https?:\/\/|www\.|\.(com|cn|club|net)\b/i.test(all)) errors.push(`${tag}：正文里有链接，这个平台不能放`);
      if (/(微信|vx|v信|wx)\s*[:：号]?\s*[A-Za-z][-_A-Za-z0-9]{5,}|加微/i.test(all)) errors.push(`${tag}：正文里有微信号，这个平台不能放`);
      else if (/微信/.test(all)) warnings.push(`${tag}：正文提到了「微信」，确认不是在引流`);
      const lead = all.match(LEAD);
      if (lead) errors.push(`${tag}：正文在引流（「${lead[0]}」），这个平台最多写「整理成文档了，私信我」`);
      // 国内短视频平台直接写模型名容易被限流/封禁：用 Agent、CC、AI 这类代称（2026-11-12 麦当）
      const model = all.match(/Claude|Codex|ChatGPT|GPT-?\d|Gemini|Anthropic|OpenAI|DeepSeek/i);
      if (model) errors.push(`${tag}：出现了模型/厂商名「${model[0]}」，这个平台要换成 Agent、CC、AI 这类代称`);
      // 「Grok Bot / GrokBot」是系列名，国内平台可以透出（2026-11-13 麦当，第 4 期小红书标题已用）；单独的「Grok」模型名只提醒
      const grok = all.replace(/Grok\s?Bot/gi, '').match(/Grok/i);
      if (grok) warnings.push(`${tag}：出现了单独的「Grok」，确认指的是 Grok Bot 而不是模型`);
    }
    // publish.json 的 requiredTags：每个带标签/话题的平台都必须有（例如账号名）
    // 长文平台引流到知识站：要落到转化页，不要用首页
    if (spec.links && /mdldm\.club\/?(\?\S*)?(?=\s|$)/m.test(all)) warnings.push(`${tag}：知识站链接用的是首页，建议换成转化页 https://www.mdldm.club/ai-course-promotion`);
    const list = p.tags || p.topics;
    if (list) for (const t of b.requiredTags || []) if (!list.includes(t)) errors.push(`${tag}：缺少「${t}」标签`);
    if (spec.maxTopics && (p.topics || []).length > spec.maxTopics) errors.push(`${tag}：话题 ${(p.topics || []).length} 个，最多 ${spec.maxTopics} 个（多出来的不会变成话题）`);
    if (spec.noAngle && /[<>]/.test(all)) errors.push(`${tag}：标题或简介里不能有 < 或 >`);
    if (spec.tags) {
      const t = p.tags || [];
      if (spec.tags.max && t.length > spec.tags.max) errors.push(`${tag}：标签 ${t.length} 个，最多 ${spec.tags.max} 个`);
      if (spec.tags.each) t.filter(x => len(x) > spec.tags.each).forEach(x => errors.push(`${tag}：标签「${x}」超过 ${spec.tags.each} 字`));
      if (spec.tags.total && t.join(',').length > spec.tags.total) errors.push(`${tag}：标签总长超过 ${spec.tags.total}`);
    }
    if (id === 'x') {
      const w = xWeight(p.text || '');
      if (w > 280) warnings.push(`X：正文按 X 规则计 ${w}，超过 280，需要 Premium 才能发`);
    }
  }
  return { errors, warnings };
}
