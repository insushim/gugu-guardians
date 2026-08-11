import type { BattleStatus, EnemyDef, LiveUnit, StageDef } from './types';
import { ALLY_BY_ID, ALLY_CAP, ENEMY_BY_ID, levelMult, slotsOf } from './units';
import { allyGrowth, enemyBudget, MAP_LEN, MAX_SEC } from './stages';
import { clampTier, tierAoe, tierAtk, tierBreakShare, type MatchOutcome } from './tier';
import {
  baseRegen, cannonDamage, CANNON_CASTLE_SHARE, CANNON_KNOCKBACK, CANNON_PER_CORRECT, cannonMult,
  HASTE_DECAY, HASTE_MAX, HASTE_PER_CORRECT, hasteOf, manaCap, newDda, regenMult, rewardFor,
  START_MONEY, stepDda,
  type DdaState,
} from './economy';

/**
 * 방어력을 뚫지 못한 공격이 그래도 남기는 몫.
 * 🔴 0 으로 두면 약한 셈지기가 무쇠엉킴 앞에서 **영원히 아무 일도 못 한다** —
 *    저학년 게임에서 "때리는데 체력바가 안 움직인다"는 고장으로 읽힌다.
 *    깎이긴 하되 아주 느리게, 가 정답이다.
 */
export const ARMOR_FLOOR = 0.15;

/** 갈래벌레의 새끼가 태어나는 좌우 간격 */
const SPLIT_SPREAD = 26;
/** 한 마리가 갈라져 나올 수 있는 최대 수 — 데이터 오타가 유닛 폭증이 되지 않게 */
const SPLIT_MAX = 4;

/**
 * 먹물로 산 영구 강화. 전투 **밖에서만** 바뀌고 전투는 읽기만 한다.
 * 🔴 위치 인자로 늘리지 않는다 — `new Battle(stage, levels, 0, 2, 0, 3)` 같은 호출은
 *    어느 0이 무엇인지 읽는 사람이 알 수 없고, 한 칸 밀리면 조용히 다른 값이 들어간다.
 */
export interface BattleUpgrades {
  /** 셈력 그릇(용량) 단계 */
  mana?: number;
  /** 셈력 샘(회복 속도) 단계 */
  regen?: number;
  /** 먹 대포 단계 */
  cannon?: number;
}

/**
 * 성문 앞 통로 폭. 아군은 `MAP_LEN - ALLY_CEIL_GAP` 보다 앞으로 못 간다.
 * 🔴 이 값이 0 이면 적이 나올 자리가 사라진다 — 적 스폰 지점(MAP_LEN)과 근접 아군의
 *    정지선이 화면상 23px 까지 붙어, 나오는 적이 아군 스프라이트에 파묻힌 채 죽는다.
 */
export const ALLY_CEIL_GAP = 90;
const ALLY_CEIL = MAP_LEN - ALLY_CEIL_GAP;

/**
 * 예비대 비율 — 스폰 총량 중 **뒤쪽 이만큼은 시간이 아니라 적 성이 깎인 만큼** 나온다.
 * 🔴 판이 끝나는 조건은 시간이 아니라 **적 성 체력 0** 인데 스폰은 시간표만 봤다.
 *    그래서 12판에서 121초짜리 판의 마지막 65초(54%) 동안 적이 한 마리도 안 나왔다.
 *    총량은 그대로 두고 **언제 나오는지만** 성 진행도에 묶는다 —
 *    stages.ts 가 경고한 "느릴수록 적이 누적되는 죽음의 나선"은 총량이 늘어야 생기므로,
 *    총량을 건드리지 않는 이 방식은 그 위험이 없다.
 */
export const RESERVE_SHARE = 0.25;

/**
 * 예비대가 **다 나와 있어야 하는** 성 진행도. 1.0 으로 두면 마지막 예비대가
 * 성이 무너지는 순간 나와 사실상 안 싸운다(실측: 게이트가 오히려 쉬워져 3건 실패).
 */
export const RESERVE_COVER = 0.85;

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
  /** 셈력 샘 배율 — 자동 충전 속도. 먹물로 키운 단계에서 온다 */
  readonly regenMul: number;
  /** 먹 대포 위력 배율 — 먹물로 키운 단계에서 온다 */
  readonly cannonMul: number;
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
  events: {
    type: 'hit' | 'die' | 'summon' | 'castleHit' | 'spawn' | 'skill';
    x: number;
    side: 1 | -1;
    /** 'skill' 일 때만 — 화면에 띄울 기술 이름 */
    name?: string;
    /** 'skill' 일 때만 — 터진 광역 반경 */
    r?: number;
    /** 때린 쪽의 위치. 원거리 공격을 **날아가는 것**으로 그리려면 출발점이 필요하다.
     *  🔴 그리기 전용이다 — 시뮬 수치에는 쓰지 않는다. */
    from?: number;
    /** 'die' 일 때만 — 쓰러진 놈의 덩치(1~3). 등급이 높을수록 크게 터진다.
     *  🔴 그리기 전용. 시뮬 수치에는 쓰지 않는다. */
    big?: number;
  }[] = [];

  /** 보유 셈지기의 승급 레벨 (id → level). 없으면 1로 본다. */
  private levels: Readonly<Record<string, number>>;

  /**
   * 적응형 전투 난이도 단계(0~MAX_TIER). **0 = 오늘의 밸런스와 정확히 동일** —
   * 그래야 못하는 아이(0단계를 못 벗어난다)에게 G2 안전망이 설계상 보장된다.
   */
  readonly tier: number;

  constructor(
    stage: StageDef,
    levels: Readonly<Record<string, number>> = {},
    upgrades: BattleUpgrades = {},
    tier = 0,
  ) {
    this.stage = stage;
    this.levels = levels;
    this.tier = clampTier(tier);   // 🔴 자체 클램프 금지 — NaN 이 새어 들어간다(clampTier 주석 참고)
    this.growth = allyGrowth(stage.index);
    this.castleHp = stage.castleHp;
    this.playerCastleHp = stage.playerCastleHp;
    this.manaMax = manaCap(upgrades.mana ?? 0);
    this.regenMul = regenMult(upgrades.regen ?? 0);
    this.cannonMul = cannonMult(upgrades.cannon ?? 0);
    this.money = Math.min(START_MONEY, this.manaMax);
    for (const s of stage.spawns) this.spawnNext.set(s.id, s.t0);
  }

  /** 이 판의 결과 — 다음 판 난이도를 정하는 입력 */
  get outcome(): MatchOutcome {
    return {
      win: this.status === 'win',
      castleLeft: Math.max(0, this.playerCastleHp / this.stage.playerCastleHp),
      accuracy: this.solved > 0 ? this.correct / this.solved : 0,
    };
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
    const dmg = cannonDamage(enemyBudget(this.stage.index)) * this.growth * this.cannonMul;
    for (const u of this.units) {
      if (u.side !== -1 || u.hp <= 0) continue;
      // 🔴 대포에도 방어력이 걸린다. 안 걸면 무쇠엉킴을 세운 의미가 사라진다 —
      //    "약한 공격은 튕겨 낸다"는 적인데 가장 센 한 방만 예외면 규칙이 아니라 변덕이다.
      this.hurt(u, dmg);
      // 고정형(수문장)은 밀리지 않는다 — 밀면 성 안으로 파고들어 사거리 판정이 깨진다
      if (u.spd > 0) u.x = Math.min(MAP_LEN, u.x + CANNON_KNOCKBACK);
      this.events.push({ type: 'hit', x: u.x, side: -1 });
    }
    // 🔴 성에도 때린다. 예전엔 **살아 있는 적에게만** 피해를 줬는데, 전선이 적 성 앞까지
    //    밀고 올라가면 화면에 적이 한 마리도 없는 시간이 길다(실측: 1판 28초 이후 적군 0마리).
    //    그때 대포를 누르면 충전만 사라지고 아무 일도 안 일어났다 — 아이 눈에는 **고장난 버튼**이다.
    //    정답 열몇 개로 번 것이 아무것도 아닌 게 되면 "정답의 하류에 쾌감을 둔다"는 원칙이 깨진다.
    this.castleHp -= this.stage.castleHp * CANNON_CASTLE_SHARE * this.cannonMul;
    this.events.push({ type: 'castleHit', x: MAP_LEN, side: 1 });
    return true;
  }

  get aliveAllies(): number {
    let n = 0;
    for (const u of this.units) if (u.side === 1 && u.hp > 0) n++;
    return n;
  }

  /**
   * 지금 전장이 쓰고 있는 **자리** 수. 상한(ALLY_CAP)은 마리 수가 아니라 이 값과 비교한다.
   * 🔴 마리 수로 세면 전설만 18기 쌓는 게 언제나 최적이 되어 덱 구성이 사라진다 —
   *    센 셈지기일수록 자리를 더 먹어야 "무엇을 내려놓고 무엇을 낼까"가 선택이 된다.
   */
  get usedSlots(): number {
    let n = 0;
    for (const u of this.units) if (u.side === 1 && u.hp > 0) n += u.slots ?? 1;
    return n;
  }


  cooldownLeft(defId: string): number {
    return Math.max(0, (this.cooldowns.get(defId) ?? 0) - this.t);
  }

  canSummon(defId: string): boolean {
    const def = ALLY_BY_ID.get(defId);
    if (!def || this.status !== 'playing') return false;
    return this.money >= def.cost
      && this.cooldownLeft(defId) <= 0
      && this.usedSlots + slotsOf(def) <= ALLY_CAP;
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
      slots: slotsOf(def),
      ...(def.aoe ? { aoe: def.aoe } : {}),
      ...(def.skill ? { skill: def.skill } : {}),
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

  /**
   * 패배 원인 진단용 계측 — 결과 화면이 "왜 졌는지"를 말하려면 전투가 신호를 남겨야 한다.
   * 🔴 예전엔 결과 화면이 푼 문제 수와 시간만 보여 줬다. 아이는 진 이유를 모른 채
   *    같은 덱으로 같은 판을 다시 눌렀고, 그건 도전이 아니라 반복이다.
   * 🔴 판정이 아니라 **관측만** 한다. 무슨 말을 할지는 UI 가 정한다(여긴 DOM 을 모른다).
   */
  /** 가장 싼 셈지기조차 못 뽑을 만큼 셈력이 말라 있던 시간(초) */
  drySec = 0;
  /** 우리 성을 실제로 때린 적의 연인원 — 전선이 뚫린 정도 */
  leaked = 0;

  /**
   * 이 덱에서 가장 싼 셈지기의 비용 — 마름 판정 기준.
   * 🔴 기본값 0 이다(Infinity 아님). Infinity 면 `money < Infinity` 가 항상 참이라
   *    덱을 안 넘긴 호출(테스트·프로브)에서 **판 전체가 마른 것으로 집계된다.**
   *    안전한 쪽으로 실패하게 둔다 — 덱을 모르면 마름을 보고하지 않는다.
   */
  private cheapestCost = 0;

  /**
   * 이 판에 들고 나온 덱을 알려 준다. **진단 전용** — 시뮬 수치에는 일절 쓰이지 않는다.
   * (안 부르면 마름 계측만 꺼지고 전투 결과는 완전히 동일하다.)
   */
  setDeck(ids: readonly string[]): void {
    let min = Infinity;
    for (const id of ids) {
      const d = ALLY_BY_ID.get(id);
      if (d) min = Math.min(min, d.cost);
    }
    this.cheapestCost = Number.isFinite(min) ? min : 0;
  }

  /** 고정 타임스텝 1회 전진 */
  step(dt: number): void {
    if (this.status !== 'playing') return;
    this.t += dt;
    if (this.money < this.cheapestCost) this.drySec += dt;
    this.money = Math.min(this.manaMax, this.money + baseRegen(this.stage.index) * this.regenMul * dt);
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
      // 예비대: 앞쪽은 시간표대로, 뒤쪽은 적 성이 깎인 만큼 나온다(RESERVE_SHARE 주석 참고).
      // 총량(s.cap)은 그대로다 — 늦게 깬다고 적이 더 나오지는 않는다.
      // 🔴 `ceil` 만 쓰면 cap 1~3 에서 onTime === cap 이 되어 **예비대가 0기**가 된다
      //    (12판은 웨이브 8개 중 4개가 여기 걸렸다 — 주석은 "뒤쪽 25%"라는데 실제론 안 걸렸다).
      //    cap 1(수문장)은 시간표대로 나와야 하므로 예외로 두고, 2 이상은 최소 1기를 남긴다.
      const onTime = s.cap <= 1 ? s.cap : Math.min(s.cap - 1, Math.ceil(s.cap * (1 - RESERVE_SHARE)));
      if (n >= onTime) {
        const progress = 1 - this.castleHp / this.stage.castleHp;
        if (progress < RESERVE_COVER * (n - onTime + 1) / Math.max(1, s.cap - onTime)) {
          // 🔴 여기서 `spawnNext` 를 미루면 안 된다. 미루면 진행도를 넘긴 뒤에도
          //    **다음 폴링(every 초)까지 기다리다**, 그 사이 판이 끝나면 영영 안 나온다
          //    (실측: COVER 0.9 에서 16기 중 2기가 끝내 미출전). 매 프레임 다시 본다.
          continue;
        }
      }
      if (n < s.cap) {
        const e = ENEMY_BY_ID.get(s.id);
        if (e) {
          // 수문장은 구역별 기본 체력 차이를 예산에 맞춰 보정한다(stages.ts 의 hpMul)
          // 🔴 난이도 단계 적용. **0단계에서는 단계발 배율·돌파·광역이 모두 무효**여야 한다
          //    (배율 1.0 · 돌파 0 · 광역 0) — 그게 G2 안전망의 근거다.
          //    태생 능력(e.breaker·e.aoe)은 그와 별개다. 그건 "이 괴수가 원래 그렇다"이고
          //    등장 스테이지·예산 지분으로 조절된다(stages.ts 의 WAVES).
          this.units.push(this.makeEnemy(e, s.hpMul ?? 1, this.breakerRoll(n)));
          this.spawnCount.set(s.id, n + 1);
          // 🔴 적이 **나왔다는 사실 자체**를 렌더러에 알린다. 전선이 적 성에 닿은 뒤로는
          //    적이 성문에서 나오자마자 0.7~1.5초 만에 죽는다(ST1 실측: 3번째 적부터
          //    한 픽셀도 못 움직이고 사망). 그 짧은 등장이 표시되지 않으면 아이 눈에는
          //    "적이 아예 안 나온다"로 보인다 — 실사용자가 두 번 보고한 그 증상이다.
          //    이벤트는 그리기 전용이라 시뮬 수치에는 영향이 없다.
          this.events.push({ type: 'spawn', x: MAP_LEN, side: -1 });
        }
      }
      this.spawnNext.set(s.id, this.t + s.every);
    }
  }

  /**
   * 엉킴괴수 1기를 만든다. 스폰과 분열이 같은 규칙을 쓰도록 한 곳에 모은다 —
   * 두 곳에 적으면 단계 배율이나 방어력이 한쪽에만 붙는 사고가 난다.
   * @param x 생략하면 기본 등장 위치(고정형은 성 앞, 나머지는 성문)
   */
  private makeEnemy(e: EnemyDef, hpMul: number, rollBreaker: boolean, x?: number, canSplit = true): LiveUnit {
    const hp = e.hp * this.stage.mult * hpMul;
    // 돌파형은 **고정형(수문장)에는 걸지 않는다** — 자리를 지키는 게 그 유닛의 역할이다.
    const breaker = e.spd > 0 && (e.breaker === true || rollBreaker);
    // 태생 광역과 단계 광역 중 넓은 쪽. 단계 광역은 느리고 단단한 적·수문장에게만 준다
    // (빠른 잡몹까지 광역이면 전선이 즉사한다).
    const aoe = Math.max(e.aoe ?? 0, e.spd <= 24 ? tierAoe(this.tier) : 0);
    return {
      uid: this.uidSeq++,
      side: -1,
      defId: e.id,
      x: x ?? (e.spd === 0 ? MAP_LEN - 80 : MAP_LEN),
      hp,
      maxHp: hp,
      atk: e.atk * this.stage.mult * tierAtk(this.tier),
      aspd: e.aspd,
      range: e.range,
      // 돌파형은 싸우지 않고 달린다 — 조금 빨라야 "지나간다"가 읽힌다
      spd: breaker ? e.spd * 1.25 : e.spd,
      atkAt: 0,
      hurtAt: -99,
      swingAt: -99,
      ...(breaker ? { breaker: true } : {}),
      ...(aoe > 0 ? { aoe } : {}),
      // 🔴 방어력도 스테이지 배율을 따라 커진다. 고정값으로 두면 아군 공격력만 커져
      //    후반에는 "약한 공격은 튕겨 낸다"가 아무 의미도 없는 장식이 된다.
      ...(e.armor ? { armor: e.armor * this.stage.mult } : {}),
      // 🔴 분열로 태어난 개체에게는 `split` 을 **주지 않는다**(canSplit=false).
      //    지금은 새끼 정의(e_splitlet)에 split 이 없어서 어차피 멈추지만, 그건
      //    데이터가 우연히 그렇다는 뜻이지 코드가 막는다는 뜻이 아니다 —
      //    누가 새끼에게 split 을 달면 그 순간 유닛이 무한 증식한다(교차검증 지적).
      //    총량 유한성은 이 게임의 설계 제약이라(stages.ts 머리말) 코드가 지킨다.
      ...(canSplit && e.split ? { split: { id: e.split.id, n: Math.max(1, Math.min(SPLIT_MAX, Math.floor(e.split.n))) } } : {}),
    };
  }

  /**
   * 이번에 나오는 적이 돌파형인가. **난수를 쓰지 않는다** — 시뮬은 결정론이어야
   * 프로브·parity 테스트가 성립한다. 대신 스폰 순번으로 균등하게 흩뿌린다(Bresenham).
   * 예) 비율 0.25 → 4마리 중 1마리가 돌파형이고, 몰려 나오지 않는다.
   */
  private breakerRoll(n: number): boolean {
    const share = tierBreakShare(this.tier);
    if (share <= 0) return false;
    return Math.floor((n + 1) * share) > Math.floor(n * share);
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
      // 🔴 돌파형은 **대상을 잡지 않는다.** 전선과 싸우지 않고 지나쳐 성으로 간다.
      //    (맞기는 맞는다 — 아군은 지나가는 돌파형을 정상적으로 노린다.)
      //    이게 "아군을 많이 쌓으면 무조건 이긴다"를 깨는 유일한 장치다:
      //    적 체력·물량을 올리는 건 우리 상비군 16기가 길목을 막고 있어 전혀 듣지 않았다(실측).
      if (!u.breaker) {
        for (const v of this.units) {
          if (v.side === u.side || v.hp <= 0) continue;
          const d = Math.abs(v.x - u.x);
          if (d <= u.range && d < best) { best = d; target = v; }
        }
      }

      const castleDist = u.side === 1 ? Math.abs(MAP_LEN - u.x) : Math.abs(u.x - 0);
      // 🔴 성문 앞 통로. 아군이 적 성문(1000)까지 붙어 버리면 **적이 나올 자리가 없다** —
      //    적은 1000에서 나오고 근접 아군은 962에 서므로 화면상 23px, 스프라이트 폭(60~90px)
      //    안쪽이다. 실측: 전선이 성에 닿은 뒤 나온 적 31/31기가 **한 픽셀도 못 움직이고**
      //    평균 0.8초 만에 죽었다. 아이 눈에는 "적이 아예 안 나온다"로 보인 그 증상이다.
      //    적의 enemyFloor(아군 전선을 60 넘게 못 파고든다)와 대칭인 상한이다.
      const atCeil = u.side === 1 && u.x >= ALLY_CEIL - 1e-6;
      if (!target && (castleDist <= u.range || atCeil)) {
        if (this.t >= u.atkAt) {
          // 성에도 특별기술이 걸린다(광역은 의미가 없으니 배율만). 안 걸면 전선이 성에 닿은 뒤로
          // 전설이 영영 기술을 안 쓴다 — 아이 눈에는 "샀는데 안 나오는 기술"이 된다.
          const sw = this.swing(u);
          if (u.side === 1) this.castleHp -= sw.dmg;
          else this.playerCastleHp -= sw.dmg;
          u.atkAt = this.t + u.aspd / hs;
          u.swingAt = this.t;
          if (u.side === -1) this.leaked++;   // 전선을 뚫고 성까지 온 적 — 진단 신호
          this.events.push({ type: 'castleHit', x: u.x, side: u.side });
          // 🔴 여기서도 기술 이벤트를 내보낸다. 배율만 적용하고 알리지 않으면,
          //    전선이 성문에 닿은 뒤로는 전설이 기술을 써도 화면에 아무 일도 안 일어난다 —
          //    바로 위 `swing()` 주석이 경고한 "샀는데 안 나오는 기술"이 그대로 재현된다.
          //    성에는 광역이 의미 없으므로 반경은 0으로 보낸다(렌더러가 최소 크기로 그린다).
          if (sw.special && u.skill) {
            this.events.push({ type: 'skill', x: u.x, side: u.side, from: u.x, name: u.skill.name, r: 0 });
          }
        }
        continue;
      }

      if (target) {
        if (this.t >= u.atkAt) {
          this.strike(u, target);
          u.atkAt = this.t + u.aspd / hs;
          u.swingAt = this.t;
        }
      } else if (u.spd > 0) {
        u.x += u.side * u.spd * hs * dt;
        // 돌파형에게는 전진 상한을 걸지 않는다 — 지나가는 것이 그 유닛의 존재 이유다
        if (u.side === -1 && !u.breaker) u.x = Math.max(enemyFloor, u.x);
        // 아군은 성문 앞 통로를 침범하지 않는다(위 atCeil 주석 참고)
        if (u.side === 1) u.x = Math.min(ALLY_CEIL, u.x);
        u.x = Math.max(0, Math.min(MAP_LEN, u.x));
      }
    }
  }

  /**
   * 이번 한 대의 위력·광역을 정한다. **때린 횟수를 여기서만 센다** —
   * 성 공격과 유닛 공격이 같은 카운터를 써야 "N타마다 한 번"이 아이가 세는 것과 맞는다.
   *
   * 🔴 확률이 아니라 주기다. 시뮬이 결정론이어야 프로브·parity 테스트가 성립하고,
   *    저학년에게도 "몇 대 때리면 나온다"가 운보다 읽기 쉽다.
   */
  private swing(u: LiveUnit): { dmg: number; aoe: number; special: boolean } {
    const hits = (u.hits ?? 0) + 1;
    u.hits = hits;
    const sk = u.skill;
    if (sk && sk.every >= 2 && hits % sk.every === 0) {
      u.skillAt = this.t;
      return { dmg: u.atk * sk.mult, aoe: sk.aoe, special: true };
    }
    return { dmg: u.atk, aoe: u.aoe ?? 0, special: false };
  }

  /**
   * 피해 1건 적용. 방어력이 있으면 깎아 준다.
   * 🔴 완전 무효는 만들지 않는다(ARMOR_FLOOR) — "때리는데 체력바가 안 움직인다"는
   *    저학년에게 전략이 아니라 고장으로 읽힌다.
   */
  private hurt(v: LiveUnit, dmg: number): void {
    const armor = v.armor ?? 0;
    v.hp -= armor > 0 ? Math.max(dmg * ARMOR_FLOOR, dmg - armor) : dmg;
    v.hurtAt = this.t;
  }

  /**
   * 한 대 때린다. 광역이면 **대상 주변에 겹쳐 선 것까지 함께** 맞는다.
   * 🔴 광역은 "뭉쳐 있을수록 손해"를 만든다 — 아군을 한 점에 쌓아 두는 것이
   *    아무 대가 없는 지배 전략이라 판이 밋밋해졌다(실사용자 보고 "긴장감이 없어").
   */
  private strike(u: LiveUnit, target: LiveUnit): void {
    const sw = this.swing(u);
    if (sw.aoe <= 0) {
      this.hurt(target, sw.dmg);
    } else {
      for (const v of this.units) {
        if (v.side === u.side || v.hp <= 0) continue;
        if (Math.abs(v.x - target.x) > sw.aoe) continue;
        this.hurt(v, sw.dmg);
      }
    }
    this.events.push({ type: 'hit', x: target.x, side: target.side, from: u.x });
    if (sw.special && u.skill) {
      this.events.push({ type: 'skill', x: target.x, side: u.side, from: u.x, name: u.skill.name, r: sw.aoe });
    }
  }

  private cleanup(): void {
    /** 분열로 태어난 새끼 — 순회 중에 배열을 늘리지 않으려고 모았다가 한 번에 넣는다 */
    const born: LiveUnit[] = [];
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i]!;
      if (u.hp <= 0) {
        // 덩치 = 아군은 자리 수(등급이 곧 자리다), 적은 걸음이 느린 큰 놈일수록 크게.
        // 🔴 그리기 전용이라 여기서 정해도 시뮬에 영향이 없다.
        const big = u.side === 1
          ? 1 + ((u.slots ?? 1) - 1) * 0.6
          : (u.spd <= 0 ? 3 : u.maxHp >= 900 ? 2.2 : 1);   // 고정형(수문장) > 맷집 큰 놈 > 잡졸
        this.events.push({ type: 'die', x: u.x, side: u.side, big });
        // 🔴 갈라져 나온 새끼는 **다시 갈라지지 않는다.** 새끼의 정의(e_splitlet)에 split 이
        //    없기 때문인데, 이건 데이터에 의존하는 안전장치라 눈에 안 보인다 —
        //    tests/sim.spec.ts 가 "분열은 한 세대에서 멈춘다"를 직접 검사한다.
        //    (총량은 유한하다: 스폰 상한 × n. 느린 플레이어일수록 적이 누적되는
        //     '죽음의 나선'은 총량이 늘어야 생기므로 여기엔 없다 — stages.ts 머리말 참고.)
        const sp = u.split;
        if (sp && u.side === -1) {
          const child = ENEMY_BY_ID.get(sp.id);
          if (child) {
            for (let k = 0; k < sp.n; k++) {
              const dx = (k - (sp.n - 1) / 2) * SPLIT_SPREAD;
              const x = Math.max(0, Math.min(MAP_LEN, u.x + dx));
              born.push(this.makeEnemy(child, 1, false, x, false));
              this.events.push({ type: 'spawn', x, side: -1 });
            }
          }
        }
        this.units.splice(i, 1);
      }
    }
    if (born.length) this.units.push(...born);
  }

}
