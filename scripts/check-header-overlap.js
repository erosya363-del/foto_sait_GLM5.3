// Проверка перекрытий в мобильной шапке на 320–430px
const { execSync } = require("child_process");

const WIDTHS = [320, 360, 375, 390, 414, 430];

async function checkWidth(w) {
  execSync(`agent-browser set viewport ${w} 800`, { stdio: "pipe" });
  execSync(`agent-browser reload`, { stdio: "pipe" });
  await new Promise((r) => setTimeout(r, 3000));
  const out = execSync(
    `agent-browser eval "(() => {
      const header = document.querySelector('header.glass');
      if (!header) return JSON.stringify({err: 'no header'});
      const els = { logo: header.querySelector('img'), title: header.querySelector('.font-display'), wh: header.querySelector('select'), theme: header.querySelector('[role=radiogroup]') };
      const boxes = {};
      for (const [k, el] of Object.entries(els)) { if (!el) { boxes[k] = null; continue; } const b = el.getBoundingClientRect(); boxes[k] = {x: Math.round(b.x), r: Math.round(b.right), y: Math.round(b.y), bot: Math.round(b.bottom)}; }
      const keys = Object.keys(boxes).filter(k => boxes[k]);
      let overlap = [];
      for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
        const a = boxes[keys[i]], b = boxes[keys[j]];
        if (a.x < b.r && b.x < a.r && a.y < b.bot && b.y < a.bot) overlap.push(keys[i] + '+' + keys[j]);
      }
      const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth;
      const headerH = Math.round(header.getBoundingClientRect().height);
      return JSON.stringify({w: ${w}, overlap, overflowX, headerH, boxes});
    })()"`,
    { stdio: "pipe" }
  ).toString();
  const json = out.slice(out.indexOf("{"));
  return JSON.parse(json);
}

(async () => {
  for (const w of WIDTHS) {
    const r = await checkWidth(w);
    console.log(JSON.stringify(r));
  }
})();
