// 适配器共用的小工具
import { evaluate, insertText, sleep } from '../cdp.js';

// 富文本编辑器里输入「#话题」，从联想列表里点「完全同名」的那一项；没有同名就保留成普通文字并记一条提示。
// itemsExpr：返回联想项元素数组的表达式
export async function pickTopics(ctx, topics, itemsExpr) {
  const picked = [], plain = [];
  for (const t of topics) {
    await insertText(ctx.tabId, '#' + t);
    // 联想列表会滞后刷新：一直等到出现同名项，最多 4 秒
    let hit = 'none';
    for (let i = 0; i < 8 && hit !== 'picked'; i++) {
      await sleep(500);
      hit = await evaluate(ctx.tabId, `(()=>{const it=${itemsExpr}.filter(e=>e.getClientRects().length);
        const h=it.find(e=>e.innerText.split('\\n')[0].trim()==='#'+${JSON.stringify(t)}); if(h){h.click(); return 'picked'}
        return it.length ? 'nomatch' : 'none'})()`);
    }
    if (hit === 'picked') picked.push(t);
    else { plain.push(t); await insertText(ctx.tabId, ' '); }
    await sleep(400);
  }
  if (plain.length) ctx.note(`没有同名话题，保留为普通文字：${plain.join('、')}`);
  return picked;
}

// 读回标题，和期望不一致就报异常
export async function checkTitle(ctx, expr, expected, label = '标题') {
  const got = await evaluate(ctx.tabId, expr);
  if ((got || '').trim() !== expected.trim()) ctx.fail(`${label}异常：期望「${expected}」，页面上是「${got || '空'}」`);
  else ctx.log(`${label}：${expected}`);
}

// 定时发布时间（ISO，带时区）→ 北京时间的各个字段
export function bjTime(iso) {
  const d = new Date(Date.parse(iso) + 8 * 3600e3);
  const p = (n) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate(), hh = d.getUTCHours(), mm = d.getUTCMinutes();
  return { y, m, d: day, hh, mm, ymd: `${y}-${p(m)}-${p(day)}`, hm: `${p(hh)}:${p(mm)}`, text: `${y}-${p(m)}-${p(day)} ${p(hh)}:${p(mm)}` };
}
