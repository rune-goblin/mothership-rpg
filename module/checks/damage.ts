// Nothing here may import a path that reaches the item's fire or reload methods —
// test/checks-damage.test.ts asserts the import graph.
import {
  asset,
  CARD_FLAG,
  checkCard,
  ownsCard,
  postCard,
  rememberedCard,
  renderCard,
  rollHtml,
  SYSTEM_ID,
  type Card,
  type CardMessage,
  type CardTarget,
  type CardWeapon,
  type PostableRoll,
} from '../chat/cards.ts';
import { formatAction } from '../chat/enrichers.ts';
import { format, localize } from '../i18n.ts';
import { damageString, parseRollSpec } from '../rolls/parse.ts';
import type { Outcome } from '../rolls/resolve.ts';
import { CHECK_SEMANTICS, type Advantage, type RollSpec } from '../rolls/spec.ts';
import { STR_CAPACITY_DIVISOR } from '../rules.ts';
import type { TableKey } from '../tables/tables.ts';
import { cardSource, speakerOf, statOf, type CheckActor, type CheckItem } from './actor.ts';
import { evaluateRoll } from './roll.ts';
import { currentTargets } from './targets.ts';
import { critDamage, damageTheme, type CritDamage } from './settings.ts';

/** The stored damage of a weapon whose damage is the wielder's Strength (PSG 2). */
const UNARMED = 'Str/10';

export interface DamageMode {
  /** What decides this damage — a range band, most often. Blank for the weapon's own. */
  readonly label: string;
  readonly formula: string;
}

export function weaponDamage(item: CheckItem, override: string | null = null): string {
  const system = (item.system ?? {}) as { damage?: unknown };
  const stored = typeof system.damage === 'string' ? system.damage : '';
  return override !== null && override.trim() !== '' ? override : stored;
}

function weaponText(item: CheckItem, key: string): string {
  const system = (item.system ?? {}) as Record<string, unknown>;
  return typeof system[key] === 'string' ? (system[key] as string) : '';
}

export function cardWeapon(item: CheckItem): CardWeapon {
  return {
    _id: item.id,
    name: item.name,
    img: item.img,
    system: { description: weaponText(item, 'description') },
  };
}

export function critFormula(damage: string, mode: CritDamage, critDamageValue: string): string {
  switch (mode) {
    case 'advantage':
      return `{${damage},${damage}}kh`;
    case 'doubleDamage':
      // Parenthesised: `1d10+1 * 2` is Foundry's arithmetic for `1d10 + 2`, which doubles nothing.
      return `(${damage}) * 2`;
    case 'doubleDice':
      return `${damage} + ${damage}`;
    case 'maxDamage':
      // `2d10` becomes `2 * 10`: every die rolling its highest face.
      return damage.replaceAll('d', ' * ');
    case 'weaponValue':
      return critDamageValue === '' ? damage : `${damage} + ${critDamageValue}`;
    case 'none':
      return damage;
  }
}

export interface DamageOptions {
  /** The damage this roll deals, when the caller has one — a swarm's scaled dice. */
  readonly override?: string | null;
  /** Whether the attack that led here was a critical hit. */
  readonly critical?: boolean;
  /** Offer the damage as buttons instead of rolling it: the GM turned auto-rolling off. */
  readonly offer?: boolean;
}

function rangeLabel(item: CheckItem): string {
  const range = (item.system as { range?: unknown }).range;
  return typeof range === 'string' && range !== '' && range !== 'none'
    ? localize(`Mothership.RangeBand.${range}`)
    : '';
}

/** Minus the empty rows the sheet's editor leaves behind. */
function storedModes(item: CheckItem): DamageMode[] {
  const rows = (item.system as { damageModes?: unknown }).damageModes;
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => {
      const mode = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>;
      return {
        label: typeof mode.label === 'string' ? mode.label : '',
        formula: typeof mode.formula === 'string' ? mode.formula.trim() : '',
      };
    })
    .filter((mode) => mode.formula !== '');
}

/** A caller that names the damage has already settled the question, so it gets no alternatives. */
export function damageModes(item: CheckItem, override: string | null = null): DamageMode[] {
  const primary = { label: rangeLabel(item), formula: weaponDamage(item, override) };
  const chosen = override !== null && override.trim() !== '';
  return chosen ? [primary] : [primary, ...storedModes(item)];
}

/** A mode's label cannot carry the braces the action grammar ends a label with. */
const labelText = (label: string): string => label.replace(/[{}]/g, '');

/** `Str/10` is the book's shorthand, not a formula — a button has to carry dice Foundry can roll. */
function rollable(actor: CheckActor, formula: string): string {
  if (formula !== UNARMED) return formula;
  const strength = statOf(actor.system, 'strength');
  return strength === null ? formula : `floor(${strength.value}/${STR_CAPACITY_DIVISOR})`;
}

/** The crit rule is baked in here, so a button rolls the damage its own attack earned. */
function offerHtml(
  actor: CheckActor,
  item: CheckItem,
  modes: readonly DamageMode[],
  critical: boolean,
): string {
  const critRule = critDamage();
  const critValue = weaponText(item, 'critDmg');

  const buttons = modes
    .map((mode) => {
      const base = rollable(actor, mode.formula);
      const formula = critical ? critFormula(base, critRule, critValue) : base;
      const action = formatAction({ verb: 'damage', formula });
      if (mode.label === '') return action;
      return `${action}{${format('Mothership.Chat.DamageModeLabel', {
        damage: damageString(formula),
        mode: labelText(mode.label),
      })}}`;
    })
    .join(' ');

  return format('Mothership.Chat.RollDamageOffer', { damage: buttons });
}

/**
 * What a damage roll actually evaluates: the chosen mode, `Str/10` resolved to dice Foundry can
 * roll, and the crit rule applied on top.
 */
export function damageFormula(actor: CheckActor, item: CheckItem, options: DamageOptions = {}): string {
  const base = rollable(actor, damageModes(item, options.override ?? null)[0].formula);
  return options.critical === true ? critFormula(base, critDamage(), weaponText(item, 'critDmg')) : base;
}

export interface DamageRoll {
  readonly formula: string;
  readonly total: number;
  readonly spec: RollSpec;
  readonly outcome: Outcome;
  /** Whether the damage rolled was the book's `Str/10`, which the card has its own sentence for. */
  readonly unarmed: boolean;
  /** Handed to `postCard` so the dice animate and the message keeps them. */
  readonly roll: PostableRoll;
}

/**
 * Evaluated here rather than left as an `[[inline]]` roll. Foundry enriches a message's content on
 * every client that renders it, and an inline roll is evaluated during that enrichment — so an
 * inline damage roll shows each viewer a different number, and none of them is one this system
 * could apply to anybody.
 */
export async function rollDamageFormula(
  actor: CheckActor,
  item: CheckItem,
  options: DamageOptions = {},
): Promise<DamageRoll> {
  const chosen = damageModes(item, options.override ?? null)[0].formula;
  const formula = damageFormula(actor, item, options);
  const spec = parseRollSpec(formula, CHECK_SEMANTICS['weapon-damage'].aim);
  const { roll, outcome } = await evaluateRoll({ spec, kind: 'weapon-damage', colorset: damageTheme() });

  // Foundry's own arithmetic, not the die `resolveOutcome` kept: keeping one of the pool is a rule
  // about checks, and it would read `2d10` as one d10. `mutate.ts`'s `changeAmount` draws the same line.
  const total = Number(roll.total) || 0;

  return {
    formula,
    total,
    spec,
    outcome: { ...outcome, total },
    unarmed: chosen === UNARMED && statOf(actor.system, 'strength') !== null,
    roll,
  };
}

/** With auto-rolling off, offers every mode instead of stating one — this function doesn't know the range. */
export function damageOffer(actor: CheckActor, item: CheckItem, options: DamageOptions = {}): string {
  return offerHtml(actor, item, damageModes(item, options.override ?? null), options.critical === true);
}

export function damageFlavor(damage: DamageRoll): string {
  const key = damage.unarmed ? 'Mothership.Chat.UnarmedDamage' : 'Mothership.Chat.DamageDealt';
  return (
    format(key, { damage: `<strong>${damage.total}</strong>` }) +
    rollHtml(damage.outcome, { spec: damage.spec, comparison: null })
  );
}

/** The wound tables a weapon can name, as its `woundEffect` field spells them. */
const WOUND_EFFECTS: Readonly<Record<string, TableKey>> = {
  bleeding: 'bleeding',
  'blunt force': 'blunt-force',
  'fire & explosives': 'fire-explosives',
  'gore & massive': 'gore-massive',
  gunshot: 'gunshot',
};

const EFFECT_PATTERN = new RegExp(`(${Object.keys(WOUND_EFFECTS).join('|')})\\s*(?:\\[([+-])\\])?`, 'gi');

const MODIFIERS: Readonly<Record<string, Advantage>> = { '+': 'advantage', '-': 'disadvantage' };

/**
 * Only a recognized wound-effect name becomes a link; the rest of the field's text passes through
 * unchanged. `@Wound`, not `@Table` — a Wound is taken by whoever the card was aimed at, and
 * `@Table` would roll it against whatever the clicker happened to have selected instead.
 */
export function woundEffectActions(effect: string): string {
  return String(effect ?? '').replace(EFFECT_PATTERN, (match, label: string, modifier?: string) => {
    const table = WOUND_EFFECTS[label.toLowerCase()];
    if (table === undefined) return match;
    return formatAction({ verb: 'wound', table, advantage: MODIFIERS[modifier ?? ''] ?? 'none' });
  });
}

export function woundEffectOf(item: CheckItem): string {
  return woundEffectActions(weaponText(item, 'woundEffect'));
}

/** The wound roll a hit leads to: which table, and how the weapon says to roll it. */
export interface WoundRoll {
  readonly table: TableKey;
  readonly advantage: Advantage;
}

/**
 * The row a Wound offers when it is not rolled for you: the roll the rules call for, with a `[-]`
 * and a `[+]` beside it for whoever wants the other one. Symbols rather than sentences, so the
 * three of them fit across a card.
 */
export function woundOffer(wound: WoundRoll): string {
  const at = (advantage: Advantage): string =>
    formatAction({ verb: 'wound', table: wound.table, advantage });

  return `${at('disadvantage')}{[-]} ${at(wound.advantage)} ${at('advantage')}{[+]}`;
}

/** PSG 19 — `[+]` and `[-]` cancel, so a critical worsens a weapon's own advantage rather than losing to it. */
function worse(advantage: Advantage): Advantage {
  return advantage === 'advantage' ? 'none' : 'disadvantage';
}

/**
 * A weapon names its wound effect in prose, and the first table that prose names is the one a
 * Wound from this weapon rolls on. A critical hit rolls it twice and keeps the worse row.
 */
export function woundRollOf(item: CheckItem, critical = false): WoundRoll | null {
  const effect = weaponText(item, 'woundEffect');

  // The pattern is global and shared with `woundEffectActions`, so `exec` would resume from
  // wherever the last call left off.
  EFFECT_PATTERN.lastIndex = 0;
  const match = EFFECT_PATTERN.exec(effect);
  if (match === null) return null;

  const table = WOUND_EFFECTS[match[1].toLowerCase()];
  if (table === undefined) return null;

  const stated = MODIFIERS[match[2] ?? ''] ?? 'none';
  return { table, advantage: critical ? worse(stated) : stated };
}

export function damageCard(
  actor: CheckActor,
  item: CheckItem,
  damage: DamageRoll,
  targets: readonly CardTarget[] = [],
  critical = false,
): Card {
  return checkCard({
    source: cardSource(actor),
    outcome: damage.outcome,
    spec: damage.spec,
    comparison: CHECK_SEMANTICS['weapon-damage'].comparison,
    header: item.name,
    image: item.img || asset('images/icons/ui/attributes/combat.png'),
    attribute: '',
    flavor: damageFlavor(damage),
    weapon: cardWeapon(item),
    woundEffect: woundEffectOf(item),
    damage: true,
    targets,
    damageTotal: damage.total,
    // A damage roll asked for on its own still names the wound its weapon deals.
    wound: woundRollOf(item, critical),
  });
}

/**
 * `forbidden` is a rule, not a failure to route around — a separate card would let a player roll
 * a creature's damage by the back door. `unrecorded` is a card posted before this system kept its
 * own data behind one.
 */
export type CardDamage = 'rewritten' | 'forbidden' | 'unrecorded';

/** The offer becomes the result, in the card that made it, so it cannot be taken twice. */
export async function rollDamageInCard(
  message: CardMessage,
  user: unknown,
  actor: CheckActor,
  item: CheckItem,
  formula: string,
): Promise<CardDamage> {
  if (!ownsCard(message, user)) return 'forbidden';

  const card = rememberedCard(message);
  if (card === null) return 'unrecorded';

  // No `critical`: the button was written carrying the crit rule already applied.
  const damage = await rollDamageFormula(actor, item, { override: formula });
  const flavorText = damageFlavor(damage);
  const data = { ...card.data, flavorText, damageTotal: damage.total };
  const content = await renderCard({ kind: card.kind, data });
  if (content === null) return 'unrecorded';

  await message.update({
    content,
    [`flags.${SYSTEM_ID}.${CARD_FLAG}.data.flavorText`]: flavorText,
    [`flags.${SYSTEM_ID}.${CARD_FLAG}.data.damageTotal`]: damage.total,
  });
  return 'rewritten';
}

/** The whole damage flow: a roll, and the card it earns. No document is written. */
export async function rollDamage(
  actor: CheckActor,
  item: CheckItem,
  options: DamageOptions = {},
): Promise<Card> {
  const damage = await rollDamageFormula(actor, item, options);
  const card = damageCard(actor, item, damage, currentTargets(), options.critical === true);
  await postCard(card, { speaker: speakerOf(actor), roll: damage.roll });
  return card;
}
