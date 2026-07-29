import { el, btn, stars, type Teardown } from './dom';
import * as store from '../save/store';
import {
  ALLIES, RARITIES, DECK_SIZE, defaultDeck, progressionAllies,
  maxLevel, rarityRank, ALLY_BY_ID,
} from '../sim/units';
import {
  stageDef, chapterStages, chapterOf, chapterName, CHAPTER_LEN, CAMPAIGN_STAGES,
} from '../sim/stages';
import {
  SUMMON_COST, SUMMON_COST_TEN, PITY_LEGEND, probabilityTable,
  summonOnce, summonTen, upgradeCost, canUpgrade, upgrade, type SummonResult,
} from '../meta/summon';
import { unitCard, rarityName, rarityColor } from './rarity';
import { TYPE_BY_ID, type QType } from '../edu/curriculum';
import { QuizSession } from '../edu/session';
import { buildChoices } from '../edu/distractor';
import { makeRng, type Question } from '../edu/generator';
import { play } from '../render/audio';
import { accuracy, automaticity, questionDensity, retention, thetaDelta, thetaDisplayable, weakTypes } from '../edu/stats';
import {
  boardEnabled, fetchBoard, submitScore, grantConsent, revokeConsent, entryName, type BoardEntry,
} from '../net/board';
import { weekKeyUTC, TOP_N } from '../../shared/board-contract';
import type { BattleResult } from './battle';
import type { RarityId } from '../sim/types';

type Go = (screen: string, payload?: unknown) => void;

/** 보유 셈지기 목록 */
function ownedIds(): string[] {
  return Object.keys(store.load().roster);
}

function topbar(title: string, go: Go, back = 'menu'): HTMLElement {
  return el('div', { class: 'topbar' },
    btn('← 뒤로', () => go(back), 'btn sm ghost'),
    el('h1', {}, title),
    el('span', { class: 'spacer' }),
    el('span', { class: 'ink' }, `먹물 ${store.load().currency.meokmul.toLocaleString('ko-KR')}`),
  );
}

function stat(k: string, v: string): HTMLElement {
  return el('div', { class: 'stat' }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v));
}

// ── 메인 메뉴 ────────────────────────────────────────────────────────────
export function menuScreen(go: Go): { node: HTMLElement } {
  const d = store.load();
  const clearedN = Object.keys(d.progress.cleared).length;
  const starN = Object.values(d.progress.cleared).reduce((s, v) => s + v, 0);
  const owned = ownedIds().length;
  const best = d.progress.maxStage;

  const node = el('section', { class: 'screen menu-screen' },
    el('div', { class: 'menu-hero' },
      el('div', { class: 'crest', 'aria-hidden': 'true' }, '龜'),
      el('h1', { class: 'logo' }, '구구성 수호대'),
      el('p', { class: 'tag' }, '계산이 빨라질수록 내 군대가 강해진다'),
      clearedN
        ? el('div', { class: 'menu-progress' },
            stat('가장 멀리 간 길', best ? `${chapterOf(best)}구역 ${((best - 1) % CHAPTER_LEN) + 1}` : '—'),
            stat('깬 길', `${clearedN}`),
            stat('모은 별', `${starN}`),
            stat('셈지기', `${owned}/${ALLIES.length}`),
          )
        : el('p', { class: 'muted' }, '문제를 맞히면 셈력이 차오르고, 셈지기가 달려 나가요.'),
      el('div', { class: 'row' },
        btn(clearedN ? '이어서 하기' : '시작하기', () => go('map'), 'btn ju big'),
        btn('셈지기 소환', () => go('summon'), 'btn gold'),
      ),
      el('div', { class: 'row' },
        btn('셈지기 도감', () => go('codex')),
        btn('엉킴 봉인', () => go('srs')),
        btn('내 기록', () => go('report'), 'btn nok'),
        // 서버 주소가 없는 빌드(단일 HTML·아티팩트)에서는 버튼 자체를 만들지 않는다 —
        // 눌러 봐야 CSP 에 막혀 콘솔 에러만 남는다
        ...(boardEnabled() ? [btn('주간 순위', () => go('board'), 'btn ghost')] : []),
        btn('설정', () => go('settings'), 'btn ghost'),
      ),
      el('p', { class: 'muted fine' }, '로그인 없이 바로 즐길 수 있어요. 기록은 이 기기에만 저장돼요.'),
    ),
  );
  return { node };
}

// ── 셈나라 지도 (무한) ───────────────────────────────────────────────────
export function mapScreen(go: Go, payload?: unknown): { node: HTMLElement } {
  const d = store.load();
  const reached = Math.max(1, d.progress.maxStage + 1);
  const startChapter = typeof payload === 'number' && payload >= 1 ? Math.floor(payload) : chapterOf(reached);
  let chapter = startChapter;

  const grid = el('div', { class: 'map-grid' });
  const heading = el('h2', { class: 'chapter-name' }, '');
  const sub = el('p', { class: 'muted' }, '');
  const prev = btn('◀ 앞 구역', () => { chapter = Math.max(1, chapter - 1); refresh(); }, 'btn sm ghost');
  const next = btn('다음 구역 ▶', () => { chapter += 1; refresh(); }, 'btn sm ghost');

  function refresh(): void {
    const save = store.load();
    heading.textContent = `${chapter}구역 · ${chapterName(chapter)}`;
    const first = (chapter - 1) * CHAPTER_LEN + 1;
    sub.textContent = first > CAMPAIGN_STAGES
      ? '무한 도전 구역이에요. 셈지기를 더 모으고 키워야 나아갈 수 있어요.'
      : '앞 길을 한 번이라도 깨면 다음 길이 열려요.';
    prev.disabled = chapter <= 1;

    grid.replaceChildren();
    for (const s of chapterStages(chapter)) {
      const key = String(s.index);
      const starN = save.progress.cleared[key] ?? 0;
      const locked = s.index > 1 && (save.progress.cleared[String(s.index - 1)] ?? 0) === 0;
      const types = s.quizTypes.map((t) => TYPE_BY_ID.get(t)?.label ?? t).join(' · ');
      const b = el('button', {
        class: `node${s.boss ? ' boss' : ''}${s.endless ? ' endless' : ''}${starN ? ' done' : ''}`,
        type: 'button',
      },
        el('span', { class: 'n' }, `${s.pos}. ${s.boss ? '수문장' : (s.name.split(' ')[1] ?? '')}`),
        el('span', { class: 'stars' }, starN ? stars(starN) : (locked ? '🔒' : '　')),
        el('span', { class: 'types' }, types),
      );
      b.disabled = locked;
      b.addEventListener('click', () => go('prep', s.index));
      grid.append(b);
    }
  }
  refresh();

  const node = el('section', { class: 'screen' },
    topbar('셈나라 지도', go),
    el('div', { class: 'pane' },
      el('div', { class: 'chapter-bar' }, prev, heading, next),
      sub,
      grid,
    ),
  );
  return { node };
}

// ── 출전 준비 ────────────────────────────────────────────────────────────
export function prepScreen(go: Go, stageIndex: number): { node: HTMLElement } {
  const d = store.load();
  const stage = stageDef(stageIndex);
  const owned = ALLIES.filter((u) => d.roster[u.id])
    .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || a.cost - b.cost);

  let picked = (d.deck.length ? d.deck : defaultDeck(ownedIds())).filter((id) => d.roster[id]);
  if (picked.length === 0) picked = defaultDeck(ownedIds());

  const grid = el('div', { class: 'card-grid' });
  const startBtn = btn('출전!', () => {
    store.update((s) => { s.deck = picked; });
    go('battle', { stage: stageIndex, deck: picked });
  }, 'btn ju big');

  function refresh(): void {
    grid.replaceChildren();
    for (const u of owned) {
      const entry = d.roster[u.id]!;
      const on = picked.includes(u.id);
      const card = unitCard(u, { level: entry.level, selected: on, compact: true });
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      const toggle = (): void => {
        if (on) picked = picked.filter((x) => x !== u.id);
        else if (picked.length < DECK_SIZE) picked.push(u.id);
        else return;
        play('tap');
        refresh();
      };
      card.addEventListener('click', toggle);
      card.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); toggle(); }
      });
      grid.append(card);
    }
    startBtn.disabled = picked.length === 0;
    startBtn.textContent = `출전!  ${picked.length}/${DECK_SIZE}`;
  }
  refresh();

  const types = stage.quizTypes.map((t) => TYPE_BY_ID.get(t)?.label ?? t).join(' · ');
  const node = el('section', { class: 'screen' },
    topbar(`${stage.chapter}구역 ${stage.pos}판 · ${stage.name.split(' ')[1] ?? ''}`, go, 'map'),
    el('div', { class: 'pane' },
      el('div', { class: `card banner${stage.boss ? ' boss' : ''}` },
        el('div', {}, el('b', {}, stage.boss ? '수문장이 지키는 길이에요. ' : '오늘의 문제: '), types),
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
  const seals = el('div', { class: 'seals' });

  function drawSeals(): void {
    seals.replaceChildren();
    for (let i = 0; i < TOTAL; i++) {
      seals.append(el('span', { class: `seal${i < correctN ? ' open' : i < idx ? ' miss' : ''}` }, ''));
    }
  }

  function nextQ(): void {
    if (finished) return;
    if (idx >= TOTAL) return finish();
    q = quiz.next();
    askedAt = performance.now();
    progress.textContent = `${idx + 1} / ${TOTAL}`;
    qLine.textContent = `${q.prompt} = ?`;
    askLine.textContent = q.ask;
    fb.textContent = '';
    fb.className = 'fb';
    drawSeals();
    const c = buildChoices(q, rng);
    choices.replaceChildren();
    for (const v of c.options) choices.append(btn(String(v), () => pick(v), 'btn ghost'));
  }

  function pick(v: number): void {
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
    drawSeals();
    if (timer) clearTimeout(timer);
    timer = setTimeout(nextQ, res.correct ? 700 : 1600);
  }

  function finish(): void {
    if (finished) return;
    finished = true;
    if (timer) { clearTimeout(timer); timer = null; }
    const starN = correctN >= TOTAL ? 3 : correctN >= 3 ? 2 : 1;
    let gain = 0;
    let unlockedNow: string[] = [];
    store.update((d) => {
      const key = String(result.stage);
      const prev = d.progress.cleared[key] ?? 0;
      d.progress.cleared[key] = Math.max(prev, starN);
      d.progress.maxStage = Math.max(d.progress.maxStage, result.stage);
      // 먹물은 별 수에 비례 — 이미 받은 별보다 나아진 만큼만 추가로 준다(무한 파밍 방지).
      // 판이 깊어질수록 소환 비용 대비 보상이 유지되도록 판 번호에 비례해 늘린다.
      const table = [0, 20, 35, 60];
      const scale = 1 + (Math.min(result.stage, CAMPAIGN_STAGES) - 1) * 0.12;
      gain = Math.round(Math.max(0, (table[starN] ?? 0) - (table[prev] ?? 0)) * scale);
      d.currency.meokmul += gain;
      // 진도 해금 — 새로 열린 셈지기를 보유로 넣는다
      for (const u of progressionAllies(d.progress.maxStage)) {
        if (!d.roster[u.id]) { d.roster[u.id] = { level: 1, shards: 0 }; unlockedNow.push(u.id); }
      }
    });
    go('result', { ...result, starN, gateCorrect: correctN, gateTotal: TOTAL, meokmul: gain, unlocked: unlockedNow });
  }

  queueMicrotask(nextQ);
  const teardown: Teardown = () => { finished = true; if (timer) { clearTimeout(timer); timer = null; } };

  const node = el('section', { class: 'screen' },
    el('div', { class: 'topbar' }, el('h1', {}, '봉인 해제'), el('span', { class: 'spacer' }), progress),
    el('div', { class: 'pane gate-wrap' },
      seals,
      el('p', { class: 'muted' }, '엉킴괴수가 남긴 봉인이에요. 맞힐수록 별을 더 받아요.'),
      qLine, askLine, choices, fb,
    ),
  );
  return { node, teardown };
}

// ── 결과 ─────────────────────────────────────────────────────────────────
export interface ResultPayload extends BattleResult {
  starN: number;
  gateCorrect: number;
  gateTotal: number;
  meokmul?: number;
  unlocked?: string[];
}

export function resultScreen(go: Go, r: ResultPayload): { node: HTMLElement } {
  const density = questionDensity(r.answerMs, r.seconds * 1000);
  const acc = r.solved ? Math.round((r.correct / r.solved) * 100) : 0;
  const won = r.status === 'win';
  const next = won ? r.stage + 1 : null;

  const gained = r.unlocked?.length
    ? el('div', { class: 'card gain' },
        el('b', {}, '새 셈지기가 합류했어요!'),
        el('div', { class: 'card-grid mini' },
          ...r.unlocked.map((id) => {
            const u = ALLY_BY_ID.get(id);
            return u ? unitCard(u, { level: 1, compact: true, reveal: true }) : el('span', {}, '');
          })),
      )
    : null;

  const node = el('section', { class: 'screen' },
    el('div', { class: 'topbar' },
      el('h1', {}, won ? '이겼다!' : r.status === 'draw' ? '시간이 다 됐어요' : '아쉬워요'),
      el('span', { class: 'spacer' }),
    ),
    el('div', { class: 'pane gate-wrap' },
      el('div', { class: 'stars-big' }, stars(r.starN)),
      r.meokmul ? el('div', { class: 'ink big' }, `먹물 +${r.meokmul}`) : el('span', {}, ''),
      el('div', { class: 'result-stats' },
        stat('푼 문제', `${r.solved}`),
        stat('정답률', `${acc}%`),
        stat('봉인 해제', `${r.gateCorrect}/${r.gateTotal}`),
        stat('걸린 시간', `${Math.round(r.seconds)}초`),
        stat('문제 시간 비율', `${Math.round(density * 100)}%`),
      ),
      ...(gained ? [gained] : []),
      el('p', { class: 'muted' }, won
        ? '문제를 빨리 풀수록 셈지기가 더 빨리 나와요.'
        : '괜찮아요. 다시 도전하면 아까 틀린 문제가 먼저 나와요.'),
      el('div', { class: 'row' },
        btn('다시 하기', () => go('prep', r.stage), 'btn ghost'),
        next ? btn('다음 길로', () => go('prep', next), 'btn ju') : btn('지도로', () => go('map'), 'btn ju'),
        btn('소환하기', () => go('summon'), 'btn gold'),
      ),
    ),
  );
  return { node };
}

// ── 소환(뽑기) ───────────────────────────────────────────────────────────
export function summonScreen(go: Go): { node: HTMLElement; teardown?: Teardown } {
  let timers: ReturnType<typeof setTimeout>[] = [];
  const clearTimers = (): void => { timers.forEach(clearTimeout); timers = []; };

  const purse = el('div', { class: 'ink big' }, '');
  const pityLine = el('div', { class: 'muted' }, '');
  const stage = el('div', { class: 'summon-stage' });
  const one = btn(`한 번 소환 · 먹물 ${SUMMON_COST}`, () => doSummon(1), 'btn');
  const ten = btn(`열 번 소환 · 먹물 ${SUMMON_COST_TEN}`, () => doSummon(10), 'btn gold big');

  function refreshHead(): void {
    const d = store.load();
    purse.textContent = `먹물 ${d.currency.meokmul.toLocaleString('ko-KR')}`;
    const left = PITY_LEGEND - d.summon.sinceLegend;
    pityLine.textContent = `전설 확정까지 ${left}번 · 지금까지 ${d.summon.total}번 소환`;
    one.disabled = d.currency.meokmul < SUMMON_COST;
    ten.disabled = d.currency.meokmul < SUMMON_COST_TEN;
  }

  function doSummon(n: number): void {
    const cost = n === 10 ? SUMMON_COST_TEN : SUMMON_COST;
    const d = store.load();
    if (d.currency.meokmul < cost) return;

    let results: SummonResult[] = [];
    store.update((s) => {
      s.currency.meokmul -= cost;
      const rng = () => Math.random();
      results = n === 10 ? summonTen(s.roster, s.summon, rng) : [summonOnce(s.roster, s.summon, rng)];
    });
    play('summon');

    // 등급 낮은 것부터 차례로 열어 마지막에 좋은 게 나오게 한다(연출)
    const order = [...results].sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity));
    stage.replaceChildren();
    clearTimers();
    order.forEach((res, i) => {
      timers.push(setTimeout(() => {
        const card = unitCard(res.unit, { level: 1, reveal: true, compact: true });
        const tagText = res.isNew ? 'NEW' : `조각 +${res.shards}`;
        card.append(el('span', { class: `ucard-tag${res.isNew ? ' new' : ''}` }, tagText));
        stage.append(card);
        if (rarityRank(res.rarity) >= 3) play('win');
        refreshHead();
      }, i * 220));
    });
    timers.push(setTimeout(refreshHead, order.length * 220 + 50));
  }

  refreshHead();

  const rateRows = probabilityTable().map((r) => {
    const row = el('div', { class: 'rate-row' },
      el('span', { class: 'rate-name' }, r.name),
      el('span', { class: 'rate-bar' }, el('i', {})),
      el('span', { class: 'rate-pct' }, `${r.percent}%`),
    );
    const fill = row.querySelector('i') as HTMLElement;
    fill.style.width = `${Math.max(3, r.percent)}%`;
    fill.style.background = rarityColor(r.id);
    return row;
  });

  const node = el('section', { class: 'screen' },
    topbar('셈지기 소환', go),
    el('div', { class: 'pane' },
      el('div', { class: 'card summon-head' },
        purse, pityLine,
        el('div', { class: 'muted' }, '먹물은 문제를 맞혀야 모여요. 현금으로는 살 수 없어요.'),
      ),
      stage,
      el('div', { class: 'row' }, one, ten),
      el('details', { class: 'card rates' },
        el('summary', {}, '나올 확률 보기'),
        ...rateRows,
        el('p', { class: 'muted fine' }, `열 번 소환에는 유니크 이상이 반드시 하나 들어가고, ${PITY_LEGEND}번 안에 전설이 반드시 나와요.`),
      ),
    ),
  );
  return { node, teardown: clearTimers };
}

// ── 도감 (등급별) ────────────────────────────────────────────────────────
export function codexScreen(go: Go): { node: HTMLElement } {
  const wrap = el('div', { class: 'codex-wrap' });

  function refresh(): void {
    const d = store.load();
    wrap.replaceChildren();
    for (const r of [...RARITIES].reverse()) {
      const list = ALLIES.filter((u) => u.rarity === r.id);
      const have = list.filter((u) => d.roster[u.id]).length;
      const head = el('div', { class: 'codex-head' },
        el('span', { class: 'chip' }, r.name),
        el('span', { class: 'muted' }, `${have} / ${list.length}`),
      );
      (head.firstChild as HTMLElement).style.setProperty('--rc', r.color);

      const grid = el('div', { class: 'card-grid' });
      for (const u of list) {
        const entry = d.roster[u.id];
        const card = unitCard(u, { level: entry?.level, owned: !!entry, compact: true });
        if (entry) {
          const max = maxLevel(u.rarity);
          const cost = upgradeCost(entry.level + 1);
          if (entry.level >= max) {
            card.append(el('div', { class: 'up done' }, '최고 단계'));
          } else {
            const b = btn(`승급 · 조각 ${entry.shards}/${cost}`, () => {
              store.update((s) => { upgrade(u, s.roster[u.id]); });
              play('correct');
              refresh();
            }, 'btn sm ghost up');
            b.disabled = !canUpgrade(u, entry);
            card.append(b);
          }
        } else {
          card.append(el('div', { class: 'up' }, u.unlock >= 1 ? `${u.unlock}번째 길에서 합류` : '소환으로만 만나요'));
        }
        grid.append(card);
      }
      wrap.append(head, grid);
    }
  }
  refresh();

  const node = el('section', { class: 'screen' },
    topbar('셈지기 도감', go),
    el('div', { class: 'pane' },
      el('p', { class: 'muted' }, '같은 셈지기를 또 만나면 조각이 돼요. 조각을 모으면 승급해서 더 강해져요.'),
      wrap,
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
        ? el('div', { class: 'tablewrap' },
            el('table', { class: 'rep' },
              el('thead', {}, el('tr', {}, el('th', {}, '갈래'), el('th', {}, '문제'), el('th', {}, '단계'), el('th', {}, '다음 날'))),
              el('tbody', {}, ...rows)))
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
        stat('가장 멀리 간 길', String(d.progress.maxStage)),
        stat('오래 기억한 비율', d.edu.retentionLog.length ? `${Math.round(ret * 100)}%` : '측정 중'),
      ),
      el('div', { class: 'card' },
        el('b', {}, '더 연습하면 좋은 갈래'),
        el('div', {}, weak.length ? weak.map((t) => TYPE_BY_ID.get(t)?.label ?? t).join(' · ') : '아직 판단하기 일러요(문제를 더 풀어 봐요)'),
      ),
      rows.length
        ? el('div', { class: 'tablewrap' },
            el('table', { class: 'rep' },
              el('thead', {}, el('tr', {},
                el('th', {}, '갈래'), el('th', {}, '푼 수'), el('th', {}, '정답률'), el('th', {}, '빠르고 정확'), el('th', {}, '4주 변화'))),
              el('tbody', {}, ...rows)))
        : el('p', { class: 'muted' }, '아직 기록이 없어요.'),
      el('p', { class: 'muted' }, '이 기록은 이 기기에만 저장돼요. 어디로도 보내지 않아요.'),
    ),
  );
  return { node };
}

// ── 주간 순위 (익명) ─────────────────────────────────────────────────────
/**
 * 🔴 이 화면의 규칙 두 가지:
 *   1. **보는 것은 동의 없이** 된다. 올리는 것만 동의를 받는다.
 *   2. 동의 문구는 아이가 읽고 이해할 수 있어야 한다 — 약관이 아니라 한 문장이다.
 */
export function boardScreen(go: Go): { node: HTMLElement; teardown: Teardown } {
  const d = store.load();
  // 🔴 화면을 나가면 진행 중인 요청을 끊는다. 안 그러면 응답이 늦게 도착해
  //    이미 떨어져 나간 DOM 을 만지고, 느린 망에서는 요청이 계속 매달려 있다.
  const ac = new AbortController();
  const wk = weekKeyUTC(Date.now());
  const mine = d.board.week === wk ? d.board : { correct: 0, stage: 0 };

  const listP = el('div', { class: 'rank' }, el('p', { class: 'muted' }, '불러오는 중…'));
  const listC = el('div', { class: 'rank' }, el('p', { class: 'muted' }, '불러오는 중…'));
  const myRank = el('p', { class: 'muted' }, '');

  function fill(box: HTMLElement, rows: BoardEntry[], unit: string): void {
    box.replaceChildren();
    if (!rows.length) { box.append(el('p', { class: 'muted' }, '이번 주는 아직 아무도 없어요. 첫 번째가 되어 봐요!')); return; }
    rows.forEach((e, i) => {
      box.append(el('div', { class: `rank-row${i < 3 ? ' top' : ''}` },
        el('span', { class: 'rank-n' }, `${i + 1}`),
        el('span', { class: 'rank-name' }, entryName(e)),
        el('span', { class: 'rank-v' }, `${e.v.toLocaleString('ko-KR')}${unit}`),
      ));
    });
  }

  const consentCard = el('div', { class: 'card' });
  function renderConsent(): void {
    const s = store.load();
    consentCard.replaceChildren(
      el('b', {}, s.board.consent ? '내 기록을 순위에 올리는 중' : '순위에 올릴까요?'),
      el('p', { class: 'muted' },
        '올리면 자동으로 만든 별명과 이번 주 숫자(맞힌 문제 수·가장 멀리 간 길)만 보내요. '
        + '이름·나이·학교·연락처는 보내지 않고, 물어보지도 않아요. '
        + '그만두면 올렸던 기록도 바로 지워요.'),
      el('div', { class: 'row' },
        s.board.consent
          ? btn('그만 올리기', () => { revokeConsent(); myRank.textContent = ''; renderConsent(); }, 'btn sm ghost')
          : btn('순위에 올릴래요', () => { grantConsent(); void push(); renderConsent(); }, 'btn sm nok'),
      ),
      myRank,
    );
  }

  /**
   * 🔴 등수를 숫자 그대로 노출하지 않는다.
   *    순위표에는 30명만 뜨는데 개인 등수만 캡 없이 보여주면, 저성취 아동이
   *    "1204위" 같은 숫자를 정면으로 마주하게 된다. 순위표 밖은 뭉뚱그린다.
   */
  const rankLabel = (n: number): string => (n <= TOP_N ? `${n}위` : '순위표 밖');

  async function push(): Promise<void> {
    const r = await submitScore(ac.signal);
    if (!r || ac.signal.aborted) return;
    myRank.textContent = `내 자리 — 연습왕 ${rankLabel(r.rank.practice)} · 도전왕 ${rankLabel(r.rank.challenge)}`;
    void refresh();
  }

  async function refresh(): Promise<void> {
    const b = await fetchBoard(ac.signal);
    if (ac.signal.aborted) return;
    if (!b) {
      const msg = '지금은 순위를 불러올 수 없어요. 잠시 뒤에 다시 열어 봐요.';
      listP.replaceChildren(el('p', { class: 'muted' }, msg));
      listC.replaceChildren(el('p', { class: 'muted' }, msg));
      return;
    }
    fill(listP, b.practice, '문제');
    fill(listC, b.challenge, '판');
  }

  const node = el('section', { class: 'screen' },
    topbar('주간 순위', go),
    el('div', { class: 'pane' },
      el('p', { class: 'muted' }, `${wk.replace('-W', '년 ')}주차 · 월요일마다 새로 시작해요`),
      el('div', { class: 'result-stats' },
        stat('이번 주 맞힌 문제', String(mine.correct)),
        stat('이번 주 가장 멀리', mine.stage ? `${mine.stage}판` : '—'),
      ),
      el('div', { class: 'board-cols' },
        el('div', { class: 'card' }, el('b', {}, '연습왕 — 이번 주 맞힌 문제'), listP),
        el('div', { class: 'card' }, el('b', {}, '도전왕 — 이번 주 가장 멀리 간 길'), listC),
      ),
      consentCard,
    ),
  );

  renderConsent();
  void refresh();
  if (store.load().board.consent) void push();
  return { node, teardown: () => ac.abort() };
}

// ── 설정 ─────────────────────────────────────────────────────────────────
export function settingsScreen(go: Go): { node: HTMLElement } {
  const d = store.load();
  const applyFont = (v: number): void => document.documentElement.style.setProperty('--fs', String(v));

  const fontRow = el('div', { class: 'row' });
  for (const [label, v] of [['보통', 1], ['크게', 1.2], ['아주 크게', 1.5]] as [string, 1 | 1.2 | 1.5][]) {
    fontRow.append(btn(label, () => {
      store.update((s) => { s.settings.fontScale = v; });
      applyFont(v);
      go('settings');
    }, `btn sm ${d.settings.fontScale === v ? '' : 'ghost'}`));
  }

  const motion = btn(d.settings.reduceMotion ? '움직임 줄이기: 켜짐' : '움직임 줄이기: 꺼짐', () => {
    store.update((s) => { s.settings.reduceMotion = !s.settings.reduceMotion; });
    go('settings');
  }, 'btn sm');

  const sound = btn(d.settings.sound ? '소리: 켜짐' : '소리: 꺼짐', () => {
    store.update((s) => { s.settings.sound = !s.settings.sound; });
    go('settings');
  }, 'btn sm');

  const boardToggle = btn(d.board.consent ? '순위 올리기: 켜짐' : '순위 올리기: 꺼짐', () => {
    if (d.board.consent) revokeConsent(); else grantConsent();
    go('settings');
  }, `btn sm ${d.board.consent ? '' : 'ghost'}`);

  const resetBtn = btn('기록 모두 지우기', () => {
    if (confirmTwice()) { store.reset(); go('menu'); }
  }, 'btn sm ju');

  const node = el('section', { class: 'screen' },
    topbar('설정', go),
    el('div', { class: 'pane' },
      el('div', { class: 'card' }, el('b', {}, '글자 크기'), fontRow),
      el('div', { class: 'card' }, el('b', {}, '움직임과 소리'), el('div', { class: 'row' }, motion, sound)),
      el('div', { class: 'card' },
        el('b', {}, '내 별명'), el('div', {}, d.profile.nickname),
        el('div', { class: 'muted' }, '이름 대신 쓰는 별명이에요. 우리가 자동으로 지어 줘요.'),
      ),
      ...(boardEnabled()
        ? [el('div', { class: 'card' },
            el('b', {}, '주간 순위'),
            el('div', {}, boardToggle),
            el('div', { class: 'muted' }, d.board.consent
              ? '별명과 이번 주 숫자만 보내요. 끄면 올렸던 기록을 지우고, 이 기기에 남은 표시도 없애요.'
              : '꺼져 있어요. 순위표를 보기만 하는 건 켜지 않아도 돼요.'),
          )]
        : []),
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

/** 등급 이름을 외부에서 쓸 때 (도감 정렬 라벨 등) */
export function labelOfRarity(r: RarityId): string {
  return rarityName(r);
}
