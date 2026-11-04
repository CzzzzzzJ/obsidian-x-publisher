// node tools/setfiles.mjs <tabId> <css 选择器> <文件绝对路径...>  —— 把本地文件交给页面里的 <input type=file>
import { call } from './cdp.mjs';
export async function setFiles(tabId, selector, files, index = 0) {
  const { root } = await call({ op: 'cdp', tabId, method: 'DOM.getDocument', params: { depth: -1, pierce: true } });
  const { nodeIds } = await call({ op: 'cdp', tabId, method: 'DOM.querySelectorAll', params: { nodeId: root.nodeId, selector } });
  if (!nodeIds.length) throw new Error(`找不到 ${selector}`);
  await call({ op: 'cdp', tabId, method: 'DOM.setFileInputFiles', params: { nodeId: nodeIds[index], files } });
  return nodeIds.length;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [tabId, sel, ...files] = process.argv.slice(2);
  console.log('inputs:', await setFiles(+tabId, sel, files));
}

// 用一段返回 <input type=file> 的 JS 表达式定位（可穿透 Shadow DOM），再设置文件
export async function setFilesByExpr(tabId, expr, files) {
  const r = await call({ op: 'cdp', tabId, method: 'Runtime.evaluate', params: { expression: expr } });
  if (!r.result || !r.result.objectId) throw new Error(`表达式没有返回元素：${expr}`);
  await call({ op: 'cdp', tabId, method: 'DOM.setFileInputFiles', params: { objectId: r.result.objectId, files } });
}
