// node tools/ev.mjs <tabId> <脚本文件或表达式>  —— 在页面里执行并打印 JSON 结果
import { readFileSync, existsSync } from 'node:fs';
import { evaluate } from './cdp.mjs';
const [tabId, src] = [+process.argv[2], process.argv[3]];
const code = existsSync(src) ? readFileSync(src, 'utf8') : src;
console.log(JSON.stringify(await evaluate(tabId, code, 120000), null, 1));
