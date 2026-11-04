// 开发用命令行：node tools/cdp.mjs '<json 命令>'
//   node tools/cdp.mjs '{"op":"tabs"}'
//   node tools/cdp.mjs '{"op":"cdp","tabId":1,"method":"Runtime.evaluate","params":{"expression":"document.title","returnByValue":true}}'
// 也可以 import { call, evaluate } 在脚本里用。
export async function call(cmd) {
  const r = await fetch('http://127.0.0.1:8765/cmd', { method: 'POST', body: JSON.stringify(cmd) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error);
  return j.result;
}

// 在页面里执行表达式（可 await），返回值按 JSON 取回
export async function evaluate(tabId, expression, timeout) {
  const r = await call({ op: 'cdp', tabId, method: 'Runtime.evaluate', timeout,
    params: { expression, returnByValue: true, awaitPromise: true, userGesture: true } });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await call(JSON.parse(process.argv[2])), null, 1));
}
