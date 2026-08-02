import { el } from './dom';
import { RARITY_BY_ID, maxLevel, ALLY_BY_ID, slotsOf } from '../sim/units';
import { assetUrl } from '../render/assets';
import type { RarityId, UnitDef } from '../sim/types';

/**
 * 등급 카드 — 도감·출전·소환이 **같은 조각**을 쓴다.
 * 🔴 화면마다 카드를 따로 그리면 등급 색이 어긋난다(v1에서 실제로 겪은 부류의 문제).
 */

export function rarityColor(r: RarityId): string {
  return RARITY_BY_ID.get(r)?.color ?? '#7A8B99';
}
export function rarityName(r: RarityId): string {
  return RARITY_BY_ID.get(r)?.name ?? '노멀';
}

export interface CardOpts {
  level?: number;
  shards?: number;
  /** 미보유 = 실루엣 */
  owned?: boolean;
  /** 선택 상태(출전 화면) */
  selected?: boolean;
  /** 소환 연출용 등장 효과 */
  reveal?: boolean;
  compact?: boolean;
}

/** 셈지기 카드 한 장 */
export function unitCard(u: UnitDef, o: CardOpts = {}): HTMLElement {
  const owned = o.owned !== false;
  const cls = [
    'ucard',
    `r-${u.rarity}`,
    owned ? '' : 'unowned',
    o.selected ? 'sel' : '',
    o.reveal ? 'reveal' : '',
    o.compact ? 'compact' : '',
  ].filter(Boolean).join(' ');

  const art = el('div', { class: 'ucard-art' },
    el('img', { src: assetUrl(u.id), alt: '', loading: 'lazy' }),
  );
  const body = el('div', { class: 'ucard-body' },
    el('div', { class: 'ucard-name' }, owned ? u.name : '???'),
    el('div', { class: 'ucard-role' }, owned ? u.role : '아직 만나지 못했어요'),
  );

  // 🔴 자리 수는 **고르기 전에** 보여야 한다. 전장 상한이 마리 수가 아니라 자리 수라
  //    전설 넷이면 전장이 꽉 찬다 — 출전 화면에서 그걸 모르면 전투 중에 알게 된다.
  const slots = slotsOf(u);
  const foot = el('div', { class: 'ucard-foot' },
    el('span', { class: 'ucard-cost' }, `셈력 ${u.cost}`),
    owned && slots > 1 ? el('span', { class: 'ucard-slots' }, `자리 ${slots}`) : el('span', {}, ''),
    owned && o.level ? el('span', { class: 'ucard-lv' }, `Lv.${o.level}`) : el('span', {}, ''),
  );

  const card = el('div', { class: cls },
    el('span', { class: 'ucard-rarity' }, rarityName(u.rarity)),
    art, body, foot,
  );
  card.style.setProperty('--rc', rarityColor(u.rarity));
  if (owned && o.level) {
    const max = maxLevel(u.rarity);
    const bar = el('div', { class: 'ucard-bar' }, el('i', {}));
    (bar.firstChild as HTMLElement).style.width = `${(o.level / max) * 100}%`;
    card.append(bar);
  }
  return card;
}

/** 아이디로 바로 그린다(없으면 null) */
export function unitCardById(id: string, o: CardOpts = {}): HTMLElement | null {
  const u = ALLY_BY_ID.get(id);
  return u ? unitCard(u, o) : null;
}
