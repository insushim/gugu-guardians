import './style.css';
import { mount } from './ui/dom';
import { loadAll } from './render/assets';
import { installUnlockHooks, playBgm } from './render/audio';
import { buildBattle, type BattleResult } from './ui/battle';
import {
  menuScreen, mapScreen, prepScreen, gateScreen, resultScreen, summonScreen,
  codexScreen, srsScreen, reportScreen, settingsScreen, boardScreen,
  type ResultPayload, type GatePayload,
} from './ui/screens';
import { armAutoFullscreen } from './ui/fullscreen';
import { matchInk } from './sim/economy';
import { bump, rollDaily } from './meta/daily';
import * as store from './save/store';
import { submitScore } from './net/board';
import { initAap, aapState } from './net/aap';
import { showAapBadge } from './ui/aapBadge';
import { weekKey, today } from './edu/date';
import { stageDef } from './sim/stages';

/**
 * 구구성 수호대 — 부트스트랩 & 화면 라우터.
 * 로그인·서버 없음. 모든 기록은 이 기기 localStorage 에만 남는다.
 */

const root = document.getElementById('app')!;

// QA/E2E 훅 — 🔴 `window.game`은 DOM id에 점유될 수 있어 고유 키를 쓴다
declare global {
  interface Window { __gugu__?: Record<string, unknown> }
}

function applySettings(): void {
  const d = store.load();
  document.documentElement.style.setProperty('--fs', String(d.settings.fontScale));
}

/** 주 1회 θ 스냅샷 — 리포트의 "4주 변화"를 계산하려면 시계열이 필요하다 */
function snapshotWeekly(): void {
  store.update((d) => {
    const wk = weekKey(today());
    const last = d.edu.thetaWeekly[d.edu.thetaWeekly.length - 1];
    if (last?.week === wk) { last.theta = { ...d.edu.theta }; return; }
    d.edu.thetaWeekly.push({ week: wk, theta: { ...d.edu.theta } });
    if (d.edu.thetaWeekly.length > 52) d.edu.thetaWeekly.shift();
  });
}

/**
 * 화면 → 음악. 전투만 곡이 바뀌고 나머지는 같은 곡을 이어 튼다
 * (화면을 옮길 때마다 음악이 끊기면 산만하다 — `playBgm` 이 같은 곡이면 아무 일도 안 한다).
 */
function bgmFor(screen: string, payload?: unknown): void {
  if (screen === 'battle') {
    const stage = (payload as { stage?: number } | undefined)?.stage ?? 1;
    playBgm(stageDef(stage).boss || stageDef(stage).endless ? 'boss' : 'battle');
    return;
  }
  playBgm('field');
}

function go(screen: string, payload?: unknown): void {
  bgmFor(screen, payload);
  switch (screen) {
    case 'menu':
      mount(root, () => menuScreen(go));
      break;
    case 'map':
      mount(root, () => mapScreen(go, payload));
      break;
    case 'summon':
      mount(root, () => summonScreen(go));
      break;
    case 'prep':
      mount(root, () => prepScreen(go, Number(payload)));
      break;
    case 'battle': {
      const p = payload as { stage: number; deck: string[] };
      mount(root, () => buildBattle(p.stage, p.deck, (r: BattleResult) => {
        snapshotWeekly();
        // 순위 갱신은 동의했을 때만 나가고, 실패해도 조용히 넘어간다(게임을 막지 않는다)
        void submitScore();
        /**
         * 🔴 **판 보상은 승패와 무관하게 여기서 준다.** 관문(gate)은 이겨야 가는 곳이라
         *    거기서만 주면 패배가 보상 0 이 되고, 그러면 막힌 아이는 전력을 올릴 방법이
         *    영영 없다(순환). 맞힌 문제 수만큼 주므로 **진 판도 공부한 만큼은 남는다.**
         */
        const ink = matchInk(r.correct, r.stage);
        if (ink > 0) store.update((d) => { d.currency.meokmul += ink; });
        /**
         * 오늘의 임무 진행도 — **이기든 지든** 올린다. 판 보상과 같은 이유다:
         * 막힌 아이에게도 오늘 할 것이 끝나야 한다. 'clear'(길 깨기)만 승리 조건이다.
         */
        store.update((d) => {
          let s = rollDaily(d.daily);
          s = bump(s, 'play', 1);
          s = bump(s, 'correct', r.correct);
          s = bump(s, 'combo', r.maxCombo);
          s = bump(s, 'fast', r.fastCorrect);
          s = bump(s, 'srs', r.srsAdvanced);
          if (r.status === 'win') s = bump(s, 'clear', 1);
          d.daily = s;
        });
        // 이겼을 때만 봉인 해제(관문)로 간다. 졌으면 바로 결과 — 학습은 이미 전투 중에 했다.
        if (r.status === 'win') go('gate', { ...r, matchInk: ink });
        else go('result', { ...r, starN: 0, gateCorrect: 0, gateTotal: 5, matchInk: ink });
      }));
      break;
    }
    case 'gate':
      mount(root, () => gateScreen(go, payload as GatePayload));
      break;
    case 'result':
      mount(root, () => resultScreen(go, payload as ResultPayload));
      break;
    case 'codex':
      mount(root, () => codexScreen(go));
      break;
    case 'srs':
      mount(root, () => srsScreen(go));
      break;
    case 'report':
      mount(root, () => reportScreen(go));
      break;
    case 'board':
      mount(root, () => boardScreen(go));
      break;
    case 'settings':
      mount(root, () => settingsScreen(go));
      break;
    default:
      mount(root, () => menuScreen(go));
  }
  window.__gugu__ = { ...(window.__gugu__ ?? {}), screen, ready: true, aap: aapState() };
}

async function boot(): Promise<void> {
  applySettings();
  installUnlockHooks();   // 🔴 첫 사용자 입력에서 AudioContext 언락 (없으면 배포 후 무음)

  // 🚪 알찬에서 넘어왔다면 신원을 받는다. **에셋 로딩과 나란히 돌린다** —
  //    이걸 기다리느라 게임 시작이 늦어지면 안 된다(로그인 없는 게임이라는 성질을 지킨다).
  //    ⚠️ `initAap` 은 절대 던지지 않는다(안에서 다 잡는다). 그래도 방어를 한 겹 더 둔다 —
  //       여기서 던지면 boot 의 catch 가 물어 **게임 전체가 "문제가 생겼어요"로 죽는다.**
  const identity = initAap().catch(() => undefined);

  const bar = document.createElement('div');
  bar.className = 'boot';
  bar.textContent = '셈나라를 여는 중… 0%';
  root.replaceChildren(bar);

  await loadAll((done, total) => {
    bar.textContent = `셈나라를 여는 중… ${Math.round((done / total) * 100)}%`;
  });

  snapshotWeekly();
  go('menu');

  // 🔴 **신원을 기다리지 않는다.** 처음엔 여기서 `await identity` 를 했는데, 그러면 바로 위
  //    주석("게임 시작이 늦어지면 안 된다")과 코드가 정면으로 어긋난다 — 에셋이 다 받아져
  //    진행바가 100% 를 찍어도 화면은 신원이 올 때까지 멈춰 있다. 최악은 discovery·JWKS
  //    두 번(회전 시 세 번) 왕복 × 5초 상한이라 학교망에서 체감 프리징이 된다.
  //    (2026-08-22 Gemini 레인 — **내가 쓴 주석이 내 코드를 고발했다.**)
  //    배지는 늦게 붙어도 아무 문제가 없다. 메뉴가 늦게 뜨는 것만 문제다.
  void identity.then(() => {
    showAapBadge(aapState());
    // QA/E2E 훅도 같이 갱신한다 — `go()` 안에서만 쓰면 신원이 늦게 와도 화면 전환 전까지
    // 옛 값(`none`)이 남아, 자동화가 "연결 안 됨"으로 오독한다.
    window.__gugu__ = { ...(window.__gugu__ ?? {}), aap: aapState() };
  });
}

// 가로 모드 안내 — 세로에서는 힌트를 띄운다(CSS가 landscape에서 자동으로 숨긴다)
const rotate = document.getElementById('rotate-hint');
function syncRotate(): void {
  if (!rotate) return;
  rotate.hidden = window.innerWidth >= window.innerHeight;
}
window.addEventListener('resize', syncRotate);
window.addEventListener('orientationchange', syncRotate);
syncRotate();

// 가로로 돌린 휴대폰은 첫 터치에 전체화면으로 — 왜 '첫 터치'인지는 모듈 머리말 참고
armAutoFullscreen();

boot().catch((e: unknown) => {
  root.replaceChildren();
  const msg = document.createElement('div');
  msg.className = 'boot';
  msg.textContent = '문제가 생겼어요. 새로고침해 주세요.';
  root.append(msg);
  console.error('[gugu] boot 실패', e);
});
