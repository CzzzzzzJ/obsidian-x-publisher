// 麦田吉祥物「麦苗」：像素小苗，ear=1 时长出麦穗。和宣传片里同一套像素格
function maimiao({ px = 8, ear = 0, eyes = 'n', flip = false } = {}) {
  const PAL = { B: '#F2B21B', D: '#C98B0B', L: '#5DBB46', S: '#3E8E2F', K: '#2A2622', F: '#C98B0B', E: '#E9A21A' };
  const leaf = ['....L..LL...', '..LLL.LLLL..', '.LLL..L.LL..', '.....SS.....'];
  const earR = ['.....EE.....', '....EEEE....', '...EE.EE....', '....EEEE....', '...EE.EE....', '....EEEE....', '.....SS.....', '..LL.SS.LL..'];
  const BODY = ['...BBBBBB...', '..BBBBBBBB..', '.BBBBBBBBBB.', '.BBBBBBBBBB.', '.BBBBBBBBBB.', '.BBBBBBBBBB.', '..DDDDDDDD..'];
  const top = ear ? earR : leaf, P = [];
  top.forEach((r, y) => [...r].forEach((c, x) => c !== '.' && P.push([x, y, c])));
  const o = top.length;
  BODY.forEach((r, y) => [...r].forEach((c, x) => c !== '.' && P.push([x, y + o, c])));
  const E = { n: [[3, 2], [3, 3], [8, 2], [8, 3]], happy: [[2, 3], [3, 2], [4, 3], [7, 3], [8, 2], [9, 3]] }[eyes];
  E.forEach(([x, y]) => P.push([x, y + o, 'K']));
  [[3, 2], [8, 2]].forEach(([x, h]) => { for (let r = 0; r < h; r++) P.push([x, o + BODY.length + r, 'F']); });
  const H = o + BODY.length + 2;
  return `<svg viewBox="0 0 12 ${H}" width="${12 * px}" height="${H * px}" shape-rendering="crispEdges">${P.map(([x, y, c]) => `<rect x="${flip ? 11 - x : x}" y="${y}" width="1.04" height="1.04" fill="${PAL[c]}"/>`).join('')}</svg>`;
}
document.querySelectorAll('[data-mm]').forEach(el => el.innerHTML = maimiao(JSON.parse(el.dataset.mm || '{}')));
