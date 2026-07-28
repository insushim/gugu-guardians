import './style.css';
import { mount } from './ui/dom';
import { loadAll } from './render/assets';
import { installUnlockHooks } from './render/audio';
import { buildBattle, type BattleResult } from './ui/battle';
import {
  menuScreen, mapScreen, prepScreen, gateScreen, resultScreen,
  codexScreen, srsScreen, reportScreen, settingsScreen, type ResultPayload,
} from './ui/screens';
import * as store from './save/store';
import { weekKey, today } from './edu/date';

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

function go(screen: string, payload?: unknown): void {
  switch (screen) {
    case 'menu':
      mount(root, () => menuScreen(go));
      break;
    case 'map':
      mount(root, () => mapScreen(go));
      break;
    case 'prep':
      mount(root, () => prepScreen(go, Number(payload)));
      break;
    case 'battle': {
      const p = payload as { stage: number; deck: string[] };
      mount(root, () => buildBattle(p.stage, p.deck, (r: BattleResult) => {
        snapshotWeekly();
        // 이겼을 때만 봉인 해제(관문)로 간다. 졌으면 바로 결과 — 학습은 이미 전투 중에 했다.
        if (r.status === 'win') go('gate', r);
        else go('result', { ...r, starN: 0, gateCorrect: 0, gateTotal: 5 });
      }));
      break;
    }
    case 'gate':
      mount(root, () => gateScreen(go, payload as BattleResult));
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
    case 'settings':
      mount(root, () => settingsScreen(go));
      break;
    default:
      mount(root, () => menuScreen(go));
  }
  window.__gugu__ = { ...(window.__gugu__ ?? {}), screen, ready: true };
}

async function boot(): Promise<void> {
  applySettings();
  installUnlockHooks();   // 🔴 첫 사용자 입력에서 AudioContext 언락 (없으면 배포 후 무음)
  const bar = document.createElement('div');
  bar.className = 'boot';
  bar.textContent = '셈나라를 여는 중… 0%';
  root.replaceChildren(bar);

  await loadAll((done, total) => {
    bar.textContent = `셈나라를 여는 중… ${Math.round((done / total) * 100)}%`;
  });

  snapshotWeekly();
  go('menu');
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

boot().catch((e: unknown) => {
  root.replaceChildren();
  const msg = document.createElement('div');
  msg.className = 'boot';
  msg.textContent = '문제가 생겼어요. 새로고침해 주세요.';
  root.append(msg);
  console.error('[gugu] boot 실패', e);
});
