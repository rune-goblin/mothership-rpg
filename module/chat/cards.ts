import type { ItemCard } from '../documents/item.ts';
import { formatAction } from './enrichers.ts';
import { format, has, localize } from '../i18n.ts';
import type { ReloadOutcome } from '../inventory/ammo.ts';
import type { MutationResult } from '../mutation/mutate.ts';
import { toRollString } from '../rolls/parse.ts';
import type { DieOutcome, Outcome } from '../rolls/resolve.ts';
import { keepOf, type Comparison, type RollSpec } from '../rolls/spec.ts';
import type { TableDraw, TableKey } from '../tables/tables.ts';

export const SYSTEM_ID = 'mothershiprpg';

export function asset(path: string): string {
  return `systems/${SYSTEM_ID}/${path}`;
}

export type CardKind = 'check' | 'table' | 'mutation' | 'item' | 'reload' | 'description';

const TEMPLATES: Readonly<Record<CardKind, string>> = {
  check: 'rollCheck',
  table: 'rollTable',
  mutation: 'modifyActor',
  item: 'modifyItem',
  reload: 'reload',
  description: 'itemRoll',
};

export function templateOf(kind: CardKind): string {
  return asset(`templates/chat/${TEMPLATES[kind]}.html`);
}

export interface Card<D extends object = object> {
  readonly kind: CardKind;
  readonly data: D;
}

export interface CardSource {
  readonly actorId: string | null;
  readonly actorImg: string;
  readonly tokenId: string | null;
}

interface CardOrigin {
  readonly actor: { readonly _id: string | null; readonly img: string };
  readonly tokenId: string | null;
}

function origin(source: CardSource): CardOrigin {
  return { actor: { _id: source.actorId, img: source.actorImg }, tokenId: source.tokenId };
}

export type Voice = 'human' | 'android';

export function voiceOf(robotic: boolean): Voice {
  return robotic ? 'android' : 'human';
}

/** Key is `Mothership.<type>.<context>.<action>.<voice>`. A missing android line falls back to human; a missing entry is `''`. */
export function flavor(voice: Voice, ...path: readonly string[]): string {
  const key = `Mothership.${path.join('.')}`;
  if (has(`${key}.${voice}`)) return localize(`${key}.${voice}`);
  if (has(`${key}.human`)) return localize(`${key}.human`);
  return '';
}

const COMPARE_ICONS: Readonly<Record<Comparison, string>> = {
  '<': 'fa-less-than',
  '<=': 'fa-less-than-equal',
  '>': 'fa-greater-than',
  '>=': 'fa-greater-than-equal',
};

const COMPARE_WORDS: Readonly<Record<Comparison, string>> = {
  '<': 'Mothership.Chat.LessThan',
  '<=': 'Mothership.Chat.LessThanOrEqual',
  '>': 'Mothership.Chat.GreaterThan',
  '>=': 'Mothership.Chat.GreaterThanOrEqual',
};

/** A check with nothing to beat has no verdict, so it prints none. */
export function outcomeHtml(outcome: Outcome): string {
  if (outcome.target === null) return '';
  const key = outcome.critical
    ? outcome.success
      ? 'Mothership.Chat.CriticalSuccess'
      : 'Mothership.Chat.CriticalFailure'
    : outcome.success
      ? 'Mothership.Chat.Success'
      : 'Mothership.Chat.Failure';

  const state = outcome.success ? 'card-verdict-success' : 'card-verdict-failure';
  return `<div class="card-verdict ${state}"><strong>${localize(key)}</strong></div>`;
}

/** A d100 and a d5 are both rolled as a d10 in Foundry's dice art. */
function dieClass(faces: number): string {
  return `d${faces === 100 || faces === 5 ? 10 : faces}`;
}

export interface RollHtmlOptions {
  readonly spec: RollSpec;
  /** Null for a roll that is not judged — a damage roll, a Stress loss. */
  readonly comparison: Comparison | null;
}

/** One tooltip section: the expression that was rolled, what it came to, and the dice it rolled. */
interface RollPart {
  readonly formula: string;
  readonly total: number;
  readonly dice: readonly DieOutcome[];
  readonly dropped: boolean;
}

function dieHtml(die: DieOutcome, dropped: boolean): string {
  const highlight = die.critical ? (die.success ? ' max' : ' min') : '';
  return `<li class="roll die ${dieClass(die.faces)}${highlight}${dropped ? ' discarded' : ''}">${die.result}</li>`;
}

function partHtml(part: RollPart): string {
  return (
    `<section class="tooltip-part${part.dropped ? ' discarded' : ''}"><div class="dice">` +
    `<header class="part-header flexrow">` +
    `<span class="part-formula">${part.formula}</span>` +
    `<span class="part-total">${part.total}</span>` +
    `</header>` +
    `<ol class="dice-rolls">${part.dice.map((die) => dieHtml(die, part.dropped)).join('')}</ol>` +
    `</div></section>`
  );
}

/**
 * A section per die, which is the whole story while the expression is bare dice.
 *
 * A pool keeps one die and the total is that die's, so the others have to read as dropped — else
 * the tooltip shows two numbers and a total that sums to neither.
 */
function dieParts(outcome: Outcome, spec: RollSpec): RollPart[] {
  const keeping = keepOf(spec) !== null && outcome.dice.length > 1;
  return outcome.dice.map((die, index) => ({
    formula: `1d${die.faces}`,
    total: die.result,
    dice: [die],
    dropped: keeping && index !== outcome.keptIndex,
  }));
}

/**
 * A section per branch of the expression, for damage that carries more than dice. `1d10+1` rolling
 * an 8 is a 9, and a tooltip that says 8 under a total of 9 reads as arithmetic gone wrong. The
 * modifier is what the branch total holds and the die does not: Foundry's own total for the whole
 * formula, less the branch it kept, is what every branch adds on top of its dice.
 */
function branchParts(outcome: Outcome, spec: RollSpec): RollPart[] | null {
  const keep = keepOf(spec);
  const branches = keep === null ? 1 : 2;
  const per = outcome.dice.length / branches;
  if (!Number.isInteger(per) || per === 0) return null;

  const groups = Array.from({ length: branches }, (_, index) =>
    outcome.dice.slice(index * per, (index + 1) * per),
  );
  const sums = groups.map((dice) => dice.reduce((total, die) => total + die.result, 0));

  // Which branch Foundry kept, which is the one its total is for. Both branches are the same
  // expression, so they carry the same modifier and comparing their dice compares their totals.
  const foundry = sums.reduce(
    (best, sum, index) =>
      keep === 'kl' ? (sum < sums[best] ? index : best) : sum > sums[best] ? index : best,
    0,
  );
  const modifier = outcome.rollTotal - sums[foundry];
  const kept = Math.floor(outcome.keptIndex / per);

  return groups.map((dice, index) => ({
    formula: spec.dice,
    total: sums[index] + modifier,
    dice,
    dropped: keep !== null && index !== kept,
  }));
}

/** Foundry's own dice-tooltip markup, built from the outcome rather than the `Roll` object. */
export function rollHtml(outcome: Outcome, options: RollHtmlOptions): string {
  const formula =
    outcome.target === null || options.comparison === null
      ? toRollString(options.spec)
      : `${toRollString(options.spec)} <i class="fas ${COMPARE_ICONS[options.comparison]}"></i> ${outcome.target}`;

  // Bare dice are their own breakdown; anything else has a modifier to account for.
  const parts = (options.spec.count === null ? branchParts(outcome, options.spec) : null) ??
    dieParts(outcome, options.spec);

  return (
    `<div class="dice-roll card-dice" data-action="expandRoll"><div class="dice-result">` +
    `<div class="dice-formula">${formula}</div>` +
    `<div class="dice-tooltip" hidden><div class="wrapper">${parts.map(partHtml).join('')}</div></div>` +
    `<h4 class="dice-total">${outcome.total}</h4>` +
    `</div></div>`
  );
}

function rolled(outcome: Outcome, options: RollHtmlOptions): object {
  return {
    total: outcome.total,
    success: outcome.success,
    critical: outcome.critical,
    autoFailed: outcome.autoFailed,
    outcomeHtml: outcomeHtml(outcome),
    rollHtml: rollHtml(outcome, options),
  };
}

/** What a card remembers about who was aimed at: enough to draw the row and find the actor again. */
export interface CardTarget {
  readonly uuid: string;
  readonly name: string;
  readonly img: string;
}

/** A target row as the template draws it — the damage already taken, or the buttons to take it. */
export interface CardTargetRow extends CardTarget {
  /** Its own flag, because damage an armoured target absorbed entirely is `0` — taken, not pending. */
  readonly taken: boolean;
  readonly applied: number;
  /** `@Harm[…]` actions the enricher turns into buttons, blank once the damage is taken. */
  readonly actions: string;
}

function harmActions(total: number): string {
  const full = { verb: 'harm' as const, amount: total, half: false };
  const half = { verb: 'harm' as const, amount: total, half: true };
  return `${formatAction(full)} ${formatAction(half)}`;
}

/**
 * Targets are recorded when the attack rolls, not read when a button is clicked — the card is a
 * record of who was aimed at, and it has to survive the shooter targeting somebody else next.
 */
export function targetRows(
  targets: readonly CardTarget[],
  total: number | null,
  applied: Readonly<Record<string, number>> = {},
): CardTargetRow[] {
  return targets.map((target) => {
    const taken = Object.hasOwn(applied, target.uuid);
    return {
      ...target,
      taken,
      applied: taken ? applied[target.uuid] : 0,
      actions: !taken && total !== null ? harmActions(total) : '',
    };
  });
}

export interface CardWeapon {
  readonly _id: string | null;
  readonly name: string;
  readonly img: string;
  readonly system: { readonly description: string };
}

export interface CheckCardInput {
  readonly source: CardSource;
  readonly outcome: Outcome;
  readonly spec: RollSpec;
  readonly comparison: Comparison;
  /** The card's title: the stat's roll label, the weapon's name, "Rest Save". */
  readonly header: string;
  readonly image: string;
  /** The stat this was rolled against, as the sheet labels it. */
  readonly attribute: string;
  readonly skill?: string | null;
  readonly skillBonus?: number;
  readonly flavor?: string;
  readonly weapon?: CardWeapon | null;
  /** The weapon's wound effect, already enriched by the caller. */
  readonly woundEffect?: string;
  /** A damage-only card: the check half of the template is skipped. */
  readonly damage?: boolean;
  readonly critFail?: boolean;
  /** Who was targeted when this was rolled. */
  readonly targets?: readonly CardTarget[];
  /** The damage rolled, when one was — what a target row's buttons spend. */
  readonly damageTotal?: number | null;
  /** The wound table a Wound from this hit rolls on, carried so applying the damage can roll it. */
  readonly wound?: CardWound | null;
}

/** What the card remembers of the weapon's wound effect: the table, and how this hit rolls it. */
export interface CardWound {
  readonly table: string;
  readonly advantage: string;
}

/** A title this long no longer fits the header pill at its own size. */
const LONG_HEADER = 22;

/** Built from localized fragments, not one English sentence, so a translation gets the words without the sentence structure baked in. */
function checkSentence(input: CheckCardInput): string {
  const bonus = input.skillBonus ?? 0;
  const parts = {
    verb: localize(input.outcome.success ? 'Mothership.Chat.Rolled' : 'Mothership.Chat.DidNotRoll'),
    comparison: localize(COMPARE_WORDS[input.comparison]),
    attribute: `<strong>${input.attribute}</strong>`,
    skill: `<strong>${input.skill ?? ''}</strong>`,
  };

  return bonus > 0
    ? format('Mothership.Chat.CheckSentenceSkill', parts)
    : format('Mothership.Chat.CheckSentence', parts);
}

export function checkCard(input: CheckCardInput): Card<object> {
  const weapon = input.weapon ?? null;
  const woundEffect = input.woundEffect ?? '';
  const damage = input.damage === true;
  const needsDesc = weapon !== null && (weapon.system.description !== '' || woundEffect !== '');

  return {
    kind: 'check',
    data: {
      ...origin(input.source),
      weapon,
      msgHeader: input.header,
      longHeader: input.header.length >= LONG_HEADER,
      msgImgPath: input.image,
      showCheck: !damage,
      showWeapon: needsDesc && (damage || input.outcome.success),
      parsedRollResult: rolled(input.outcome, input),
      attribute: input.attribute,
      skill: input.skill ?? '',
      skillValue: input.skillBonus ?? 0,
      checkSentence: checkSentence(input),
      flavorText: input.flavor ?? '',
      needsDesc,
      woundEffect,
      critFail: input.critFail === true,
      damageTotal: input.damageTotal ?? null,
      showTargets: input.damageTotal !== null && input.damageTotal !== undefined,
      targets: targetRows(input.targets ?? [], input.damageTotal ?? null),
      retarget: formatAction({ verb: 'retarget' }),
      wound: input.wound ?? null,
    },
  };
}

/** Which flavour entry each table has. Data, so renaming a table cannot change what it says. */
const TABLE_FLAVOR: Readonly<Record<TableKey, string>> = {
  panic: 'panic_check',
  death: 'death_save',
  bleeding: 'bleeding_wound',
  'blunt-force': 'blunt_force_wound',
  'fire-explosives': 'fire_explosives_wound',
  'gore-massive': 'gore_massive_wound',
  gunshot: 'gunshot_wound',
};

export interface TableCardInput {
  readonly source: CardSource;
  readonly draw: TableDraw;
  readonly spec: RollSpec;
  readonly comparison: Comparison;
  readonly voice: Voice;
  /** What spending the Wound this roll cost said, when the caller spent one. */
  readonly woundText?: string;
  /** A Panic Check names its own effect roll in the card. */
  readonly secondRoll?: boolean;
}

export function tableCard(input: TableCardInput): Card<object> {
  const { draw } = input;
  const entry = draw.key === null ? null : TABLE_FLAVOR[draw.key];

  return {
    kind: 'table',
    data: {
      ...origin(input.source),
      tableName: draw.name,
      tableImg: draw.img,
      parsedRollResult: rolled(draw.outcome, input),
      msgDesc: entry === null ? '' : flavor(input.voice, 'table', entry, 'roll'),
      flavorText: entry === null ? '' : flavor(input.voice, 'table', entry, 'success'),
      tableResultType: draw.rowType,
      tableResult: draw.rows,
      woundText: input.woundText ?? '',
      secondRoll: input.secondRoll === true,
      specialRoll: draw.key === 'panic' ? 'panicCheck' : '',
      critFail: draw.outcome.critical && !draw.outcome.success,
    },
  };
}

/** Image paths stay in code — the lang files carry prose only. */
const POD_IMAGES: Readonly<Record<string, string>> = {
  health: asset('images/icons/ui/attributes/health.png'),
  hits: asset('images/icons/ui/attributes/health.png'),
  netHP: asset('images/icons/ui/attributes/health.png'),
  bleeding: asset('images/icons/ui/attributes/health.png'),
  strength: asset('images/icons/ui/attributes/strength.png'),
  speed: asset('images/icons/ui/attributes/speed.png'),
  intellect: asset('images/icons/ui/attributes/intellect.png'),
  combat: asset('images/icons/ui/attributes/combat.png'),
  sanity: asset('images/icons/ui/attributes/sanity.png'),
  fear: asset('images/icons/ui/attributes/fear.png'),
  body: asset('images/icons/ui/attributes/body.png'),
  armor: asset('images/icons/ui/attributes/armor.png'),
};

const STRESS_IMAGES: Readonly<Record<'increase' | 'decrease', string>> = {
  increase: asset('images/icons/ui/macros/gain_stress.png'),
  decrease: asset('images/icons/ui/macros/relieve_stress.png'),
};

const BOUND_LABELS: Readonly<Record<string, string | null>> = {
  value: null,
  min: 'Mothership.Minimum',
  max: 'Mothership.Maximum',
};

const strong = (value: number): string => `<strong>${value}</strong>`;

export interface MutationCardInput {
  readonly source: CardSource;
  readonly result: MutationResult;
  readonly voice: Voice;
  /** The dice the change was rolled on, when it was rolled rather than named. */
  readonly spec?: RollSpec | null;
  readonly rollOutcome?: Outcome | null;
  /** `@Wound[…]` actions for a Wound this change cost, when the table is not rolling itself. */
  readonly wound?: string;
  /** The same offer as data: a click on it is answered from the card, never from the request. */
  readonly woundRoll?: CardWound | null;
  /** Whose Wound it is. The uuid the card recorded, not the actor's own — a token is who was hit. */
  readonly subject?: string | null;
}

/**
 * Uses `HealthZeroMessage2`, not `HealthZeroMessage` — the last Wound now refills the bar, so only
 * the variant that names the refilled health has anything left to say.
 *
 * Exported so a check that costs Stress can say this line inside its own card instead of posting a second one.
 */
export function mutationOutcome(input: MutationCardInput): string {
  const { result, voice } = input;
  const pod = result.field.address.pod;
  const label = result.field.label ?? pod;
  const bound = BOUND_LABELS[result.field.address.leaf];
  const moved = result.field.from !== result.field.to;

  if (result.dead) return flavor(voice, 'attribute', 'hits', 'hitCeiling');

  if (result.wounds !== null) {
    return (
      `${localize('Mothership.HealthZeroMessage2')}${strong(result.field.to)}.` +
      `<br><br>${flavor(voice, 'attribute', 'hits', 'increase')}`
    );
  }

  const changed = format('Mothership.Chat.FieldChanged', {
    field: bound === null ? label : `${localize(bound)} ${label}`,
    direction: localize(result.amount >= 0 ? 'Mothership.Chat.Increased' : 'Mothership.Chat.Decreased'),
    from: strong(result.field.from),
    to: strong(result.field.to),
  });

  // PSG 20 — Stress over its maximum is spent reducing a Stat or Save; say so whether or not the bar itself moved.
  if (pod === 'stress' && result.overflow > 0) {
    const surplus = format('Mothership.Chat.ReduceStatBySurplus', { amount: result.overflow });
    return moved ? `${changed} ${surplus}` : `${flavor(voice, 'attribute', pod, 'hitCeiling')} ${surplus}`;
  }

  if (!moved && result.overflow !== 0) {
    return flavor(voice, 'attribute', pod, result.overflow > 0 ? 'pastCeiling' : 'pastFloor');
  }

  if (result.bound !== null && moved) {
    const hit = flavor(voice, 'attribute', pod, result.bound === 'floor' ? 'hitFloor' : 'hitCeiling');
    return hit === '' ? changed : `${hit} ${changed}`;
  }

  return changed;
}

export function mutationCard(input: MutationCardInput): Card<object> {
  const { result, voice } = input;
  const pod = result.field.address.pod;
  const direction = result.amount >= 0 ? 'increase' : 'decrease';
  const bound = BOUND_LABELS[result.field.address.leaf];
  const header = flavor(voice, 'attribute', pod, `${direction}Header`);
  const spec = input.spec ?? null;
  const rollOutcome = input.rollOutcome ?? null;

  return {
    kind: 'mutation',
    data: {
      ...origin(input.source),
      msgHeader: bound === null ? header : `${localize(bound)} ${header}`,
      msgImgPath: pod === 'stress' ? STRESS_IMAGES[direction] : (POD_IMAGES[pod] ?? ''),
      msgFlavor: flavor(voice, 'attribute', pod, direction),
      msgOutcome: mutationOutcome(input),
      modRollString: spec === null ? '' : toRollString(spec),
      parsedRollResult:
        spec === null || rollOutcome === null ? null : rolled(rollOutcome, { spec, comparison: null }),
      woundActions: input.wound ?? '',
      wound: input.woundRoll ?? null,
      subject: input.subject ?? null,
    },
  };
}

export interface ItemCardInput {
  readonly source: CardSource;
  readonly header: string;
  readonly image: string;
  readonly flavor: string;
}

/** The card an item's arrival posts — one line about what the actor now carries. */
export function itemCard(input: ItemCardInput): Card<object> {
  return {
    kind: 'item',
    data: {
      ...origin(input.source),
      msgHeader: input.header,
      msgImgPath: input.image,
      flavorText: input.flavor,
    },
  };
}

interface ReloadCardData extends CardOrigin {
  readonly item: { readonly _id: string | null; readonly name: string };
  readonly msgBody: string;
}

function ammoCard(item: ItemCard, source: CardSource, message: string): Card<ReloadCardData> {
  return {
    kind: 'reload',
    data: {
      ...origin(source),
      item: { _id: item.itemId, name: item.name },
      msgBody: localize(message),
    },
  };
}

/** Reloading says so; a magazine that was already full, or a weapon that tracks none, says nothing. */
export function reloadCard(
  item: ItemCard,
  outcome: ReloadOutcome,
  source: CardSource,
): Card<ReloadCardData> | null {
  switch (outcome.status) {
    case 'reloaded':
      return ammoCard(item, source, 'Mothership.WeaponReloaded');
    case 'out-of-ammo':
      return ammoCard(item, source, 'Mothership.OutOfAmmo');
    default:
      return null;
  }
}

function number(system: unknown, key: string): number | null {
  const fields = (typeof system === 'object' && system !== null ? system : {}) as Record<string, unknown>;
  const value = Number(fields[key]);
  return Number.isFinite(value) && value !== 0 ? value : null;
}

/** The three numbers shown besides the description are presentation only — read here, not stored on the document. */
export function descriptionCard(item: ItemCard, system: unknown, source: CardSource): Card<object> {
  return {
    kind: 'description',
    data: {
      ...origin(source),
      item: {
        _id: item.itemId,
        name: item.name,
        img: item.img,
        type: item.type,
        system: {
          description: item.description,
          roll: item.roll ?? '',
          severity: number(system, 'severity'),
          armorPoints: number(system, 'armorPoints'),
          damageReduction: number(system, 'damageReduction'),
        },
      },
    },
  };
}

export interface Speaker {
  readonly actor: string | null;
  readonly token: string | null;
  readonly alias: string;
}

export interface PostableRoll {
  toMessage(data: object, options?: object): Promise<unknown>;
}

export interface PostOptions {
  readonly speaker: Speaker;
  /** The evaluated roll to post with, so the dice animate and the message keeps its numbers. */
  readonly roll?: PostableRoll | null;
  /** Every roll the card shows, when it shows more than one — an attack and the damage it earned. */
  readonly rolls?: readonly PostableRoll[] | null;
}

declare const game: { readonly user?: { readonly id: string } } | undefined;

declare const ChatMessage:
  | {
      create(data: object): Promise<unknown>;
      applyMode(data: object, mode?: string): object;
    }
  | undefined;

declare const foundry:
  | { readonly applications: { readonly handlebars: { renderTemplate(path: string, data: object): Promise<string> } } }
  | undefined;

export async function renderCard<D extends object>(card: Card<D>): Promise<string | null> {
  if (typeof foundry === 'undefined') return null;
  return await foundry.applications.handlebars.renderTemplate(templateOf(card.kind), card.data);
}

/** The message flag a check card keeps itself under, so a button inside it can rebuild it. */
export const CARD_FLAG = 'card';

/** As much of a `ChatMessage` as acting on the card inside it needs. */
export interface CardMessage {
  getFlag(scope: string, key: string): unknown;
  canUserModify(user: unknown, action: string): boolean;
  update(data: object): Promise<unknown>;
}

/**
 * The kinds that keep their own data on the message. A card is remembered when a button inside it
 * has to be answered from the card rather than from whoever clicked: the check card holds the
 * damage and who it was aimed at, the mutation card holds the Wound it cost and whose it is.
 */
const REMEMBERED: ReadonlySet<CardKind> = new Set<CardKind>(['check', 'mutation']);

/** The card behind a message, when this system put one there — the data a button needs to rebuild it. */
export function rememberedCard(message: CardMessage): Card<Record<string, unknown>> | null {
  const stored = message.getFlag(SYSTEM_ID, CARD_FLAG);
  if (typeof stored !== 'object' || stored === null) return null;
  const card = stored as { kind?: unknown; data?: unknown };
  return REMEMBERED.has(card.kind as CardKind) && typeof card.data === 'object' && card.data !== null
    ? (card as Card<Record<string, unknown>>)
    : null;
}

/** A player may act on their own card, the Warden on any — `canUserModify` already grants every GM OWNER on any message. */
export function ownsCard(message: CardMessage, user: unknown): boolean {
  return message.canUserModify(user, 'update');
}

/** Rewriting a card re-renders its template, and the rendered HTML has thrown away the data that built it. */
function remembered<D extends object>(card: Card<D>): object {
  return REMEMBERED.has(card.kind) ? { flags: { [SYSTEM_ID]: { [CARD_FLAG]: card } } } : {};
}

/**
 * A card built from one roll posts through that roll so Foundry keeps the dice; several rolls go on
 * the message together, because `toMessage` only ever carries the roll it was called on.
 */
export async function postCard<D extends object>(card: Card<D>, options: PostOptions): Promise<unknown> {
  if (typeof foundry === 'undefined' || typeof ChatMessage === 'undefined') return null;

  const content = await renderCard(card);
  const message = {
    user: typeof game === 'undefined' ? undefined : game?.user?.id,
    speaker: options.speaker,
    content,
    ...remembered(card),
  };

  const rolls = options.rolls ?? (options.roll ? [options.roll] : []);
  if (rolls.length > 1) return ChatMessage.create(ChatMessage.applyMode({ ...message, rolls }));
  return rolls.length === 1
    ? rolls[0].toMessage(message)
    : ChatMessage.create(ChatMessage.applyMode(message));
}
