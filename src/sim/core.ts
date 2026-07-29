import type { BattleStatus, LiveUnit, StageDef } from './types';
import { ALLY_BY_ID, ALLY_CAP, ENEMY_BY_ID, levelMult } from './units';
import { allyGrowth, enemyBudget, MAP_LEN, MAX_SEC } from './stages';
import {
  baseRegen, cannonDamage, CANNON_KNOCKBACK, CANNON_PER_CORRECT, HASTE_DECAY, HASTE_MAX,
  HASTE_PER_CORRECT, hasteOf, manaCap, newDda, rewardFor, START_MONEY, stepDda,
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
  /** 셈력 그릇(상한) — 먹물로 키운 단계에서 온다 */
  readonly manaMax: number;
  /** 신바람 부스트. 정답으로 오르고 시간으로 풀린다 — **아군에게만** 걸린다 */
  hasteBoost = 0;
  /** 먹 대포 충전(0~1). 정답으로만 찬다 */
  cannonCharge = 0;

  private uidSeq = 1;
  private growth: number;
  private cooldowns = new Map<string, number>();
  private spawnNext = new Map<string, number>();
  private spawnCount = new Map<string, number>();
  /** 렌더/사운드가 소비하는 1회성 이벤트 큐 */
  events: { type: 'hit' | 'die' | 'summon' | 'castleHit'; x: number; side: 1 | -1 }[] = [];

  /** 보유 셈지기의 승급 레벨 (id → level). 없으면 1로 본다. */
  private levels: Readonly<Record<string, number>>;

  constructor(stage: StageDef, levels: Readonly<Record<string, number>> = {}, manaLevel = 0) {
    this.stage = stage;
    this.levels = levels;
    this.growth = allyGrowth(stage.index);
    this.castleHp = stage.castleHp;
    this.playerCastleHp = stage.playerCastleHp;
    this.manaMax = manaCap(manaLevel);
    this.money = Math.min(START_MONEY, this.manaMax);
    for (const s of stage.spawns) this.spawnNext.set(s.id, s.t0);
  }

  /** 지금 아군에게 걸린 가속 배율(1.0~HASTE_MAX) */
  get haste(): number {
    return hasteOf(this.hasteBoost);
  }

  get cannonReady(): boolean {
    return this.cannonCharge >= 1 && this.status === 'playing';
  }

  /**
   * 먹 대포 발사 — 전장의 **적 전체**에 피해를 주고 뒤로 민다.
   * 아군은 건드리지 않는다(저학년 게임에서 "내 편이 다치는 버튼"은 이해 비용이 크다).
   * @returns 실제로 쐈으면 true
   */
  fireCannon(): boolean {
    if (!this.cannonReady) return false;
    this.cannonCharge = 0;
    // 🔴 예산만 쓰면(성장 배율 없이) ST60 에서 보스 체력의 0.16% 가 되어 장식이 된다.
    //    그렇다고 stage.mult 를 곱하면 무한구간 발산(1.05^n)까지 따라가 **소환이 무의미**해진다
    //    (실측: 캠페인 로스터만으로 ST60 도달 → 게이트 '소환 무의미' FAIL).
    //    그래서 **아군 성장선(allyGrowth)** 에 묶는다 — 캠페인 동안은 위력을 유지하고,
    //    무한구간에서는 아군과 함께 뒤처진다. 그 격차를 메우는 게 소환·승급의 역할이다.
    const dmg = cannonDamage(enemyBudget(this.stage.index)) * this.growth;
    for (const u of this.units) {
      if (u.side !== -1 || u.hp <= 0) continue;
      u.hp -= dmg;
      u.hurtAt = this.t;
      // 고정형(수문장)은 밀리지 않는다 — 밀면 성 안으로 파고들어 사거리 판정이 깨진다
      if (u.spd > 0) u.x = Math.min(MAP_LEN, u.x + CANNON_KNOCKBACK);
      this.events.push({ type: 'hit', x: u.x, side: -1 });
    }
    return true;
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
    // 진도 성장(모두에게 자동) × 승급 배율(그 셈지기를 얼마나 키웠나)
    const m = this.growth * levelMult(this.levels[defId] ?? 1);
    this.units.push({
      uid: this.uidSeq++,
      side: 1,
      defId,
      x: 0,
      hp: def.hp * m,
      maxHp: def.hp * m,
      atk: def.atk * m,
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
      const reward = rewardFor(this.combo, this.dda.level, this.stage.index);
      // 🔴 그릇을 넘겨 받지 않는다 — 넘친 만큼은 버려진다. 그래야 "쌓아 두기"가 최적이 안 된다.
      //    돌려주는 값은 **실제로 담긴 양**이다. 명목 보상을 돌려주면 화면이 아이에게 거짓말을 한다.
      const before = this.money;
      this.money = Math.min(this.manaMax, this.money + reward);
      gained = this.money - before;
      // 🔴 부스트에도 상한을 건다. hasteOf() 만 클램프하면 내부 값이 무한히 쌓여
      //    50문제 연속 정답 뒤 최고 가속이 50초 넘게 고정된다("손 놓으면 풀린다"가 깨진다).
      this.hasteBoost = Math.min(HASTE_MAX - 1, this.hasteBoost + HASTE_PER_CORRECT);
      this.cannonCharge = Math.min(1, this.cannonCharge + CANNON_PER_CORRECT);
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
    this.money = Math.min(this.manaMax, this.money + baseRegen(this.stage.index) * dt);
    this.hasteBoost = Math.max(0, this.hasteBoost - HASTE_DECAY * dt);

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
          // 수문장은 구역별 기본 체력 차이를 예산에 맞춰 보정한다(stages.ts 의 hpMul)
          const m = this.stage.mult * (s.hpMul ?? 1);
          this.units.push({
            uid: this.uidSeq++,
            side: -1,
            defId: e.id,
            // 고정형(수문장)은 적 성 앞에 선다
            x: e.spd === 0 ? MAP_LEN - 80 : MAP_LEN,
            hp: e.hp * m,
            maxHp: e.hp * m,
            atk: e.atk * this.stage.mult,
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

    // 신바람은 **아군에게만** 걸린다 — 공격 간격이 짧아지고 걸음이 빨라진다.
    const haste = this.haste;

    for (const u of this.units) {
      if (u.hp <= 0) continue;
      const hs = u.side === 1 ? haste : 1;
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
          u.atkAt = this.t + u.aspd / hs;
          u.swingAt = this.t;
          this.events.push({ type: 'castleHit', x: u.x, side: u.side });
        }
        continue;
      }

      if (target) {
        if (this.t >= u.atkAt) {
          target.hp -= u.atk;
          target.hurtAt = this.t;
          u.atkAt = this.t + u.aspd / hs;
          u.swingAt = this.t;
          this.events.push({ type: 'hit', x: target.x, side: target.side });
        }
      } else if (u.spd > 0) {
        u.x += u.side * u.spd * hs * dt;
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

}
