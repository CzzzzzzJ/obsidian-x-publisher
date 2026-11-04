// node tools/click.mjs <tabId> <可见文字>  —— 点击文字完全等于它的最后一个可见元素
import { evaluate } from './cdp.mjs';
export const clickText = (tabId, text) => evaluate(tabId, `(()=>{const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;const hits=[];
while((n=w.nextNode())) if(n.nodeValue.trim()===${JSON.stringify(text)}) hits.push(n.parentElement);
const vis=hits.filter(e=>e.getClientRects().length); if(vis.length) vis.at(-1).click();
return vis.map(e=>e.tagName+'.'+e.className);})()`);
if (import.meta.url === `file://${process.argv[1]}`) console.log(await clickText(+process.argv[2], process.argv[3]));
