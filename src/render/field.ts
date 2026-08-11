import type { Battle } from '../sim/core';
import { MAP_LEN } from '../sim/stages';
import { ALLY_BY_ID, ENEMY_BY_ID } from '../sim/units';
import { getImage } from './assets';

/**
 * 전장 렌더러 — Canvas 2D.
 *
 * 🔴 모션은 생성하지 않는다. 정지 키아트 1장 + **코드 변형**으로 움직임을 만든다
 *    (AI는 프레임 간 연속성을 못 만든다 — 반복 실측된 실패).
 *    걷기 = 상하 bob + 미세 기울기 / 공격 = 스윙 + 스쿼시 / 피격 = 흰 틴트 + 넉백.
 * 🔴 저사양(웨일북) 주의: 다수 스프라이트에 비정수 스케일을 상시 적용하지 않는다
 *    (비트맵 fast path 붕괴로 30fps 반락). 기본은 translate/rotate까지만.
 */

export interface RenderOpts {
  reduceMotion: boolean;
  lowSpec: boolean;
}

const SPRITE_H = 96;      // 기준 스프라이트 높이(px) — 스케일 확정표
const GROUND_RATIO = 0.86; // 캔버스 높이 중 지면 위치

/**
 * 성 스프라이트 크기.
 * 🔴 예전엔 높이만 보고 정했다(`min(160, h*0.5)*0.9`). 좁고 높은 화면(휴대폰 세로)에서
 *    성 하나가 가로폭의 37%를 먹었다 — 가로도 같이 본다.
 */
export function castleSize(w: number, h: number): { w: number; h: number } {
  const ch = Math.min(160, h * 0.5, w * 0.18);
  return { w: ch * 0.9, h: ch };
}

/**
 * 전장 좌우 여백. 성은 **전장 밖**에 그리므로(`drawCastle` 참고) 성 한 칸이 통째로 들어가야 한다.
 * 예전엔 `castleW/2` 만 비워 두고 성을 월드 끝점에 중심 정렬했다.
 */
export function fieldPad(w: number, h: number): number {
  return Math.min(w * 0.3, Math.max(56, castleSize(w, h).w + 6));
}

/** 월드 x → 화면 px */
export function worldToScreen(x: number, w: number, h: number): number {
  const pad = fieldPad(w, h);
  return pad + (x / MAP_LEN) * (w - pad * 2);
}
/** 화면 px → 월드 x (테스트가 성 상자를 월드 좌표로 되돌릴 때 쓴다) */
export function screenToWorld(px: number, w: number, h: number): number {
  const pad = fieldPad(w, h);
  return ((px - pad) / (w - pad * 2)) * MAP_LEN;
}

/**
 * 성 스프라이트가 실제로 그려지는 화면 상자. **`drawCastle` 이 이 함수를 쓴다** —
 * 테스트가 여기를 재면 진짜 그리는 자리를 재는 것이 된다(공식을 테스트에 복붙하면
 * 무엇도 검증하지 못한다 — 이미 한 번 겪은 함정이다).
 */
export function castleBox(w: number, h: number, ally: boolean): { x: number; w: number; h: number } {
  const c = castleSize(w, h);
  const cx = worldToScreen(ally ? 0 : MAP_LEN, w, h);
  return { x: ally ? cx - c.w : cx, w: c.w, h: c.h };
}

export class FieldRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0;
  private h = 0;
  shakeUntil = 0;
  private shakeMag = 0;

  constructor(private canvas: HTMLCanvasElement, private bgKey: string, private opts: RenderOpts) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('canvas 2d context를 만들 수 없습니다');
    this.ctx = ctx;
    this.resize();
  }

  setOpts(o: Partial<RenderOpts>) { this.opts = { ...this.opts, ...o }; }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    // 저사양 기기에서 DPR 2 이상은 픽셀을 4배로 늘려 프레임을 먹는다 → 1.5로 캡
    this.dpr = Math.min(this.opts.lowSpec ? 1 : 1.5, globalThis.devicePixelRatio || 1);
    this.w = Math.max(1, Math.floor(r.width));
    this.h = Math.max(1, Math.floor(r.height));
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /**
   * 쓰러진 자리에 잠깐 남는 먹 자국.
   * 🔴 `die` 이벤트는 예전엔 **아무도 소비하지 않았다.** 그래서 적이 나타나 0.3초 만에
   *    사라져도 화면에 아무 표시가 없었고, 아이 눈에는 "적이 아예 안 나온다"로 보였다
   *    (실사용자 보고 + 실측: 전선이 적 성에 닿은 뒤엔 표본 시점마다 적 0마리).
   *    쓰러지는 걸 보여 주는 것만으로 "싸우고 있다"가 읽힌다 — 밸런스는 건드리지 않는다.
   */
  private puffs: { x: number; side: 1 | -1; at: number; big: number }[] = [];
  private static readonly PUFF_MS = 420;

  /**
   * @param big 1 = 보통. 2~3 = 크게 터진다(등급 높은 셈지기·보스).
   * 🔴 예전엔 **모든 처치가 같은 크기**였다. 전설 셈지기가 쓰러지는 것과 숫자벌레 하나가
   *    쓰러지는 것이 화면에서 구분되지 않으면, 등급이라는 게 카드 색깔에만 있고
   *    전장에는 없는 것이 된다(진단 영향 4/10).
   */
  puff(x: number, side: 1 | -1, big = 1): void {
    if (this.opts.reduceMotion) return;
    // 화면을 뒤덮지 않게 상한을 둔다(대포 한 방에 수십 마리가 동시에 죽을 수 있다)
    if (this.puffs.length > 24) this.puffs.shift();
    this.puffs.push({ x, side, at: performance.now(), big: Math.max(1, Math.min(3, big)) });
    if (big >= 2.5) this.hitstop();   // 큰 놈이 쓰러지면 화면이 잠깐 멈춘다
  }

  /**
   * 성문이 열리는 표시 — 적이 나오는 **순간**을 잡아 준다.
   * 적은 성문 앞에서 1초 안팎이면 쓰러지므로(실측), 등장 신호가 없으면 아이는 그 1초를
   * 놓치고 "적이 안 나왔다"고 느낀다. 죽는 자리(`puff`)와 짝을 이루는 표시다.
   */
  private gates: { at: number }[] = [];
  private static readonly GATE_MS = 520;

  gate(): void {
    if (this.opts.reduceMotion) return;
    if (this.gates.length > 6) this.gates.shift();
    this.gates.push({ at: performance.now() });
  }

  shake(mag = 4): void {
    if (this.opts.reduceMotion) return;
    this.shakeMag = mag;
    this.shakeUntil = performance.now() + 180;
  }

  /**
   * 원거리 공격이 **날아가는 것**으로 보이게 한다.
   * 🔴 시뮬은 사거리 안이면 즉시 체력을 깎는다(청룡 사거리 250 vs 짚신이 38). 그래서
   *    멀리서 때리는 셈지기는 제자리에서 0.18초 흔들릴 뿐이고, 아이 눈에는 **뭘 하는지
   *    안 보였다**(실사용자 보고). 이 자국은 그리기 전용 — 맞은 결과는 이미 났고,
   *    날아가는 그림은 그 사실을 눈에 보이게 옮겨 적는 것뿐이라 밸런스에 영향이 없다.
   */
  private shots: { from: number; to: number; side: 1 | -1; at: number }[] = [];
  private static readonly SHOT_MS = 170;
  /** 이 거리(월드) 밖에서 때렸으면 원거리로 본다 — 근접끼리 부딪히는 건 그리지 않는다 */
  private static readonly SHOT_MIN = 62;

  // ── 정답 환호 ──────────────────────────────────────────────────────────
  /**
   * 정답을 맞힌 **순간** 전장에서 벌어지는 일.
   *
   * 🔴 2026-08-11 진단에서 가장 높은 점수를 받은 결함이 여기였다(영향 7/10):
   *    **정답 순간 캔버스 피드백이 0** 이었다. 문제를 맞히면 문제 상자에 작은 글씨가 뜰 뿐,
   *    전장은 아무 반응이 없었다. 반대로 **틀리면** 상자가 흔들린다 —
   *    즉 잘한 것보다 못한 것에 화면이 더 크게 반응하는 역설이었다.
   *    이 게임의 한 줄 컨셉이 "계산이 빨라질수록 내 군대가 강해진다"인데,
   *    그 인과가 화면에서 안 보이면 컨셉이 글로만 있는 것이다.
   *
   * 콤보가 쌓일수록 커지고 색이 올라간다 — 상승감은 크기와 색으로 만든다.
   */
  private cheers: { at: number; combo: number; gained: number }[] = [];
  private static readonly CHEER_MS = 620;

  cheer(gained: number, combo: number): void {
    if (this.cheers.length > 6) this.cheers.shift();
    this.cheers.push({ at: performance.now(), combo, gained });
    // 콤보가 붙으면 화면도 같이 들썩인다(3연속부터). reduceMotion 은 shake 안에서 걸러진다
    if (combo >= 3) this.shake(Math.min(6, 2 + combo * 0.4));
  }

  /**
   * 히트스톱 — 큰 타격 순간 화면을 아주 잠깐 멈춘다.
   * 🔴 프레임을 실제로 멈추지 않는다(시뮬 시계를 건드리면 밸런스가 바뀐다).
   *    **그리기만** 한 프레임 유지하고 살짝 확대해 "묵직함"을 만든다.
   *    관찰 11건 공통 교훈 — 타격감은 그래픽이 아니라 이 정지에서 온다.
   */
  private stopUntil = 0;
  private static readonly STOP_MS = 70;

  hitstop(): void {
    if (this.opts.reduceMotion) return;
    this.stopUntil = performance.now() + FieldRenderer.STOP_MS;
  }

  /**
   * 보스 등장 — 이름을 화면에 크게 띄운다.
   * 🔴 지금은 수문장이 그냥 다른 적처럼 걸어 나온다. 구역의 클라이맥스인데
   *    화면이 아무 말도 안 하면 아이는 그게 보스인 줄 모른다.
   */
  private bossAt = 0;
  private bossName = '';
  private static readonly BOSS_MS = 1500;

  boss(name: string): void {
    this.bossAt = performance.now();
    this.bossName = name;
  }

  /** 검수 하네스가 읽는다 — 화면을 눈으로 세는 대신 숫자로 확인하려고 둔다 */
  cheersShown = 0;
  bossesShown = 0;
  shotsFired = 0;
  sweeps = 0;
  skills = 0;

  shot(from: number, to: number, side: 1 | -1): void {
    if (this.opts.reduceMotion) return;
    if (Math.abs(to - from) < FieldRenderer.SHOT_MIN) return;
    if (this.shots.length >= 40) this.shots.shift();
    this.shots.push({ from, to, side, at: performance.now() });
    this.shotsFired++;
  }

  /**
   * 먹 대포 — 우리 성에서 먹물 파도가 전장을 쓸고 지나간다.
   * 🔴 예전엔 전용 연출이 아예 없었다(화면 흔들림 4px + 기존 피격음뿐).
   *    정답 12개를 모아 쏘는 이 게임 최대의 보상인데 화면에서 아무 일도 안 일어났다.
   */
  private sweepAt = -1;
  private static readonly SWEEP_MS = 620;

  cannonSweep(): void {
    // 🔴 `shotsFired` 와 같은 규칙이어야 한다 — 안 그리는데 세면 하네스가 "연출 났다"로 오판한다
    if (this.opts.reduceMotion) return;
    this.sweepAt = performance.now();
    this.sweeps++;
  }

  /**
   * 전설 셈지기의 특별기술 — 터진 자리에 파동과 기술 이름이 잠깐 뜬다.
   * 🔴 기술이 **일어났다는 사실이 화면에 없으면 없는 기능이다.** 시뮬은 그냥 피해를 몇 배로
   *    줄 뿐이라, 연출이 없으면 아이 눈에는 "가끔 적이 갑자기 많이 죽네" 정도로만 보인다.
   *    가장 귀한 셈지기를 뽑은 보상이 그렇게 묻히면 안 된다.
   */
  private bursts: { x: number; r: number; name: string; side: 1 | -1; at: number; still: boolean }[] = [];
  private static readonly BURST_MS = 760;

  /**
   * 🔴 동작 줄이기(reduceMotion)에서도 **없애지 않는다.** 퍼지는 파동만 끄고 이름은 남긴다 —
   *    소리까지 끈 아이는 기술이 났다는 걸 알 방법이 아예 없어진다(교차검증 지적).
   *    접근성 설정은 "정보를 줄이는" 게 아니라 "움직임을 줄이는" 것이다.
   */
  skill(x: number, r: number, name: string, side: 1 | -1): void {
    if (this.bursts.length >= 6) this.bursts.shift();
    this.bursts.push({ x, r, name, side, at: performance.now(), still: this.opts.reduceMotion });
    this.skills++;
  }

  private castleSize(): { w: number; h: number } { return castleSize(this.w, this.h); }
  private pad(): number { return fieldPad(this.w, this.h); }

  /** 월드 x(0~1000) → 화면 x */
  private sx(x: number): number {
    const pad = this.pad();
    return pad + (x / MAP_LEN) * (this.w - pad * 2);
  }

  draw(b: Battle, now: number): void {
    const { ctx } = this;
    const groundY = this.h * GROUND_RATIO;

    ctx.save();
    if (now < this.shakeUntil) {
      const k = (this.shakeUntil - now) / 180;
      ctx.translate((Math.random() - 0.5) * this.shakeMag * k, (Math.random() - 0.5) * this.shakeMag * k);
    }
    /**
     * 히트스톱 — 시뮬 시계는 그대로 두고 **그림만** 아주 잠깐 확대한다.
     * 🔴 프레임을 실제로 멈추면 밸런스가 바뀐다(같은 판에서 푸는 문항 수가 준다 —
     *    이 프로젝트는 '화면 배속'으로 정확히 그 함정을 한 번 밟았다). 여긴 시각 효과뿐이다.
     */
    if (now < this.stopUntil) {
      const k = (this.stopUntil - now) / FieldRenderer.STOP_MS;
      const z = 1 + 0.012 * k;
      ctx.translate(this.w / 2, this.h / 2);
      ctx.scale(z, z);
      ctx.translate(-this.w / 2, -this.h / 2);
    }

    // 배경
    const bg = getImage(this.bgKey);
    if (bg) {
      ctx.drawImage(bg, 0, 0, this.w, this.h);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, this.h);
      g.addColorStop(0, '#8fc4e8'); g.addColorStop(1, '#cfe6c5');
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);
    }
    // 지면 띠
    ctx.fillStyle = 'rgba(52,40,28,0.20)';
    ctx.fillRect(0, groundY, this.w, this.h - groundY);

    this.drawCastle(groundY, 'castle_ally', b.playerCastleHp / b.stage.playerCastleHp, true);
    this.drawCastle(groundY, 'castle_foe', b.castleHp / b.stage.castleHp, false);
    // 성문 표시는 성 **위**, 유닛 **아래** — 나오는 적이 표시에 가리지 않게
    this.drawGates(groundY, now);

    // 유닛 — 뒤쪽(작은 x)부터 그려 앞줄이 위에 오게 한다
    const sorted = [...b.units].sort((p, q) => p.x - q.x);
    for (const u of sorted) this.drawUnit(u, groundY, b.t);

    this.drawShots(groundY, now);
    this.drawPuffs(groundY, now);
    this.drawSweep(groundY, now);
    // 특별기술은 맨 위 — 이 게임에서 가장 귀한 순간이라 무엇에도 가리지 않는다
    this.drawBursts(groundY, now);
    this.drawCheers(groundY, now);
    this.drawBoss(now);
    ctx.restore();
  }

  /**
   * 정답 환호 — 우리 성 위에서 먹물이 솟아오른다.
   * 🔴 **reduceMotion 이어도 지우지 않는다.** 동작을 줄이라는 설정이지 정보를 지우라는
   *    설정이 아니다(진단 영향 4/10). 떠오르는 움직임만 없애고 글자는 남긴다 —
   *    같은 원칙을 `drawBursts` 의 `still` 이 이미 쓰고 있다.
   */
  private drawCheers(groundY: number, now: number): void {
    if (!this.cheers.length) return;
    const { ctx } = this;
    const x = this.sx(0) + 6;
    for (let i = this.cheers.length - 1; i >= 0; i--) {
      const c = this.cheers[i]!;
      const k = (now - c.at) / FieldRenderer.CHEER_MS;
      if (k >= 1) { this.cheers.splice(i, 1); continue; }
      const rise = this.opts.reduceMotion ? 26 : 26 + k * 34;
      const y = groundY - 58 - rise;
      // 콤보가 붙을수록 크고 뜨겁게 — 상승감은 크기와 색으로 만든다
      const size = 17 + Math.min(12, c.combo * 1.6);
      const color = c.combo >= 8 ? '#d4342f' : c.combo >= 5 ? '#e08a1e' : c.combo >= 3 ? '#c8a02c' : '#1b4f8c';
      ctx.globalAlpha = this.opts.reduceMotion ? 1 - k * 0.5 : 1 - k;
      ctx.font = `900 ${size}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(250,246,238,0.95)';
      const label = c.combo >= 3 ? `+${c.gained}  ⚡${c.combo}` : `+${c.gained}`;
      ctx.strokeText(label, x, y);
      ctx.fillStyle = color;
      ctx.fillText(label, x, y);
    }
    ctx.globalAlpha = 1;
  }

  /** 수문장 등장 — 이름을 크게 한 번 띄운다. 구역의 클라이맥스라 화면이 말을 해야 한다 */
  private drawBoss(now: number): void {
    if (!this.bossName) return;
    const k = (now - this.bossAt) / FieldRenderer.BOSS_MS;
    if (k >= 1) { this.bossName = ''; return; }
    const { ctx } = this;
    // 들어올 때 커지고 나갈 때 사라진다. reduceMotion 이면 크기 변화 없이 뜨기만
    const grow = this.opts.reduceMotion ? 1 : Math.min(1, k * 5);
    ctx.globalAlpha = k > 0.75 ? (1 - k) * 4 : 1;
    ctx.save();
    ctx.translate(this.w / 2, this.h * 0.3);
    ctx.scale(grow, grow);
    ctx.textAlign = 'center';
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(34,29,26,0.9)';
    ctx.strokeText(this.bossName, 0, 0);
    ctx.fillStyle = '#e8b33a';
    ctx.fillText(this.bossName, 0, 0);
    ctx.font = '900 15px system-ui, sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeText('수문장이 나타났다!', 0, 26);
    ctx.fillStyle = '#faf6ee';
    ctx.fillText('수문장이 나타났다!', 0, 26);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** 특별기술 — 반경만큼 퍼지는 먹 파동 + 기술 이름 */
  private drawBursts(groundY: number, now: number): void {
    if (!this.bursts.length) return;
    const { ctx } = this;
    const scale = (this.w - this.pad() * 2) / MAP_LEN;   // 월드 → 화면 배율
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const s = this.bursts[i]!;
      const k = (now - s.at) / FieldRenderer.BURST_MS;
      if (k >= 1) { this.bursts.splice(i, 1); continue; }
      const cx = this.sx(s.x);
      const cy = groundY - 26;
      // 반경은 실제 광역 반경을 따라간다 — 눈에 보이는 크기와 실제 효과 범위가 같아야
      // 아이가 "저기까지 닿는구나"를 배울 수 있다
      const rMax = Math.max(24, s.r * scale);
      // 동작 줄이기: 고리를 퍼뜨리지 않고 고정 크기로, 글자도 떠오르지 않게 둔다
      const r = s.still ? rMax * 0.8 : rMax * (0.25 + 0.75 * k);
      const fade = s.still ? (k < 0.75 ? 1 : (1 - k) * 4) : 1 - k;

      ctx.save();
      ctx.globalAlpha = 0.55 * fade;
      ctx.strokeStyle = s.side === 1 ? '#f4d03f' : '#d4342f';
      ctx.lineWidth = 6 * fade + 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = 0.22 * fade;
      ctx.fillStyle = s.side === 1 ? 'rgba(244,208,63,1)' : 'rgba(212,52,47,1)';
      ctx.fill();

      // 기술 이름 — 위로 살짝 떠오른다
      ctx.globalAlpha = Math.min(1, fade * 1.8);
      ctx.font = '900 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(20,16,14,0.9)';
      ctx.fillStyle = s.side === 1 ? '#ffe98a' : '#ffc9c6';
      const ty = cy - rMax * 0.5 - 10 - (s.still ? 0 : k * 16);
      ctx.strokeText(s.name, cx, ty);
      ctx.fillText(s.name, cx, ty);
      ctx.restore();
    }
  }

  /** 날아가는 먹덩이 — 출발점에서 목표까지 짧게 호를 그린다 */
  private drawShots(groundY: number, now: number): void {
    if (!this.shots.length) return;
    const { ctx } = this;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]!;
      const k = (now - s.at) / FieldRenderer.SHOT_MS;
      if (k >= 1) { this.shots.splice(i, 1); continue; }
      const x = this.sx(s.from + (s.to - s.from) * k);
      // 어깨 높이에서 떠서 목표로 떨어진다 — 포물선이라 "던졌다"가 읽힌다
      const y = groundY - 34 - Math.sin(k * Math.PI) * 16;
      ctx.save();
      // 꼬리 — 진행 방향 반대로 옅게 끈다
      const tail = this.sx(s.from + (s.to - s.from) * Math.max(0, k - 0.18));
      const g = ctx.createLinearGradient(tail, y, x, y);
      const col = s.side === -1 ? '34,29,26' : '212,52,47';   // 적을 맞히면 먹빛, 아군이 맞으면 주홍
      g.addColorStop(0, `rgba(${col},0)`);
      g.addColorStop(1, `rgba(${col},.8)`);
      ctx.strokeStyle = g; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(tail, y); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = `rgba(${col},.92)`;
      ctx.beginPath(); ctx.arc(x, y, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  /** 먹 대포 — 우리 성에서 먹물 파도가 전장을 쓸고 간다 */
  private drawSweep(groundY: number, now: number): void {
    if (this.sweepAt < 0) return;
    const k = (now - this.sweepAt) / FieldRenderer.SWEEP_MS;
    if (k >= 1) { this.sweepAt = -1; return; }
    const { ctx } = this;
    const head = this.sx(0) + (this.sx(MAP_LEN) - this.sx(0)) * Math.min(1, k * 1.2);
    const back = Math.max(0, head - 260);
    const a = 1 - k * k;                       // 뒤로 갈수록 빨리 옅어진다
    const top = groundY - this.h * 0.82;       // 하늘까지 올라와야 "쓸고 간다"가 읽힌다
    ctx.save();
    // 먹물 본체
    const g = ctx.createLinearGradient(back, 0, head, 0);
    g.addColorStop(0, 'rgba(24,19,17,0)');
    g.addColorStop(0.6, `rgba(24,19,17,${0.55 * a})`);
    g.addColorStop(1, `rgba(24,19,17,${0.88 * a})`);
    ctx.fillStyle = g;
    ctx.fillRect(back, top, head - back, groundY - top);
    // 앞머리 — 밝은 금빛 띠 한 줄. 어두운 본체와 대비돼 진행 방향이 한눈에 읽힌다
    const eg = ctx.createLinearGradient(head - 26, 0, head + 8, 0);
    eg.addColorStop(0, 'rgba(232,179,58,0)');
    eg.addColorStop(1, `rgba(255,236,170,${0.95 * a})`);
    ctx.fillStyle = eg;
    ctx.fillRect(head - 26, top, 34, groundY - top);
    // 튀는 먹방울 — 위아래로 흩어져 "터졌다"를 만든다
    for (let i = 0; i < 14; i++) {
      const t = i / 14;
      const r = 3 + ((i * 7) % 5);
      const y = top + (groundY - top) * ((i * 0.37) % 1);
      const dx = ((i % 3) - 1) * 26 - k * 40;
      ctx.fillStyle = i % 4 === 0
        ? `rgba(255,236,170,${0.8 * a})`
        : `rgba(24,19,17,${(0.5 + t * 0.4) * a})`;
      ctx.beginPath();
      ctx.arc(head + dx, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 성문이 열린다 — 적 성 안쪽 면에서 빛이 번지고 땅에 그림자가 진다 */
  private drawGates(groundY: number, now: number): void {
    if (!this.gates.length) return;
    const { ctx } = this;
    const gx = this.sx(MAP_LEN);
    const { h: ch } = this.castleSize();
    for (let i = this.gates.length - 1; i >= 0; i--) {
      const g = this.gates[i]!;
      const k = (now - g.at) / FieldRenderer.GATE_MS;
      if (k >= 1) { this.gates.splice(i, 1); continue; }
      const a = 1 - k;
      const gh = ch * 0.55;
      const gw = gh * 0.5 * (0.7 + k * 0.6);
      ctx.save();
      const grd = ctx.createLinearGradient(gx, 0, gx + gw, 0);
      grd.addColorStop(0, `rgba(255,214,120,${0.75 * a})`);
      grd.addColorStop(1, 'rgba(255,214,120,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(gx, groundY - gh, gw, gh);
      // 발밑 먼지 — 문이 열렸다는 걸 지면에서도 읽게 한다
      ctx.globalAlpha = 0.5 * a;
      ctx.fillStyle = '#6b5a44';
      ctx.beginPath();
      ctx.ellipse(gx, groundY, 14 + k * 22, 5 + k * 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /** 쓰러진 자리 표시 — 먹이 번지듯 커지며 옅어진다 */
  private drawPuffs(groundY: number, now: number): void {
    if (!this.puffs.length) return;
    const { ctx } = this;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i]!;
      const k = (now - p.at) / FieldRenderer.PUFF_MS;
      if (k >= 1) { this.puffs.splice(i, 1); continue; }
      const x = this.sx(p.x);
      const y = groundY - 34 - k * 16 * p.big;
      const r = (9 + k * 17) * p.big;
      ctx.globalAlpha = (1 - k) * (0.55 + (p.big - 1) * 0.14);
      ctx.fillStyle = p.side === -1 ? '#2b2320' : '#1b4f8c';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      // 가운데를 비워 '퍽' 하고 터지는 고리로 — 채운 원만 두면 얼룩처럼 보인다
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  /**
   * 성을 그린다.
   *
   * 🔴 **성은 전장 밖에 세운다 — 월드 끝점에 중심을 맞추지 않는다.**
   *    예전에는 `x = cx - w/2` 로 성의 한가운데를 월드 0/1000 에 뒀다. 성 스프라이트는
   *    월드 단위로 195칸(맵 전체의 19.5%)이나 되기 때문에, 그 **안쪽 절반이 전투 구역을 덮었다.**
   *    실측(900×480): 적 성이 월드 902.7~1097.3 을 차지 → 적은 월드 1000(성 한가운데)에서
   *    태어나고, 근접 아군은 월드 963(역시 성 안쪽)까지 파고들어 멈춘다. 둘 다 검은 성 그림
   *    위에 겹쳐 그려져서, 아이 눈에는 "적이 성에서 안 나온다"로 보였다(실사용자 보고 2회).
   *    이제 성의 **안쪽 면이 월드 끝점**이다 — 성문 앞이 전부 빈 땅이라 교전이 그대로 보인다.
   *    시뮬은 손대지 않는다(밸런스 불변). 순수 좌표 문제였다.
   */
  private drawCastle(groundY: number, key: string, ratio: number, ally: boolean): void {
    const { ctx } = this;
    const img = getImage(key);
    const { x, w, h } = castleBox(this.w, this.h, ally);   // 우리 성은 왼쪽 밖, 적 성은 오른쪽 밖
    const y = groundY - h;
    if (img) {
      ctx.drawImage(img, x, y, w, h);
    } else {
      ctx.fillStyle = ally ? '#1b4f8c' : '#3a2b28';
      ctx.fillRect(x, y, w, h);
    }
    // HP 바 — 색만이 아니라 위치(좌/우)와 라벨로도 구분된다
    // 낮은 화면에서는 성 위 공간이 부족해 HP 바·라벨이 캔버스 위로 잘린다 → 아래로 밀어 둔다
    const bw = w * 1.15, bh = 12, by = Math.max(18, y - 20);
    // 🔴 성이 화면 끝에 붙어 있으면 HP 바가 캔버스 밖으로 잘린다 → 좌우로 가둔다
    //    기준은 월드 끝점(cx)이 아니라 **성 스프라이트의 한가운데**다 — 성을 밖으로 옮긴 뒤로
    //    둘이 반 칸 어긋난다.
    const bx = Math.max(4, Math.min(this.w - bw - 4, x + w / 2 - bw / 2));
    ctx.fillStyle = '#0008'; ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    ctx.fillStyle = '#e6ded1'; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = ally ? '#2e8b6f' : '#d4342f';
    ctx.fillRect(bx, by, bw * Math.max(0, Math.min(1, ratio)), bh);
    // 🔴 라벨은 배경 그림 **위에 그대로** 얹힌다(막아 주는 판이 없다). 흰 글씨만 쓰면
    //    구름·하늘처럼 밝은 배경에서 사라진다(실측: 화면 오른쪽 '엉킴 성'이 안 읽혔다).
    //    바에는 #0008 테두리가 있지만 글자는 바 **밖**(by-6)에 있어 그 보호를 못 받는다.
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000c';
    ctx.lineJoin = 'round';
    ctx.strokeText(ally ? '우리 성' : '엉킴 성', bx + bw / 2, by - 6);
    ctx.fillStyle = '#fff';
    ctx.fillText(ally ? '우리 성' : '엉킴 성', bx + bw / 2, by - 6);
  }

  private drawUnit(u: { side: 1 | -1; defId: string; x: number; hp: number; maxHp: number; hurtAt: number; swingAt: number; spd: number; breaker?: boolean }, groundY: number, simT: number): void {
    const { ctx } = this;
    const def = u.side === 1 ? ALLY_BY_ID.get(u.defId) : ENEMY_BY_ID.get(u.defId);
    const img = getImage(u.defId);
    const scale = def && 'hp' in def ? Math.min(1.5, 0.8 + Math.log10(Math.max(10, def.hp)) * 0.16) : 1;
    const h = SPRITE_H * scale;
    const w = h;
    const x = this.sx(u.x);

    // 걷기 bob — reduce-motion이면 정지
    const moving = u.spd > 0;
    const bob = this.opts.reduceMotion || !moving ? 0 : Math.sin(simT * 7 + u.x * 0.07) * 3;
    // 공격 스윙 (0.18초)
    const sw = simT - u.swingAt;
    const swing = sw >= 0 && sw < 0.18 && !this.opts.reduceMotion ? Math.sin((sw / 0.18) * Math.PI) * 0.28 : 0;
    // 피격 틴트 (0.15초)
    const hurt = simT - u.hurtAt >= 0 && simT - u.hurtAt < 0.15;

    ctx.save();
    ctx.translate(x, groundY + bob);
    if (swing) ctx.rotate(u.side === 1 ? swing : -swing);
    // 🔴 반전하지 않는다. 아군 키아트는 우향, 적 키아트는 좌향으로 생성했으므로
    //    여기서 또 뒤집으면 적이 진행 방향과 반대로 보게 된다(실측).

    if (img) {
      ctx.drawImage(img, -w / 2, -h, w, h);
      if (hurt) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.55;
        ctx.drawImage(img, -w / 2, -h, w, h);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    } else {
      ctx.fillStyle = u.side === 1 ? '#2e8b6f' : '#d4342f';
      ctx.fillRect(-w / 2, -h, w, h);
    }
    ctx.restore();

    // 발밑 링 — 🔴 적아군을 색만으로 구분하지 않는다(모양도 다르게: 아군 원 / 적 삼각)
    ctx.save();
    ctx.translate(x, groundY + 4);
    ctx.strokeStyle = '#221d1a'; ctx.lineWidth = 2;
    // 🔴 돌파형은 **한눈에 달라 보여야 한다.** 전선을 그냥 지나쳐 성으로 달리는 놈이라,
    //    구분이 안 되면 아이 눈에는 "왜 갑자기 성이 깎이지"가 된다.
    //    색만으로 구분하지 않는다(모양도 다르게) — 색각이상 아이도 읽을 수 있어야 한다.
    ctx.fillStyle = u.side === 1 ? 'rgba(46,139,111,.85)'
      : u.breaker ? 'rgba(240,168,40,.92)' : 'rgba(212,52,47,.85)';
    ctx.beginPath();
    if (u.side === 1) { ctx.ellipse(0, 0, 15, 6, 0, 0, Math.PI * 2); }
    else if (u.breaker) {
      // 앞으로 뻗은 화살표 — '지나쳐 간다'가 모양으로 읽힌다
      ctx.moveTo(16, 0); ctx.lineTo(-2, 7); ctx.lineTo(-2, 3);
      ctx.lineTo(-16, 3); ctx.lineTo(-16, -3); ctx.lineTo(-2, -3); ctx.lineTo(-2, -7);
      ctx.closePath();
    }
    else { ctx.moveTo(-14, 5); ctx.lineTo(14, 5); ctx.lineTo(0, -7); ctx.closePath(); }
    ctx.fill(); ctx.stroke();
    ctx.restore();

    // 돌파형에게는 머리 위 표시도 하나 더 — 발밑 링은 앞줄이 겹치면 가려진다
    if (u.breaker) {
      ctx.save();
      ctx.translate(x, groundY - h - 8);
      ctx.fillStyle = 'rgba(240,168,40,.95)';
      ctx.strokeStyle = '#221d1a'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 6); ctx.lineTo(-7, -5); ctx.lineTo(7, -5); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // 체력 바 (다친 유닛만 — 화면을 덜 어지럽힌다)
    if (u.hp < u.maxHp) {
      const bw = 34, bh = 5;
      ctx.fillStyle = '#0009'; ctx.fillRect(x - bw / 2 - 1, groundY - h - 11, bw + 2, bh + 2);
      ctx.fillStyle = '#e6ded1'; ctx.fillRect(x - bw / 2, groundY - h - 10, bw, bh);
      ctx.fillStyle = u.side === 1 ? '#2e8b6f' : '#d4342f';
      ctx.fillRect(x - bw / 2, groundY - h - 10, bw * Math.max(0, u.hp / u.maxHp), bh);
    }
  }
}
