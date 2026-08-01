import { nextTier } from '../sim/tier';
import { Battle } from '../sim/core';
import { stageDef, stageBackground, MAX_SEC } from '../sim/stages';
import { ALLY_BY_ID, ALLY_CAP } from '../sim/units';
import { rarityColor } from './rarity';
import { comboMul, hasteLabel, MIN_ANSWER_MS } from '../sim/economy';
import { FieldRenderer } from '../render/field';
import { assetUrl } from '../render/assets';
import { QuizSession } from '../edu/session';
import type { Question } from '../edu/generator';
import { el, btn, type Teardown } from './dom';
import * as store from '../save/store';
import { play } from '../render/audio';
import { bumpWeeklyNow } from '../meta/weekly';

/**
 * 전투 화면 — Canvas 전장 + DOM UI(숫자패드·덱·HUD).
 *
 * 🔴 주 입력은 숫자패드다. 4지선다를 주 입력으로 쓰면 찍기(무작위 25%)로 게임이 굴러간다(실측).
 * 🔴 오답은 처벌하지 않는다 — 성 HP를 깎지 않고, 콤보만 끊기며 힌트를 준다.
 */

const DT = 1 / 30;              // 시뮬 고정 타임스텝(초)
/**
 * 프레임당 스텝 상한. dtMs 는 250ms 로 잘리므로 한 프레임에 필요한 시뮬 시간은 최대 0.25초,
 * 8스텝 = 0.267초라 **정상 동작 중에는 밀린 시간을 버리는 일이 없다**(탭 복귀 때만 발동).
 */
const MAX_STEPS_PER_FRAME = 8;

export interface BattleResult {
  status: 'win' | 'lose' | 'draw';
  stage: number;
  solved: number;
  correct: number;
  seconds: number;
  answerMs: number;
  /** 이 판을 치른 난이도 단계 */
  tier: number;
  /** 다음 판 난이도 — 달라졌으면 결과 화면이 알려 준다 */
  nextTier: number;
}

export function buildBattle(stageIndex: number, deck: string[], onDone: (r: BattleResult) => void): { node: HTMLElement; teardown: Teardown } {
  const save = store.load();
  const stage = stageDef(stageIndex);
  // 승급 레벨을 그대로 넘긴다 — 도감에서 키운 셈지기가 전장에서도 세져야 한다
  const levels: Record<string, number> = {};
  for (const [id, e] of Object.entries(save.roster)) levels[id] = e.level;
  const battle = new Battle(stage, levels, save.upgrades.mana, save.challenge.tier);
  const quiz = new QuizSession({ layer: 'L1', types: stage.quizTypes, save, seed: Date.now() % 100000 });

  // ── DOM ────────────────────────────────────────────────────────────────
  const manaFill = el('i');
  const manaText = el('b', { class: 'mana' }, '0');
  const comboText = el('b', { class: 'combo' }, '');
  const speedText = el('b', { class: 'spd' }, '');
  const timeText = el('span', { class: 'muted' }, '');
  const pauseBtn = btn('⏸ 잠깐', () => togglePause(), 'btn sm ghost');

  const hud = el('div', { class: 'bhud' },
    el('span', {}, '셈력'),
    el('div', { class: 'gauge' }, manaFill),
    manaText, comboText, speedText,
    el('span', { class: 'spacer' }), timeText, pauseBtn,
  );

  const deckCol = el('div', { class: 'deck-row' });
  const cards = deck.map((id) => {
    const def = ALLY_BY_ID.get(id)!;
    const cool = el('div', { class: 'cool' }, '');
    const why = el('div', { class: 'why' }, '셈력 부족');   // 문구는 syncDeck 이 상황에 맞게 바꾼다
    const lv = save.roster[id]?.level ?? 1;
    const card = el('button', {
      class: `dcard r-${def.rarity}`, type: 'button',
      'aria-label': `${def.name} 소환, 셈력 ${def.cost}${lv > 1 ? `, ${lv}단계` : ''}`,
    },
      el('img', { src: assetUrl(id), alt: '' }),
      el('span', { class: 'nm' }, def.name),
      el('span', { class: 'cost' }, `${def.cost}`),
      lv > 1 ? el('span', { class: 'lv' }, `${lv}`) : el('span', {}, ''),
      cool, why,
    );
    card.style.setProperty('--rc', rarityColor(def.rarity));
    card.addEventListener('click', () => {
      if (battle.summon(id)) { renderer.shake(2); flash(card); play('summon'); }
    });
    deckCol.append(card);
    return { id, def, card, cool, why };
  });

  const canvas = el('canvas', { id: 'field' }) as HTMLCanvasElement;
  // 🔴 덱은 전장이 아니라 **하단 조작줄**에 있다. 세로열에 두면 셈지기가 늘어날수록
  //    전장을 잠식하고, 결국 세로 스크롤이 생겨 "지금 뽑을 수 있는 카드"가 화면 밖으로 나간다.
  const fieldWrap = el('div', { class: 'field-wrap' }, canvas);

  const qAsk = el('div', { class: 'ask' }, '');
  const qLine = el('div', { class: 'q' }, '');
  const qFb = el('div', { class: 'fb' }, '');
  const quizBox = el('div', { class: 'quiz' }, qAsk, qLine, qFb);

  // 4열 numpad 배치:  7 8 9 ⌫ / 4 5 6 힌트 / 1 2 3 0
  const pad = el('div', { class: 'pad' });
  const PAD_LAYOUT: (string | 'back' | 'hint')[] = ['7', '8', '9', 'back', '4', '5', '6', 'hint', '1', '2', '3', '0'];
  for (const k of PAD_LAYOUT) {
    const b = k === 'back' ? btn('⌫', () => press('back'), 'btn wide')
      : k === 'hint' ? btn('힌트', () => showHint(), 'btn wide')
      : btn(k, () => press(k));
    // 🔴 좁은 화면에서 패드가 6열로 접히면 DOM 순서 그대로 흘러 계산기 배열이 부서진다
    //    (7 8 9 ⌫ 4 5 / 6 힌트 1 2 3 0 — '1'을 찾으려면 둘째 줄 힌트 옆을 봐야 한다).
    //    CSS 가 키를 지목해 다시 세울 수 있도록 표식을 남긴다. 배열 자체는 style.css 참조.
    b.dataset['k'] = k;
    pad.append(b);
  }

  // 먹 대포 — 정답으로 차고, 다 차면 스스로 빛난다(설명 문구로 가르치지 않는다)
  const cannonFill = el('i');
  const cannonBtn = el('button', {
    class: 'cannon', type: 'button', 'aria-label': '먹 대포 쏘기',
  }, el('span', { class: 'ic' }, '💥'), el('span', { class: 'lb' }, '먹 대포'), cannonFill) as HTMLButtonElement;
  cannonBtn.addEventListener('click', () => {
    if (!battle.fireCannon()) return;
    renderer.shake(9);
    play('hit');
    flash(cannonBtn);
    syncCannon();
  });

  const sideCol = el('div', { class: 'side-col' }, cannonBtn);
  const control = el('div', { class: 'control' }, deckCol, sideCol, quizBox, pad);
  const node = el('section', { class: 'screen battle' }, hud, fieldWrap, control);

  // ── 상태 ───────────────────────────────────────────────────────────────
  let current: Question | null = null;
  let typed = '';
  /** 이 문제가 이미 채점됐나 — 같은 문제 재채점(파밍) 차단 */
  let resolved = false;
  let askedAt = 0;
  let paused = false;
  let raf = 0;
  let lastTs = 0;
  let acc = 0;
  let playMs = 0;
  const renderer = new FieldRenderer(canvas, stageBackground(stageIndex), {
    reduceMotion: save.settings.reduceMotion,
    lowSpec: false,
  });

  function flash(node0: HTMLElement) {
    node0.animate?.([{ filter: 'brightness(1.7)' }, { filter: 'brightness(1)' }], { duration: 180 });
  }

  function nextQuestion() {
    current = quiz.next(battle.dda.level);
    typed = '';
    resolved = false;
    askedAt = performance.now();
    qAsk.textContent = current.ask;
    drawQuestion();
  }

  function drawQuestion() {
    if (!current) return;
    const slot = typed.padEnd(current.digits ?? 1, '_');
    qLine.innerHTML = `${current.prompt} = <span class="slot">${slot}</span>`;
  }

  function press(k: string) {
    // 🔴 `resolved` 가 없으면 **같은 문제를 몇 번이고 다시 채점**할 수 있다.
    //    채점 후 다음 문제까지 260ms(오답 공개는 1200ms) 동안 current 가 살아 있는데,
    //    그동안 ⌫ 로 한 자 지우고 같은 답을 다시 넣으면 answer(true) 가 또 실행돼
    //    셈력·대포·배속을 문제 하나로 무한히 채울 수 있었다(교차검증 지적, 코드로 재현 확인).
    if (paused || !current || resolved || battle.status !== 'playing') return;
    if (k === 'back') { typed = typed.slice(0, -1); drawQuestion(); return; }
    const need = current.digits ?? 2;
    if (typed.length >= need) return;
    play('tap');
    typed += k;
    drawQuestion();
    if (typed.length >= need) submit();
  }

  function showHint() {
    if (!current) return;
    qFb.className = 'fb';
    qFb.textContent = `💡 ${quiz.useHint()}`;
  }

  function submit() {
    if (!current || resolved) return;
    const ms = performance.now() - askedAt;
    const value = Number(typed);
    const res = quiz.submit(value, ms);
    // 🔴 0.4초 미만 입력은 콤보로 인정하지 않는다(연타·찍기 방지)
    const counts = ms >= MIN_ANSWER_MS;
    if (res.correct) {
      resolved = true;                       // 이 문제는 끝났다 — 재채점 금지
      const gained = battle.answer(true, ms, counts);
      play('correct');
      qFb.className = 'fb ok';
      // 🔴 그릇이 꽉 차 실제로 못 받은 만큼을 "+46" 이라 적으면 아이에게 거짓말이 된다.
      //    answer() 가 돌려주는 값은 **실제로 담긴 양**이다.
      qFb.textContent = gained > 0 ? `잘했어! +${Math.round(gained)}` : '잘했어! 셈력 그릇이 가득 찼어요';
      setTimeout(() => { if (battle.status === 'playing') nextQuestion(); }, 260);
    } else {
      battle.answer(false, ms);
      play('wrong');
      qFb.className = 'fb no';
      quizBox.classList.remove('shake');
      void quizBox.offsetWidth;
      quizBox.classList.add('shake');
      if (res.reveal) {
        resolved = true;               // 정답을 보여 줬으므로 이 문제로 더 얻을 수 없다
        qFb.textContent = `정답은 ${res.answer}. ${res.hint}`;
        setTimeout(() => { if (battle.status === 'playing') nextQuestion(); }, 1200);
      } else {
        qFb.textContent = `다시 생각해 보자 — ${res.hint}`;
        typed = '';
        drawQuestion();
      }
    }
  }

  function togglePause() {
    paused = !paused;
    pauseBtn.textContent = paused ? '▶ 계속' : '⏸ 잠깐';
    // 🔴 여기서 requestAnimationFrame(loop) 을 부르면 안 된다. loop 은 **일시정지 중에도**
    //    맨 앞에서 자기 자신을 계속 예약하고 있다(멈추는 건 시뮬 갱신뿐). 재개할 때 한 번 더
    //    예약하면 rAF 사슬이 하나씩 늘어나, 잠깐 버튼을 N번 누르면 N+1개가 동시에 돈다.
    //    결과: 판이 끝날 때 finish() 가 N+1번 실행돼 **판 수·놀이시간·주간 순위 점수가 부풀었다**
    //    (실측: 5번 눌렀더니 한 판이 6판으로 저장됨). Esc 키도 같은 경로라 더 쉽게 터진다.
    //    루프는 이미 살아 있으므로 재개에 필요한 건 없다 — 직전 프레임 시각만 초기화한다.
    if (!paused) lastTs = 0;
  }

  function syncDeck() {
    // 🔴 전장 상한(ALLY_CAP)에 걸린 경우도 이유를 보여 준다. 상한이 60이던 시절엔 실제로
    //    닿는 일이 드물어 '셈력 부족'만 있으면 됐지만, 16으로 줄인 뒤로는 자주 닿는다 —
    //    그대로 두면 셈력도 충분하고 쿨다운도 끝났는데 눌러도 아무 일이 없는,
    //    바로 그 '고장난 버튼'이 된다(대포에서 겪은 것과 같은 실패).
    const full = battle.aliveAllies >= ALLY_CAP;
    for (const c of cards) {
      const cd = battle.cooldownLeft(c.id);
      const poor = battle.money < c.def.cost;
      const blocked = poor || full;
      c.cool.textContent = cd > 0 ? `${cd.toFixed(1)}` : '';
      c.cool.style.display = cd > 0 ? 'grid' : 'none';
      c.why.textContent = poor ? '셈력 부족' : '전장이 가득';
      c.why.style.display = !blocked || cd > 0 ? 'none' : 'block';
      c.card.classList.toggle('locked', blocked && cd <= 0);
      c.card.disabled = false; // 눌러도 되지만 이유를 보여준다(왜 안 되는지 알려주는 게 낫다)
    }
  }

  function syncCannon() {
    const ready = battle.cannonReady;
    cannonFill.style.height = `${Math.round(battle.cannonCharge * 100)}%`;
    cannonBtn.classList.toggle('ready', ready);
    cannonBtn.disabled = !ready;
  }

  function syncHud() {
    // 🔴 게이지 기준은 **실제 그릇**이다. 예전엔 600 고정이라 상한이 없는데도 꽉 찬 것처럼 보였다.
    const full = battle.money >= battle.manaMax;
    manaFill.style.width = `${Math.min(100, (battle.money / battle.manaMax) * 100)}%`;
    manaFill.classList.toggle('full', full);
    manaText.textContent = `${Math.floor(battle.money)} / ${battle.manaMax}`;
    manaText.classList.toggle('full', full);
    comboText.textContent = battle.combo >= 3 ? `콤보 ×${comboMul(battle.combo).toFixed(1)} ⚡${battle.combo}` : '';
    speedText.textContent = hasteLabel(battle.haste);
    timeText.textContent = `${Math.floor(battle.t)}초 / ${MAX_SEC}초`;
  }

  /** 🔴 종료 처리는 **정확히 한 번**이어야 한다 — 두 번 돌면 판 수·놀이시간·주간 점수가 곱절이 된다.
   *  원인 하나(일시정지 rAF 중복)는 togglePause 에서 막았지만, 종료는 저장에 쓰기까지 하는
   *  경로라 다른 이유로 두 번 들어와도 안전하도록 여기서도 잠근다(관문 화면과 같은 방식). */
  let finished = false;

  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    if (battle.status === 'win') play('win');
    const nx = nextTier(save.challenge.tier, save.challenge.streak, battle.outcome);
    const r: BattleResult = {
      status: battle.status === 'playing' ? 'draw' : battle.status,
      stage: stageIndex,
      solved: battle.solved,
      correct: battle.correct,
      seconds: battle.t,
      answerMs: battle.answerMs,
      tier: battle.tier,
      nextTier: nx.tier,
    };
    store.update((d) => {
      d.edu.playMs += playMs;
      d.edu.rounds += 1;
      // 🔴 다음 판 난이도를 이 판의 결과로 정한다. 올릴 땐 두 판 연속 여유롭게 이겼을 때만,
      //    내릴 땐 한 판만 져도 바로 — 비대칭이 의도다(막히는 아이를 붙잡아 두지 않는다).
      d.challenge.tier = nx.tier;
      d.challenge.streak = nx.streak;
      // 주간 순위 버킷. 동의 여부와 무관하게 로컬에는 쌓는다 —
      // 나중에 켰을 때 "이번 주 기록이 0"이 되면 아이 입장에선 손해다.
      bumpWeeklyNow(d, { correct: battle.correct, playMs, stage: r.status === 'win' ? stageIndex : 0 });
    });
    onDone(r);
  }

  function loop(ts: number) {
    raf = requestAnimationFrame(loop);
    if (paused) { lastTs = ts; return; }
    if (!lastTs) lastTs = ts;
    const dtMs = Math.min(250, ts - lastTs);
    lastTs = ts;
    playMs += dtMs;
    // 🔴 신바람은 **아군 유닛에만** 걸린다. 여기(세상의 시계)에는 손대지 않는다 —
    //    시간을 압축하면 같은 판에서 푸는 문제 수가 줄어 학습량 하한이 깨진다(실측).
    acc += dtMs / 1000;
    let steps = 0;
    while (acc >= DT && steps < MAX_STEPS_PER_FRAME) {
      battle.step(DT);
      acc -= DT;
      steps++;
    }
    if (acc > DT * MAX_STEPS_PER_FRAME) acc = 0; // 백그라운드 복귀 시 밀린 시간 버림

    // 이벤트 소비 (히트 시 살짝 흔들기)
    if (battle.events.length) {
      // 🔴 'die' 는 예전에 **아무도 안 읽었다** — 적이 나타나 0.3초 만에 사라져도 화면에
      //    아무 표시가 없어 "적이 안 나온다"로 보였다. 쓰러진 자리를 잠깐 남긴다.
      for (const e of battle.events) {
        if (e.type === 'die') renderer.puff(e.x, e.side);
        // 'spawn' 도 같은 이유로 읽는다 — 나오는 순간과 쓰러지는 순간이 짝이어야
        // "성문에서 나왔다가 맞고 쓰러졌다"가 한 장면으로 읽힌다.
        else if (e.type === 'spawn') renderer.gate();
      }
      if (battle.events.some((e) => e.type === 'castleHit')) { renderer.shake(4); play('hit'); }
      else if (battle.events.some((e) => e.type === 'hit')) play('hit');
      battle.events.length = 0;
    }

    renderer.draw(battle, ts);
    // 🔴 검수 하네스는 여기서 값을 읽는다. 화면 글자를 파싱하게 두면 표기를 바꾼 순간
    //    ("123" → "123 / 960") 검사가 NaN 으로 조용히 무너진다 — 실제로 한 번 그랬다.
    window.__gugu__ = {
      ...(window.__gugu__ ?? {}),
      units: battle.units.length, t: battle.t, status: battle.status,
      tier: battle.tier,
      breakers: battle.units.filter((u) => u.side === -1 && u.hp > 0 && u.breaker).length,
      money: battle.money, manaMax: battle.manaMax, haste: battle.haste,
      // 가속은 순간값이라 스냅샷 시점엔 이미 풀려 있을 수 있다 — 최고치를 따로 남긴다
      maxHasteSeen: Math.max(Number(window.__gugu__?.['maxHasteSeen'] ?? 1), battle.haste),
      // 성 체력은 비율로 준다 — 판마다 절대값이 달라 하네스에서 비교가 안 된다
      hpThem: stage.castleHp > 0 ? battle.castleHp / stage.castleHp : 0,
      hpUs: stage.playerCastleHp > 0 ? battle.playerCastleHp / stage.playerCastleHp : 0,
      // 🔴 "전선이 어디에 서 있는가"는 재미를 좌우하는데 유닛 **수**만으로는 안 보인다.
      //    아군이 적 성 앞에 눌러앉으면 적은 나오는 즉시 죽어 화면에 아무 일도 안 일어난다.
      allies: battle.units.reduce((n, u) => n + (u.side === 1 && u.hp > 0 ? 1 : 0), 0),
      enemies: battle.units.reduce((n, u) => n + (u.side === -1 && u.hp > 0 ? 1 : 0), 0),
      allyFront: battle.units.reduce((m, u) => (u.side === 1 && u.hp > 0 ? Math.max(m, u.x) : m), 0),
      // 🔴 지금 무엇을 묻고 있는지. 화면 글자만으로는 **유형·레벨을 복원할 수 없어**
      //    "난이도가 실제로 오르는가"를 측정할 방법이 없다(레벨은 프롬프트에 안 드러난다).
      q: current ? { key: current.key, type: current.type, level: current.level, dda: battle.dda.level } : null,
    };
    syncHud();
    syncDeck();
    syncCannon();

    if (battle.status !== 'playing') finish();
  }

  // 중간에 탭을 닫아도 공부한 기록이 남도록 주기 저장
  const autosave = setInterval(() => { store.update(() => {}); }, 30000);

  const onResize = () => renderer.resize();
  window.addEventListener('resize', onResize);

  // 키보드: 숫자키/백스페이스 — 🔴 e.key만 보면 한글 입력 상태에서 전멸하므로 e.code도 함께 본다
  const onKey = (e: KeyboardEvent) => {
    if (e.key >= '0' && e.key <= '9') { press(e.key); return; }
    const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
    if (m) { press(m[1]!); return; }
    if (e.key === 'Backspace' || e.code === 'Backspace') { e.preventDefault(); press('back'); }
    if (e.code === 'Escape') togglePause();
  };
  window.addEventListener('keydown', onKey);

  // 시작
  queueMicrotask(() => {
    renderer.resize();
    nextQuestion();
    raf = requestAnimationFrame(loop);
  });

  const teardown: Teardown = () => {
    clearInterval(autosave);
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKey);
  };

  return { node, teardown };
}
