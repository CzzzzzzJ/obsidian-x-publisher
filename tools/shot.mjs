// node tools/shot.mjs <tabId> <out.png>  —— 切到该标签页并截图
import { writeFileSync } from 'node:fs';
import { call } from './cdp.mjs';
const [tabId, out] = [+process.argv[2], process.argv[3]];
await call({ op: 'activate', tabId });
await new Promise(r => setTimeout(r, 600));
const r = await call({ op: 'cdp', tabId, method: 'Page.captureScreenshot', params: { format: 'png' } });
writeFileSync(out, Buffer.from(r.data, 'base64'));
console.log(out);
