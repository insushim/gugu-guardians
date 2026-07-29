import { Battle } from '../sim/core';
import { stageDef, stageBackground, MAX_SEC } from '../sim/stages';
import { ALLY_BY_ID } from '../sim/units';
import { rarityColor } from './rarity';
import { MIN_ANSWER_MS } from '../sim/economy';
import { FieldRenderer } from '../render/field';
import { assetUrl } from '../render/assets';
import { QuizSession } from '../edu/session';
import type { Question } from '../edu/generator';
import { el, btn, type Teardown } from './dom';
import * as store from '../save/store';
import { play } from '../render/audio';

/**
 * 전투 화면 — Canvas 전장 + DOM UI(숫자패드·덱·HUD).
 *
 * 🔴 주 입력은 숫자패드다. 4지선다를 주 입력으로 쓰면 찍기(무작위 25%)로 게임이 굴러간다(실측).
 * 🔴 오답은 처벌하지 않는다 — 성 HP를 깎지 않고, 콤보만 끊기며 힌트를 준다.
 */

const DT = 1 / 30;              // 시뮬 고정 타임스텝(초)
const MAX_STEPS_PER_FRAME = 5;  // 탭 복귀 시 밀린 시간을 한 번에 몰아 돌리지 않는다

export interface BattleResult {
  status: 'win' | 'lose' | 'draw';
  stage: number;
  solved: number;
  correct: number;
  seconds: number;
  answerMs: number;
}

export function buildBattle(stageIndex: number, deck: string[], onDone: (r: BattleResult) => void): { node: HTMLElement; teardown: Teardown } {
  const save = store.load();
  const stage = stageDef(stageIndex);
  // 승급 레벨을 그대로 넘긴다 — 도감에서 키운 셈지기가 전장에서도 세져야 한다
  const levels: Record<string, number> = {};
  for (const [id, e] of Object.entries(save.roster)) levels[id] = e.level;
  const battle = new Battle(stage, levels);
  const quiz = new QuizSession({ layer: 'L1', types: stage.quizTypes, save, seed: Date.now() % 100000 });

  // ── DOM ────────────────────────────────────────────────────────────────
  const manaFill = el('i');
  const manaText = el('b', { class: 'mana' }, '0');
  const comboText = el('b', { class: 'combo' }, '');
  const timeText = el('span', { class: 'muted' }, '');
  const pauseBtn = btn('⏸ 잠깐', () => togglePause(), 'btn sm ghost');

  const hud = el('div', { class: 'bhud' },
    el('span', {}, '셈력'),
    el('div', { class: 'gauge' }, manaFill),
    manaText, comboText,
    el('span', { class: 'spacer' }), timeText, pauseBtn,
  );

  const deckCol = el('div', { class: 'deck-col' });
  const cards = deck.map((id) => {
    const def = ALLY_BY_ID.get(id)!;
    const cool = el('div', { class: 'cool' }, '');
    const why = el('div', { class: 'why' }, '셈력 부족');
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
  const fieldWrap = el('div', { class: 'field-wrap' }, deckCol, canvas);

  const qAsk = el('div', { class: 'ask' }, '');
  const qLine = el('div', { class: 'q' }, '');
  const qFb = el('div', { class: 'fb' }, '');
  const quizBox = el('div', { class: 'quiz' }, qAsk, qLine, qFb);

  // 4열 numpad 배치:  7 8 9 ⌫ / 4 5 6 힌트 / 1 2 3 0
  const pad = el('div', { class: 'pad' });
  const PAD_LAYOUT: (string | 'back' | 'hint')[] = ['7', '8', '9', 'back', '4', '5', '6', 'hint', '1', '2', '3', '0'];
  for (const k of PAD_LAYOUT) {
    if (k === 'back') pad.append(btn('⌫', () => press('back'), 'btn wide'));
    else if (k === 'hint') pad.append(btn('힌트', () => showHint(), 'btn wide'));
    else pad.append(btn(k, () => press(k)));
  }

  const control = el('div', { class: 'control' }, quizBox, pad);
  const node = el('section', { class: 'screen battle' }, hud, fieldWrap, control);

  // ── 상태 ───────────────────────────────────────────────────────────────
  let current: Question | null = null;
  let typed = '';
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
    if (paused || !current || battle.status !== 'playing') return;
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
    if (!current) return;
    const ms = performance.now() - askedAt;
    const value = Number(typed);
    const res = quiz.submit(value, ms);
    // 🔴 0.4초 미만 입력은 콤보로 인정하지 않는다(연타·찍기 방지)
    const counts = ms >= MIN_ANSWER_MS;
    if (res.correct) {
      const gained = battle.answer(true, ms, counts);
      play('correct');
      qFb.className = 'fb ok';
      qFb.textContent = `잘했어! +${Math.round(gained)}`;
      setTimeout(() => { if (battle.status === 'playing') nextQuestion(); }, 260);
    } else {
      battle.answer(false, ms);
      play('wrong');
      qFb.className = 'fb no';
      quizBox.classList.remove('shake');
      void quizBox.offsetWidth;
      quizBox.classList.add('shake');
      if (res.reveal) {
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
    if (!paused) { lastTs = 0; raf = requestAnimationFrame(loop); }
  }

  function syncDeck() {
    for (const c of cards) {
      const cd = battle.cooldownLeft(c.id);
      const poor = battle.money < c.def.cost;
      c.cool.textContent = cd > 0 ? `${cd.toFixed(1)}` : '';
      c.cool.style.display = cd > 0 ? 'grid' : 'none';
      c.why.style.display = !poor || cd > 0 ? 'none' : 'block';
      c.card.classList.toggle('locked', poor && cd <= 0);
      c.card.disabled = false; // 눌러도 되지만 이유를 보여준다(왜 안 되는지 알려주는 게 낫다)
    }
  }

  function syncHud() {
    const maxShown = 600;
    manaFill.style.width = `${Math.min(100, (battle.money / maxShown) * 100)}%`;
    manaText.textContent = String(Math.floor(battle.money));
    comboText.textContent = battle.combo >= 3 ? `콤보 ×${battle.snapshot().comboMul.toFixed(1)} ⚡${battle.combo}` : '';
    timeText.textContent = `${Math.floor(battle.t)}초 / ${MAX_SEC}초`;
  }

  function finish() {
    cancelAnimationFrame(raf);
    if (battle.status === 'win') play('win');
    const r: BattleResult = {
      status: battle.status === 'playing' ? 'draw' : battle.status,
      stage: stageIndex,
      solved: battle.solved,
      correct: battle.correct,
      seconds: battle.t,
      answerMs: battle.answerMs,
    };
    store.update((d) => { d.edu.playMs += playMs; d.edu.rounds += 1; });
    onDone(r);
  }

  function loop(ts: number) {
    raf = requestAnimationFrame(loop);
    if (paused) { lastTs = ts; return; }
    if (!lastTs) lastTs = ts;
    const dtMs = Math.min(250, ts - lastTs);
    lastTs = ts;
    playMs += dtMs;
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
      if (battle.events.some((e) => e.type === 'castleHit')) { renderer.shake(4); play('hit'); }
      else if (battle.events.some((e) => e.type === 'hit')) play('hit');
      battle.events.length = 0;
    }

    renderer.draw(battle, ts);
    window.__gugu__ = { ...(window.__gugu__ ?? {}), units: battle.units.length, t: battle.t, status: battle.status };
    syncHud();
    syncDeck();

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
