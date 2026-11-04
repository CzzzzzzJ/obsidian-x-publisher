// 开发桥接服务端：node tools/bridge-server.mjs
// 插件侧边栏 GET /poll 领命令、POST /result 交结果；开发者 POST /cmd 发命令并等结果。
import http from 'node:http';

const queue = [];          // 待领取的命令
const waiters = [];        // 正在长轮询的插件请求
const pending = new Map(); // id -> 等结果的 /cmd 响应
let seq = 0;

const send = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(obj === undefined ? '' : JSON.stringify(obj));
};
const body = (req) => new Promise(r => { let s = ''; req.on('data', d => s += d); req.on('end', () => r(s)); });

function dispatch() {
  while (queue.length && waiters.length) {
    const w = waiters.shift();
    clearTimeout(w.timer);
    send(w.res, 200, queue.shift());
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/poll') {
    const w = { res, timer: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); send(res, 204); }, 20000) };
    waiters.push(w); dispatch(); return;
  }
  if (req.method === 'POST' && url.pathname === '/result') {
    const r = JSON.parse(await body(req));
    const p = pending.get(r.id);
    if (p) { pending.delete(r.id); clearTimeout(p.timer); send(p.res, 200, r); }
    return send(res, 200, {});
  }
  if (req.method === 'POST' && url.pathname === '/cmd') {
    const cmd = JSON.parse(await body(req));
    cmd.id = ++seq;
    const timeout = cmd.timeout || 60000;
    pending.set(cmd.id, { res, timer: setTimeout(() => { pending.delete(cmd.id); send(res, 504, { ok: false, error: '插件没有响应（侧边栏开着吗？）' }); }, timeout) });
    queue.push(cmd); dispatch(); return;
  }
  if (url.pathname === '/status') return send(res, 200, { waiting: waiters.length, queued: queue.length });
  send(res, 404, {});
}).listen(8765, '127.0.0.1', () => console.log('bridge on 127.0.0.1:8765'));
