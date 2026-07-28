import { el, btn, stars, type Teardown } from './dom';
import * as store from '../save/store';
import { ALLIES, DECK_SIZE, defaultDeck, unlockedAllies } from '../sim/units';
import { ALL_STAGES, CHALLENGE_STAGE, REQUIRED_STAGES, stageDef } from '../sim/stages';
import { TYPE_BY_ID, type QType } from '../edu/curriculum';
import { QuizSession } from '../edu/session';
import { buildChoices } from '../edu/distractor';
import { makeRng, type Question } from '../edu/generator';
import { assetUrl } from '../render/assets';
import { play } from '../render/audio';
import { accuracy, automaticity, questionDensity, retention, thetaDelta, thetaDisplayable, weakTypes } from '../edu/stats';
import type { BattleResult } from './battle';

type Go = (screen: string, payload?: unknown) => void;

const UNLOCK_COST = [40, 70, 110, 150, 200, 260];

function topbar(title: string, go: Go, back = 'menu'): HTMLElement {
  return el('div', { class: 'topbar' },
    btn('← 뒤로', () => go(back), 'btn sm ghost'),
    el('h1', {}, title),
    el('span', { class: 'spacer' }),
    el('span', { class: 'muted' }, `먹물 ${store.load().currency.meokmul}`),
  );
}

// ── 메인 메뉴 ────────────────────────────────────────────────────────────
export function menuScreen(go: Go): { node: HTMLElement } {
  const d = store.load();
  const cleared = Object.keys(d.progress.cleared).length;
  const node = el('section', { class: 'screen' },
    el('div', { class: 'pane menu' },
      el('div', { class: 'logo' }, '구구성 수호대'),
      el('div', { class: 'tag' }, '계산이 빨라질수록 내 군대가 강해진다'),
      el('div', { class: 'row' },
        btn(cleared ? '이어서 하기' : '시작하기', () => go('map'), 'btn ju'),
        btn('셈지기 도감', () => go('codex')),
        btn('엉킴 봉인', () => go('srs')),
      ),
      el('div', { class: 'row' },
        btn('내 기록', () => go('report'), 'btn nok'),
        btn('설정', () => go('settings'), 'btn ghost'),
      ),
      el('p', { class: 'muted' }, '로그인 없이 바로 즐길 수 있어요. 기록은 이 기기에만 저장돼요.'),
    ),
  );
  return { node };
}

// ── 셈나라 지도 ──────────────────────────────────────────────────────────
export function mapScreen(go: Go): { node: HTMLElement } {
  const d = store.load();
  const grid = el('div', { class: 'map-grid' });
  for (const s of ALL_STAGES) {
    const starN = d.progress.cleared[String(s.index)] ?? 0;
    const prevCleared = s.index === 1 || (d.progress.cleared[String(s.index - 1)] ?? 0) > 0;
    const locked = s.index === CHALLENGE_STAGE
      ? (d.progress.cleared[String(REQUIRED_STAGES)] ?? 0) === 0
      : !prevCleared;
    const types = s.quizTypes.map((t) => TYPE_BY_ID.get(t)?.label ?? t).join(' · ');
    const b = el('button', { class: `node${s.challenge ? ' challenge' : ''}`, type: 'button' },
      el('span', { class: 'n' }, `${s.challenge ? '도전' : s.index} ${s.name}`),
      el('span', { class: 'stars' }, starN ? stars(starN) : (locked ? '🔒' : '　')),
      el('span', { class: 'types' }, types),
    );
    b.disabled = locked;
    b.addEventListener('click', () => go('prep', s.index));
    grid.append(b);
  }
  const node = el('section', { class: 'screen' },
    topbar('셈나라 지도', go),
    el('div', { class: 'pane' },
      el('p', { class: 'muted' }, '앞 단계를 한 번이라도 깨면 다음 길이 열려요. 도전 단계는 안 깨도 진도에 지장 없어요.'),
      grid,
    ),
  );
  return { node };
}

// ── 출전 준비 ────────────────────────────────────────────────────────────
export function prepScreen(go: Go, stageIndex: number): { node: HTMLElement } {
  const d = store.load();
  const stage = stageDef(stageIndex);
  const available = unlockedAllies(stageIndex).filter((u) => d.codex.unlocked.includes(u.id));
  let picked = (d.deck.length ? d.deck : defaultDeck(stageIndex)).filter((id) => available.some((u) => u.id === id));
  if (picked.length === 0) picked = available.slice(0, DECK_SIZE).map((u) => u.id);

  const grid = el('div', { class: 'pick-grid' });
  const startBtn = btn('출전!', () => {
    store.update((s) => { s.deck = picked; });
    go('battle', { stage: stageIndex, deck: picked });
  }, 'btn ju');

  function refresh() {
    grid.replaceChildren();
    for (const u of available) {
      const on = picked.includes(u.id);
      const b = el('button', { class: `pick${on ? ' sel' : ''}`, type: 'button' },
        el('img', { src: assetUrl(u.id), alt: '' }),
        el('span', { class: 'nm' }, u.name),
        el('span', { class: 'co' }, `셈력 ${u.cost}`),
        el('span', { class: 'co' }, u.role),
      );
      b.addEventListener('click', () => {
        if (on) picked = picked.filter((x) => x !== u.id);
        else if (picked.length < DECK_SIZE) picked.push(u.id);
        refresh();
      });
      grid.append(b);
    }
    startBtn.disabled = picked.length === 0;
    startBtn.textContent = `출전! (${picked.length}/${DECK_SIZE})`;
  }
  refresh();

  const types = stage.quizTypes.map((t) => TYPE_BY_ID.get(t)?.label ?? t).join(' · ');
  const node = el('section', { class: 'screen' },
    topbar(`${stage.index === CHALLENGE_STAGE ? '도전' : stage.index}. ${stage.name}`, go, 'map'),
    el('div', { class: 'pane' },
      el('div', { class: 'card' },
        el('div', {}, el('b', {}, '오늘의 문제: '), types),
        el('div', { class: 'muted' }, '문제를 맞히면 셈력이 차올라요. 틀려도 성은 다치지 않아요.'),
      ),
      el('p', { class: 'muted' }, `함께 나갈 셈지기를 ${DECK_SIZE}명까지 골라요.`),
      grid,
    ),
    el('div', { class: 'actionbar' }, startBtn),
  );
  return { node };
}

// ── 봉인 해제(L2 관문) ───────────────────────────────────────────────────
export function gateScreen(go: Go, result: BattleResult): { node: HTMLElement; teardown?: Teardown } {
  const save = store.load();
  const stage = stageDef(result.stage);
  const TOTAL = 5;
  const quiz = new QuizSession({ layer: 'L2', types: stage.quizTypes, save, seed: (Date.now() + 7) % 100000 });
  const rng = makeRng(Date.now() % 99991);
  let idx = 0;
  let correctN = 0;
  let q: Question | null = null;
  let askedAt = 0;
  // 🔴 지연 전환 타이머는 종료 경로에서 명시 취소 + 수신측 가드 이중으로 둔다.
  //    (안 그러면 화면을 떠난 뒤 예약된 콜백이 살아나 다음 화면을 덮어쓴다)
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finished = false;

  const progress = el('div', { class: 'muted' }, '');
  const qLine = el('div', { class: 'gate-q' }, '');
  const askLine = el('div', { class: 'muted' }, '');
  const choices = el('div', { class: 'choices' });
  const fb = el('div', { class: 'fb' }, '');

  function nextQ() {
    if (finished) return;
    if (idx >= TOTAL) return finish();
    q = quiz.next();
    askedAt = performance.now();
    progress.textContent = `${idx + 1} / ${TOTAL}`;
    qLine.textContent = `${q.prompt} = ?`;
    askLine.textContent = q.ask;
    fb.textContent = '';
    fb.className = 'fb';
    const c = buildChoices(q, rng);
    choices.replaceChildren();
    for (const v of c.options) {
      choices.append(btn(String(v), () => pick(v), 'btn ghost'));
    }
  }

  function pick(v: number) {
    if (!q) return;
    const res = quiz.submit(v, performance.now() - askedAt);
    for (const b of Array.from(choices.querySelectorAll('button'))) (b as HTMLButtonElement).disabled = true;
    if (res.correct) {
      correctN++;
      play('correct');
      fb.className = 'fb ok';
      fb.textContent = '정답이에요! 봉인이 하나 풀렸어요.';
    } else {
      play('wrong');
      fb.className = 'fb no';
      fb.textContent = `정답은 ${res.answer}. ${res.hint}`;
    }
    idx++;
    if (timer) clearTimeout(timer);
    timer = setTimeout(nextQ, res.correct ? 700 : 1600);
  }

  function finish() {
    if (finished) return;
    finished = true;
    if (timer) { clearTimeout(timer); timer = null; }
    const starN = correctN >= TOTAL ? 3 : correctN >= 3 ? 2 : 1;
    store.update((d) => {
      const key = String(result.stage);
      const prev = d.progress.cleared[key] ?? 0;
      d.progress.cleared[key] = Math.max(prev, starN);
      if (result.stage === CHALLENGE_STAGE) d.progress.challengeCleared = true;
      // 먹물은 별 수에 비례 — 이미 받은 별보다 나아진 만큼만 추가로 준다(무한 파밍 방지)
      const table = [0, 20, 35, 60];
      const gain = Math.max(0, (table[starN] ?? 0) - (table[prev] ?? 0));
      d.currency.meokmul += gain;
    });
    go('result', { ...result, starN, gateCorrect: correctN, gateTotal: TOTAL });
  }

  queueMicrotask(nextQ);
  const teardown: Teardown = () => { finished = true; if (timer) { clearTimeout(timer); timer = null; } };

  const node = el('section', { class: 'screen' },
    el('div', { class: 'topbar' }, el('h1', {}, '봉인 해제'), el('span', { class: 'spacer' }), progress),
    el('div', { class: 'pane gate-wrap' },
      el('p', { class: 'muted' }, '엉킴괴수가 남긴 봉인이에요. 맞힐수록 별을 더 받아요.'),
      qLine, askLine, choices, fb,
    ),
  );
  return { node, teardown };
}

// ── 결과 ─────────────────────────────────────────────────────────────────
export interface ResultPayload extends BattleResult { starN: number; gateCorrect: number; gateTotal: number }

export function resultScreen(go: Go, r: ResultPayload): { node: HTMLElement } {
  const density = questionDensity(r.answerMs, r.seconds * 1000);
  const acc = r.solved ? Math.round((r.correct / r.solved) * 100) : 0;
  const next = r.stage < CHALLENGE_STAGE ? r.stage + 1 : null;
  const won = r.status === 'win';

  const node = el('section', { class: 'screen' },
    el('div', { class: 'topbar' }, el('h1', {}, won ? '이겼다!' : r.status === 'draw' ? '시간이 다 됐어요' : '아쉬워요'), el('span', { class: 'spacer' })),
    el('div', { class: 'pane gate-wrap' },
      el('div', { class: 'stars-big' }, stars(r.starN)),
      el('div', { class: 'result-stats' },
        stat('푼 문제', `${r.solved}`),
        stat('정답률', `${acc}%`),
        stat('봉인 해제', `${r.gateCorrect}/${r.gateTotal}`),
        stat('걸린 시간', `${Math.round(r.seconds)}초`),
        stat('문제 시간 비율', `${Math.round(density * 100)}%`),
      ),
      el('p', { class: 'muted' }, won
        ? '문제를 빨리 풀수록 셈지기가 더 빨리 나와요.'
        : '괜찮아요. 다시 도전하면 아까 틀린 문제가 먼저 나와요.'),
      el('div', { class: 'row' },
        btn('다시 하기', () => go('prep', r.stage), 'btn ghost'),
        next ? btn('다음 길로', () => go('prep', next), 'btn ju') : btn('지도로', () => go('map'), 'btn ju'),
        btn('지도', () => go('map'), 'btn ghost'),
      ),
    ),
  );
  return { node };
}

function stat(k: string, v: string): HTMLElement {
  return el('div', { class: 'stat' }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v));
}

// ── 도감 ─────────────────────────────────────────────────────────────────
export function codexScreen(go: Go): { node: HTMLElement } {
  const grid = el('div', { class: 'codex-grid' });
  function refresh() {
    const d = store.load();
    grid.replaceChildren();
    let lockedIdx = 0;
    for (const u of ALLIES) {
      const has = d.codex.unlocked.includes(u.id);
      const cost = UNLOCK_COST[lockedIdx] ?? 300;
      const box = el('div', { class: `cx${has ? '' : ' locked'}` },
        el('img', { src: assetUrl(u.id), alt: '' }),
        el('div', {}, el('b', {}, u.name)),
        el('div', { class: 'muted' }, u.role),
        el('div', { class: 'muted' }, `셈력 ${u.cost} · ${u.unlock}번째 길부터`),
      );
      if (!has) {
        const canBuy = d.currency.meokmul >= cost;
        const b = btn(`먹물 ${cost}로 데려오기`, () => {
          store.update((s) => {
            if (s.currency.meokmul >= cost && !s.codex.unlocked.includes(u.id)) {
              s.currency.meokmul -= cost;
              s.codex.unlocked.push(u.id);
            }
          });
          refresh();
        }, 'btn sm');
        b.disabled = !canBuy;
        box.append(b);
        lockedIdx++;
      }
      grid.append(box);
    }
  }
  refresh();
  const node = el('section', { class: 'screen' },
    topbar('셈지기 도감', go),
    el('div', { class: 'pane' },
      el('p', { class: 'muted' }, '별을 모아 받은 먹물로 새 셈지기를 데려올 수 있어요. 힘은 길을 나아가면 저절로 세져요.'),
      grid,
    ),
  );
  return { node };
}

// ── 엉킴 봉인(오답 목록) ─────────────────────────────────────────────────
export function srsScreen(go: Go): { node: HTMLElement } {
  const d = store.load();
  const items = Object.values(d.edu.srs);
  const byState: Record<string, number> = { 학습중: 0, 익힘: 0, 다짐: 0, 완성: 0 };
  for (const it of items) byState[it.state] = (byState[it.state] ?? 0) + 1;

  const rows = items
    .sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1))
    .slice(0, 60)
    .map((it) => {
      const [t, body] = it.key.split(':');
      return el('tr', {},
        el('td', {}, TYPE_BY_ID.get(t as QType)?.label ?? t ?? ''),
        el('td', {}, (body ?? '').replace('x', ' × ').replace('/', ' ÷ ')),
        el('td', {}, it.state),
        el('td', { class: 'num' }, it.dueAt),
      );
    });

  const node = el('section', { class: 'screen' },
    topbar('엉킴 봉인', go),
    el('div', { class: 'pane' },
      el('div', { class: 'card' },
        el('div', {}, `학습중 ${byState['학습중']} · 익힘 ${byState['익힘']} · 다짐 ${byState['다짐']} · 완성 ${byState['완성']}`),
        el('div', { class: 'muted' }, '한 번 틀린 문제는 다음 판에서 먼저 나와요. 두 번 연달아 맞히면 한 단계 올라가요.'),
      ),
      items.length
        ? el('table', { class: 'rep' },
            el('thead', {}, el('tr', {}, el('th', {}, '갈래'), el('th', {}, '문제'), el('th', {}, '단계'), el('th', {}, '다음 날'))),
            el('tbody', {}, ...rows))
        : el('p', { class: 'muted' }, '아직 봉인된 문제가 없어요. 한 판 놀고 와요!'),
    ),
  );
  return { node };
}

// ── 내 기록(학습 리포트) ─────────────────────────────────────────────────
export function reportScreen(go: Go): { node: HTMLElement } {
  const d = store.load();
  const entries = Object.entries(d.edu.stats) as [QType, NonNullable<typeof d.edu.stats[QType]>][];
  const totalAnswerMs = entries.reduce((s, [, v]) => s + v.answerMs, 0);
  const totalAttempts = entries.reduce((s, [, v]) => s + v.attempts, 0);
  const density = questionDensity(totalAnswerMs, d.edu.playMs);
  const weak = weakTypes(d.edu.stats, 3);
  const ret = retention(d.edu.retentionLog.map((r) => ({ key: r.key, ok: r.ok })));

  const rows = entries
    .sort((a, b) => b[1].attempts - a[1].attempts)
    .map(([t, s]) => {
      const dTheta = thetaDelta(d.edu.thetaWeekly, t);
      return el('tr', {},
        el('td', {}, TYPE_BY_ID.get(t)?.label ?? t),
        el('td', { class: 'num' }, String(s.attempts)),
        el('td', { class: 'num' }, `${Math.round(accuracy(s) * 100)}%`),
        el('td', { class: 'num' }, `${Math.round(automaticity(s) * 100)}%`),
        el('td', { class: 'num' }, thetaDisplayable(s.attempts) ? (dTheta === null ? '—' : `${dTheta > 0 ? '+' : ''}${dTheta}`) : '측정 중'),
      );
    });

  const node = el('section', { class: 'screen' },
    topbar('내 기록', go),
    el('div', { class: 'pane' },
      el('div', { class: 'result-stats' },
        stat('푼 문제(전체)', String(totalAttempts)),
        stat('논 판 수', String(d.edu.rounds)),
        stat('문제 시간 비율', `${Math.round(density * 100)}%`),
        stat('되찾은 수', String(d.currency.recovered)),
        stat('오래 기억한 비율', d.edu.retentionLog.length ? `${Math.round(ret * 100)}%` : '측정 중'),
      ),
      el('div', { class: 'card' },
        el('b', {}, '더 연습하면 좋은 갈래'),
        el('div', {}, weak.length ? weak.map((t) => TYPE_BY_ID.get(t)?.label ?? t).join(' · ') : '아직 판단하기 일러요(문제를 더 풀어 봐요)'),
      ),
      rows.length
        ? el('table', { class: 'rep' },
            el('thead', {}, el('tr', {},
              el('th', {}, '갈래'), el('th', {}, '푼 수'), el('th', {}, '정답률'), el('th', {}, '빠르고 정확'), el('th', {}, '4주 변화'))),
            el('tbody', {}, ...rows))
        : el('p', { class: 'muted' }, '아직 기록이 없어요.'),
      el('p', { class: 'muted' }, '이 기록은 이 기기에만 저장돼요. 어디로도 보내지 않아요.'),
    ),
  );
  return { node };
}

// ── 설정 ─────────────────────────────────────────────────────────────────
export function settingsScreen(go: Go): { node: HTMLElement } {
  const d = store.load();
  const applyFont = (v: number) => document.documentElement.style.setProperty('--fs', String(v));

  const fontRow = el('div', { class: 'row' });
  for (const [label, v] of [['보통', 1], ['크게', 1.2], ['아주 크게', 1.5]] as [string, 1 | 1.2 | 1.5][]) {
    const b = btn(label, () => {
      store.update((s) => { s.settings.fontScale = v; });
      applyFont(v);
    }, `btn sm ${d.settings.fontScale === v ? '' : 'ghost'}`);
    fontRow.append(b);
  }

  const motion = btn(d.settings.reduceMotion ? '움직임 줄이기: 켜짐' : '움직임 줄이기: 꺼짐', () => {
    store.update((s) => { s.settings.reduceMotion = !s.settings.reduceMotion; });
    go('settings');
  }, 'btn sm');

  const resetBtn = btn('기록 모두 지우기', () => {
    if (confirmTwice()) { store.reset(); go('menu'); }
  }, 'btn sm ju');

  const node = el('section', { class: 'screen' },
    topbar('설정', go),
    el('div', { class: 'pane' },
      el('div', { class: 'card' }, el('b', {}, '글자 크기'), fontRow),
      el('div', { class: 'card' }, el('b', {}, '움직임'), el('div', {}, motion)),
      el('div', { class: 'card' },
        el('b', {}, '내 별명'), el('div', {}, d.profile.nickname),
        el('div', { class: 'muted' }, '이름 대신 쓰는 별명이에요. 아무 정보도 보내지 않아요.'),
      ),
      el('div', { class: 'card' }, el('b', {}, '기록'), el('div', {}, resetBtn),
        el('div', { class: 'muted' }, '지우면 되돌릴 수 없어요.')),
    ),
  );
  return { node };
}

function confirmTwice(): boolean {
  return globalThis.confirm('정말 모두 지울까요? 되돌릴 수 없어요.')
    && globalThis.confirm('마지막 확인이에요. 정말 지울까요?');
}
