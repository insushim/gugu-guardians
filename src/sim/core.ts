import type { BattleSnapshot, BattleStatus, LiveUnit, StageDef } from './types';
import { ALLY_BY_ID, ALLY_CAP, ENEMY_BY_ID } from './units';
import { allyGrowth, MAP_LEN, MAX_SEC } from './stages';
import {
  baseRegen, comboMul, newDda, rewardFor, START_MONEY, stepDda,
  type DdaState,
} from './economy';

/**
 * 전투 시뮬레이션 코어 — DOM/렌더러 의존 0. 고정 타임스텝.
 *
 * 🔎 전투 추상화(중요): 앞줄 유닛들이 겹쳐 서서 함께 때리는 '클러스터' 모델이다.
 *    이 장르(라인 디펜스)의 실제 거동에 가깝다. 엄격한 1열 차단 모델로 실험하면
 *    한 번에 1기만 교전해 '물량' 자체가 무의미해진다(실측).
 *    다만 이 근사는 "빠른 적이 아군 무리를 지나쳐 성을 때리는" 누수를 완전히 막지 못하므로,
 *    렌더 계층에서 유닛을 겹쳐 그리되 **적이 아군 전선을 지나치지 못하도록** 전진 상한을 둔다(아래 참조).
 */
export class Battle {
  readonly stage: StageDef;
  t = 0;
  money = START_MONEY;
  combo = 0;
  dda: DdaState = newDda();
  units: LiveUnit[] = [];
  castleHp: number;
  playerCastleHp: number;
  status: BattleStatus = 'playing';
  solved = 0;
  correct = 0;
  answerMs = 0;

  private uidSeq = 1;
  private growth: number;
  private cooldowns = new Map<string, number>();
  private spawnNext = new Map<string, number>();
  private spawnCount = new Map<string, number>();
  /** 렌더/사운드가 소비하는 1회성 이벤트 큐 */
  events: { type: 'hit' | 'die' | 'summon' | 'castleHit'; x: number; side: 1 | -1 }[] = [];

  constructor(stage: StageDef) {
    this.stage = stage;
    this.growth = allyGrowth(stage.index);
    this.castleHp = stage.castleHp;
    this.playerCastleHp = stage.playerCastleHp;
    for (const s of stage.spawns) this.spawnNext.set(s.id, s.t0);
  }

  get aliveAllies(): number {
    let n = 0;
    for (const u of this.units) if (u.side === 1 && u.hp > 0) n++;
    return n;
  }

  cooldownLeft(defId: string): number {
    return Math.max(0, (this.cooldowns.get(defId) ?? 0) - this.t);
  }

  canSummon(defId: string): boolean {
    const def = ALLY_BY_ID.get(defId);
    if (!def || this.status !== 'playing') return false;
    return this.money >= def.cost && this.cooldownLeft(defId) <= 0 && this.aliveAllies < ALLY_CAP;
  }

  summon(defId: string): boolean {
    if (!this.canSummon(defId)) return false;
    const def = ALLY_BY_ID.get(defId)!;
    this.money -= def.cost;
    this.cooldowns.set(defId, this.t + def.cd);
    this.units.push({
      uid: this.uidSeq++,
      side: 1,
      defId,
      x: 0,
      hp: def.hp * this.growth,
      maxHp: def.hp * this.growth,
      atk: def.atk * this.growth,
      aspd: def.aspd,
      range: def.range,
      spd: def.spd,
      atkAt: 0,
      hurtAt: -99,
      swingAt: -99,
    });
    this.events.push({ type: 'summon', x: 0, side: 1 });
    return true;
  }

  /** 문항 응답 1건 반영. correct=true면 셈력이 즉시 오른다. */
  answer(correct: boolean, elapsedMs: number, countsForCombo = true): number {
    if (this.status !== 'playing') return 0;
    this.solved++;
    this.answerMs += Math.max(0, elapsedMs);
    let gained = 0;
    if (correct) {
      this.correct++;
      gained = rewardFor(this.combo, this.dda.level);
      this.money += gained;
      if (countsForCombo) this.combo++;
    } else {
      this.combo = 0;
    }
    this.dda = stepDda(this.dda, correct);
    return gained;
  }

  /** 고정 타임스텝 1회 전진 */
  step(dt: number): void {
    if (this.status !== 'playing') return;
    this.t += dt;
    this.money += baseRegen(this.stage.index) * dt;

    this.spawnEnemies();
    this.combat(dt);
    this.cleanup();

    if (this.castleHp <= 0) { this.castleHp = 0; this.status = 'win'; return; }
    if (this.playerCastleHp <= 0) { this.playerCastleHp = 0; this.status = 'lose'; return; }
    if (this.t >= MAX_SEC) this.status = 'draw';
  }

  private spawnEnemies(): void {
    for (const s of this.stage.spawns) {
      const next = this.spawnNext.get(s.id);
      if (next === undefined || this.t < next) continue;
      const n = this.spawnCount.get(s.id) ?? 0;
      if (n < s.cap) {
        const e = ENEMY_BY_ID.get(s.id);
        if (e) {
          const m = this.stage.mult;
          this.units.push({
            uid: this.uidSeq++,
            side: -1,
            defId: e.id,
            // 고정형(수문장)은 적 성 앞에 선다
            x: e.spd === 0 ? MAP_LEN - 80 : MAP_LEN,
            hp: e.hp * m,
            maxHp: e.hp * m,
            atk: e.atk * m,
            aspd: e.aspd,
            range: e.range,
            spd: e.spd,
            atkAt: 0,
            hurtAt: -99,
            swingAt: -99,
          });
          this.spawnCount.set(s.id, n + 1);
        }
      }
      this.spawnNext.set(s.id, this.t + s.every);
    }
  }

  private combat(dt: number): void {
    // 적이 아군 전선을 통째로 지나치지 못하도록 하는 상한:
    // 살아있는 아군 중 가장 앞선 위치보다 더 왼쪽으로는 60px까지만 파고들 수 있다.
    let allyFront = -Infinity;
    for (const u of this.units) if (u.side === 1 && u.hp > 0) allyFront = Math.max(allyFront, u.x);
    const enemyFloor = allyFront === -Infinity ? 0 : Math.max(0, allyFront - 60);

    for (const u of this.units) {
      if (u.hp <= 0) continue;
      let target: LiveUnit | null = null;
      let best = Infinity;
      for (const v of this.units) {
        if (v.side === u.side || v.hp <= 0) continue;
        const d = Math.abs(v.x - u.x);
        if (d <= u.range && d < best) { best = d; target = v; }
      }

      const castleDist = u.side === 1 ? Math.abs(MAP_LEN - u.x) : Math.abs(u.x - 0);
      if (!target && castleDist <= u.range) {
        if (this.t >= u.atkAt) {
          if (u.side === 1) this.castleHp -= u.atk;
          else this.playerCastleHp -= u.atk;
          u.atkAt = this.t + u.aspd;
          u.swingAt = this.t;
          this.events.push({ type: 'castleHit', x: u.x, side: u.side });
        }
        continue;
      }

      if (target) {
        if (this.t >= u.atkAt) {
          target.hp -= u.atk;
          target.hurtAt = this.t;
          u.atkAt = this.t + u.aspd;
          u.swingAt = this.t;
          this.events.push({ type: 'hit', x: target.x, side: target.side });
        }
      } else if (u.spd > 0) {
        u.x += u.side * u.spd * dt;
        if (u.side === -1) u.x = Math.max(enemyFloor, u.x);
        u.x = Math.max(0, Math.min(MAP_LEN, u.x));
      }
    }
  }

  private cleanup(): void {
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i]!;
      if (u.hp <= 0) {
        this.events.push({ type: 'die', x: u.x, side: u.side });
        this.units.splice(i, 1);
      }
    }
  }

  snapshot(): BattleSnapshot {
    return {
      t: this.t,
      money: this.money,
      combo: this.combo,
      comboMul: comboMul(this.combo),
      ddaLevel: this.dda.level,
      units: this.units,
      castleHp: this.castleHp,
      castleMaxHp: this.stage.castleHp,
      playerCastleHp: this.playerCastleHp,
      playerCastleMaxHp: this.stage.playerCastleHp,
      status: this.status,
      solved: this.solved,
      correct: this.correct,
      answerMs: this.answerMs,
    };
  }
}
