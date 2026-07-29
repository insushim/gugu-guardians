import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: 'shell', args: ['--disable-gpu','--disable-gpu-compositing','--disable-accelerated-2d-canvas','--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 720 });
const errs = [];
p.on('console', m => m.type()==='error' && errs.push(m.text()));
p.on('pageerror', e => errs.push('pageerror: '+e.message));
await p.goto('http://localhost:5184/', { waitUntil: 'networkidle2' });
await p.waitForFunction('window.__gugu__?.ready');
// 먹물을 넉넉히 넣고 새로고침 (소환 연출 확인용)
await p.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('gugu:save'));
  raw.data.currency.meokmul = 9000;
  localStorage.setItem('gugu:save', JSON.stringify(raw));
});
await p.reload({ waitUntil: 'networkidle2' });
await p.waitForFunction('window.__gugu__?.ready');
const click = async (t) => {
  const h = await p.evaluateHandle((x) => [...document.querySelectorAll('button')].find(b=>b.textContent?.includes(x)) ?? null, t);
  const e = h.asElement(); if (!e) return false;
  const bb = await e.boundingBox(); if (!bb) return false;
  await p.mouse.click(bb.x+bb.width*0.6, bb.y+bb.height*0.6); return true;
};
console.log('소환 화면:', await click('셈지기 소환'));
await new Promise(r=>setTimeout(r,500));
await p.screenshot({ path: 'screenshots/v2-5-summon.png' });
console.log('10연:', await click('열 번 소환'));
await new Promise(r=>setTimeout(r,3200));
await p.screenshot({ path: 'screenshots/v2-6-summon-result.png' });
const got = await p.evaluate(() => ({
  cards: document.querySelectorAll('.summon-stage .ucard').length,
  owned: Object.keys(JSON.parse(localStorage.getItem('gugu:save')).data.roster).length,
  ink: JSON.parse(localStorage.getItem('gugu:save')).data.currency.meokmul,
}));
console.log('결과:', JSON.stringify(got));
console.log('뒤로:', await click('뒤로'));
await new Promise(r=>setTimeout(r,400));
console.log('도감:', await click('셈지기 도감'));
await new Promise(r=>setTimeout(r,700));
await p.screenshot({ path: 'screenshots/v2-7-codex.png', fullPage: false });
console.log('에러:', errs.slice(0,5));
await b.close();
