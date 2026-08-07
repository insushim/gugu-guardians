#!/usr/bin/env node
/**
 * 자동 전체화면 게이트 — 실제 브라우저에서 **언제 부르고 언제 안 부르는지**를 잰다.
 *
 * 🔴 왜 "전체화면이 됐나"가 아니라 "requestFullscreen 을 불렀나"를 보는가:
 *    헤드리스 크롬은 실제 전체화면 전환을 신뢰할 수 없게 처리한다(창 관리자가 없다).
 *    그래서 결과가 아니라 **호출 여부**를 가로챈다. 이 게이트가 지켜야 하는 건
 *    "브라우저가 전체화면을 지원하는가"(그건 브라우저 몫)가 아니라
 *    **"우리 판단 조건이 맞는가"** — 손가락 기기·가로·휴대폰 크기일 때만 불러야 한다.
 *    마우스 달린 기기에서 페이지가 제멋대로 전체화면이 되면 그건 고장으로 읽힌다.
 *
 * 🔴 그리고 **사용자 제스처 안에서** 불러야 한다. 방향 전환 이벤트에서 부르면 브라우저가
 *    거부한다 — 그 실패는 콘솔에도 잘 안 남아서, 실기기에서 "왜 안 되지"로만 나타난다.
 *    그래서 '탭 없이 회전만 했을 때는 호출이 없어야 한다'도 함께 검사한다.
 *
 * 실행: node tools/fullscreen-check.mjs   (개발 서버가 5183 에 떠 있어야 한다)
 */
import puppeteer from 'puppeteer';

const APP = process.env['GUGU_APP'] ?? 'http://localhost:5183/';

/** [이름, 폭, 높이, 손가락기기, 눌렀을 때 전체화면을 요청해야 하는가] */
const CASES = [
  ['휴대폰 가로 (iPhone 14)', 844, 390, true, true],
  ['휴대폰 가로 (안드로이드)', 800, 360, true, true],
  ['휴대폰 세로', 390, 844, true, false],       // 세로는 회전 안내가 뜬다
  /**
   * 🔴 **이 줄이 '가로' 조건을 실제로 검사하는 유일한 케이스다.** 보통 휴대폰 세로(390×844)는
   *    높이 조건(≤700)에 먼저 걸려서, 가로 검사를 지워도 통과한다(변이로 확인).
   *    아이폰 SE 세로는 667 이라 높이 조건을 **통과**하므로 가로 검사만이 이걸 막는다.
   *    막아야 하는 이유: 세로에서는 "기기를 가로로 돌려 주세요" 안내가 떠 있다 —
   *    그 화면을 전체화면으로 만들면 안내만 꽉 찬 채 아무것도 못 하게 된다.
   */
  ['작은 휴대폰 세로 (iPhone SE)', 375, 667, true, false],
  ['데스크톱 (마우스)', 1280, 720, false, false],
  /**
   * 🔴 **이 줄이 포인터 조건을 실제로 검사하는 유일한 케이스다.** 1280×720 데스크톱은
   *    높이 조건(≤700)에 먼저 걸려서, 포인터 검사를 지워도 그대로 통과한다(변이로 확인).
   *    즉 그 케이스만으로는 "마우스 기기 제외"가 검증되지 않는다 — 두 조건을 갈라야 한다.
   *    실사용 상황이기도 하다: 노트북에서 창을 작게 띄운 선생님의 화면을 빼앗으면 안 된다.
   */
  ['작은 창 데스크톱 (마우스)', 1100, 600, false, false],
  ['전자칠판·태블릿 가로', 1194, 834, true, false], // 크다 — 교실 화면을 빼앗지 않는다
];

const browser = await puppeteer.launch({ headless: 'new' });
const fails = [];
console.log(`\n=== 자동 전체화면 게이트 (${APP}) ===\n`);

/** requestFullscreen 을 가로채고, 호출되면 window.__fsCalls 를 올린다 */
const SPY = () => {
  window.__fsCalls = 0;
  const proto = Element.prototype;
  const orig = proto.requestFullscreen;
  proto.requestFullscreen = function (...args) {
    window.__fsCalls = (window.__fsCalls ?? 0) + 1;
    // 🔴 실제로 넘기지 않는다 — 헤드리스에서 상태가 바뀌면 뒤이은 판단이 흔들린다.
    //    우리가 재는 건 호출 여부다.
    void orig; void args;
    return Promise.resolve();
  };
};

for (const [name, w, h, touch, want] of CASES) {
  const page = await browser.newPage();
  // 🔴 `emulateMediaFeatures({name:'pointer'})` 는 퍼피티어가 지원하지 않는다.
  //    대신 모바일 에뮬레이션을 켜면 크롬이 실제로 `pointer: coarse` 를 보고한다
  //    (실측: isMobile+hasTouch → coarse true/fine false, 끄면 정반대). 스텁 없이 진짜 조건이다.
  await page.setViewport({ width: w, height: h, hasTouch: touch, isMobile: touch });
  await page.evaluateOnNewDocument(SPY);
  try {
    await page.goto(APP, { waitUntil: 'networkidle2' });
    await page.waitForFunction('window.__gugu__?.ready', { timeout: 15000 });

    // ① 아무것도 안 눌렀을 때는 절대 호출이 없어야 한다(제스처 밖 호출은 브라우저가 거부한다)
    const before = await page.evaluate(() => window.__fsCalls ?? 0);
    if (before !== 0) fails.push(`${name}: 터치 전에 ${before}회 호출 — 제스처 밖 호출은 거부된다`);

    // ② 화면을 한 번 누른다
    await page.mouse.click(Math.round(w / 2), Math.round(h / 2));
    await new Promise((r) => setTimeout(r, 250));
    const after = await page.evaluate(() => window.__fsCalls ?? 0);

    const ok = want ? after > 0 : after === 0;
    console.log(`${ok ? '✅' : '❌'} ${name} ${w}×${h} ${touch ? '터치' : '마우스'}`
      + ` — 터치 후 호출 ${after}회 (기대 ${want ? '≥1' : '0'})`);
    if (!ok) {
      fails.push(`${name}: 터치 후 호출 ${after}회, 기대 ${want ? '≥1' : '0'}`);
    }
  } catch (e) {
    fails.push(`${name}: 실행 실패 — ${String(e).split('\n')[0]}`);
    console.log(`❌ ${name} — 실행 실패`);
  }
  await page.close();
}

/**
 * 사용자가 스스로 나간 전체화면을 다시 붙잡지 않는가.
 * 🔴 이게 없으면 아이가 뒤로가기 제스처로 나갈 때마다 다음 터치에 도로 끌려 들어가
 *    기기를 빼앗긴 느낌이 된다.
 */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390, hasTouch: true, isMobile: true });
  await page.evaluateOnNewDocument(SPY);
  try {
    await page.goto(APP, { waitUntil: 'networkidle2' });
    await page.waitForFunction('window.__gugu__?.ready', { timeout: 15000 });
    await page.mouse.click(400, 200);
    await new Promise((r) => setTimeout(r, 200));
    const first = await page.evaluate(() => window.__fsCalls ?? 0);

    // 사용자가 나간 상황을 흉내낸다 — 앱은 fullscreenchange 로만 이걸 안다
    await page.evaluate(() => document.dispatchEvent(new Event('fullscreenchange')));
    await page.mouse.click(400, 220);
    await new Promise((r) => setTimeout(r, 200));
    const second = await page.evaluate(() => window.__fsCalls ?? 0);

    const ok = second === first;
    console.log(`${ok ? '✅' : '❌'} 사용자가 나간 뒤에는 다시 안 붙잡는다`
      + ` — 나가기 전 ${first}회 · 나간 뒤 터치해도 ${second}회`);
    if (!ok) fails.push(`사용자 이탈 후 재진입: ${first} → ${second}회 (다시 붙잡았다)`);
  } catch (e) {
    fails.push(`사용자 이탈 검사 실패 — ${String(e).split('\n')[0]}`);
  }
  await page.close();
}

await browser.close();
if (fails.length === 0) console.log('\n✅ 전 항목 통과\n');
else { console.log(`\n❌ ${fails.length}건 실패:`); fails.forEach((f) => console.log('  - ' + f)); console.log(''); }
process.exit(fails.length ? 1 : 0);
