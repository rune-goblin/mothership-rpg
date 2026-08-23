/** A d100 or d10 reading its top face as zero: 100 is 00, 10 is 0. */
export const ZERO_BASED_FACES: ReadonlySet<number> = new Set([10, 100]);

/** Doubles are criticals — 00, 11, 22 … 99. */
export const CRIT_DOUBLES: ReadonlySet<number> = new Set([0, 11, 22, 33, 44, 55, 66, 77, 88, 99]);

/** PSG 24 — a d100 Check or Save of 90 or more fails however high the target. Applies only to d100 checks and saves, not the Panic Die or a table's d10. */
export const AUTOFAIL_AT = 90;

/** PSG 24 — every Stat Check, Save and attack is rolled on this. */
export const CHECK_DIE = '1d100';

/** PSG 21.1 — roll the Panic Die and try to roll above your current Stress. */
export const PANIC_DIE = '1d20';

/** The Panic result whose text differs for androids: Heart Attack, or Short Circuit. */
export const ANDROID_PANIC_RESULT = 19;

/** PSG 29.1 — every Wound table. */
export const WOUND_DIE = '1d10';

/** PSG 29.2 — the Death table. */
export const DEATH_DIE = '1d10';

/** Health reduced to zero costs this many Wounds; the surplus damage carries into the refilled bar. */
export const WOUND_ROLLOVER = 1;

export type SkillRank = 'trained' | 'expert' | 'master';

/** PSG 22 — what a skill of each rank adds to the check. Skill items store the rank capitalized. */
export const RANK_BONUS: Readonly<Record<SkillRank, number>> = {
  trained: 10,
  expert: 15,
  master: 20,
};

/** The three ranks, weakest first — the order a picker offers them in. */
export const SKILL_RANKS: readonly SkillRank[] = Object.keys(RANK_BONUS) as SkillRank[];

/** The one place a stored rank (capitalized, e.g. `'Trained'`) becomes a `SkillRank`. An unrecognized rank throws rather than silently defaulting. */
export function skillRank(stored: string): SkillRank {
  const key = String(stored ?? '').trim().toLowerCase();
  if (!Object.hasOwn(RANK_BONUS, key)) throw new Error(`Unknown skill rank: ${JSON.stringify(stored)}`);
  return key as SkillRank;
}

/** The other direction: the capitalized word skill items store, which is also the lang-key suffix. */
export function storedRank(rank: SkillRank): string {
  return `${rank[0].toUpperCase()}${rank.slice(1)}`;
}

export function rankBonus(stored: string): number {
  return RANK_BONUS[skillRank(stored)];
}

/** Whether the book names this rank at all — `skillRank` throws on anything else. */
export function isSkillRank(stored: string): boolean {
  return Object.hasOwn(RANK_BONUS, String(stored ?? '').trim().toLowerCase());
}

/** Carry capacity is Strength over this, rounded up; unarmed damage is the same quotient rounded down. */
export const STR_CAPACITY_DIVISOR = 10;

// `none` is a value, not a blank, so a rangeless weapon (e.g. Ammo) has no unset state to
// reason about.
export const WEAPON_RANGES = ['none', 'adjacent', 'close', 'long', 'extreme'] as const;

/** The stats/saves plus `restSave` and `panicCheck`, the flat key space `rollCheck` dispatches on. */
export const ROLL_SCOPES = [
  'strength',
  'speed',
  'intellect',
  'combat',
  'sanity',
  'fear',
  'body',
  'restSave',
  'panicCheck',
] as const;

export const ROLL_MODIFIERS = ['advantage', 'disadvantage'] as const;

export type Cover = 'none' | 'insignificant' | 'light' | 'heavy';

export interface CoverBonus {
  readonly armorPoints: number;
  readonly damageReduction: number;
}

/** PSG 25 — what the environment adds while you are behind it. */
export const COVER_BONUS: Readonly<Record<Cover, CoverBonus>> = {
  none: { armorPoints: 0, damageReduction: 0 },
  insignificant: { armorPoints: 5, damageReduction: 0 },
  light: { armorPoints: 10, damageReduction: 0 },
  heavy: { armorPoints: 20, damageReduction: 5 },
};

/** The lang key naming each state — printed by the cover prompt and by the sheet's cover control. */
export const COVER_LABEL: Readonly<Record<Cover, string>> = {
  none: 'Mothership.NoCover',
  insignificant: 'Mothership.InsignificantCover',
  light: 'Mothership.LightCover',
  heavy: 'Mothership.HeavyCover',
};

/** The lang key naming what each state looks like — read by the sheet's cover menu. */
export const COVER_EXAMPLES: Readonly<Record<Cover, string>> = {
  none: 'Mothership.UnprotectedOutInTheOpen',
  insignificant: 'Mothership.WoodFurnitureDoorsShields',
  light: 'Mothership.TreesBulkheadWallMetalFurniture',
  heavy: 'Mothership.AirlockDoorsCementBeamsShips',
};

export const COVER_KEYS: readonly Cover[] = Object.keys(COVER_BONUS) as Cover[];
