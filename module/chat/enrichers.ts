import { localize, format } from '../i18n.ts';
import { damageString } from '../rolls/parse.ts';
import { addressOf, isFieldKey, type FieldKey } from '../mutation/fields.ts';
import type { PodLeaf } from '../mutation/address.ts';
import { isTableKey, isWoundTable, type TableKey } from '../tables/tables.ts';
import type { Advantage } from '../rolls/spec.ts';

/** Must match `module/data/item-models.js`'s `ROLL_SCOPES`; `test/chat-enrichers.test.ts` pins the two lists together. */
export const CHECK_SCOPES = [
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

export type CheckScope = (typeof CHECK_SCOPES)[number];

export type ActionVerb =
  | 'check'
  | 'table'
  | 'gain'
  | 'apply'
  | 'damage'
  | 'harm'
  | 'retarget'
  | 'wound'
  | 'death';

export type GainAmount =
  | { readonly kind: 'amount'; readonly amount: number }
  | { readonly kind: 'roll'; readonly dice: string }
  | { readonly kind: 'severity'; readonly condition: string; readonly sign: 1 | -1 };

export type ChatAction =
  | { readonly verb: 'check'; readonly scope: CheckScope; readonly advantage: Advantage }
  | { readonly verb: 'table'; readonly table: TableKey; readonly advantage: Advantage }
  | {
      readonly verb: 'gain';
      readonly field: FieldKey;
      readonly leaf: PodLeaf;
      readonly amount: GainAmount;
    }
  | { readonly verb: 'apply'; readonly condition: string; readonly count: number }
  | { readonly verb: 'damage'; readonly formula: string }
  | { readonly verb: 'harm'; readonly amount: number; readonly half: boolean }
  | { readonly verb: 'retarget' }
  | { readonly verb: 'wound'; readonly table: TableKey | null; readonly advantage: Advantage }
  | { readonly verb: 'death'; readonly advantage: Advantage };

export type ActionFault = 'syntax' | 'verb' | 'argument';

export type ActionParse =
  | { readonly ok: true; readonly action: ChatAction; readonly label: string | null }
  | { readonly ok: false; readonly fault: ActionFault; readonly detail: string };

const VERBS: Readonly<Record<string, ActionVerb>> = {
  Check: 'check',
  Table: 'table',
  Gain: 'gain',
  Apply: 'apply',
  Damage: 'damage',
  Harm: 'harm',
  Retarget: 'retarget',
  Wound: 'wound',
  Death: 'death',
};

const SPELLING: Readonly<Record<ActionVerb, string>> = {
  check: 'Check',
  table: 'Table',
  gain: 'Gain',
  apply: 'Apply',
  damage: 'Damage',
  harm: 'Harm',
  retarget: 'Retarget',
  wound: 'Wound',
  death: 'Death',
};

/**
 * What content authors type by hand:
 * `@Check[fear -]` Fear Save at disadvantage · `@Table[gunshot]` roll the Gunshot Wound table ·
 * `@Gain[stress 1d5]` gain 1d5 Stress · `@Gain[health -bleeding]` take damage equal to Bleeding ·
 * `@Apply[coward]` gain the Coward condition · `@Harm[7]` spend 7 of the *target's* Health, minus
 * their Damage Reduction (`@Harm[7 half]` halves it first). A trailing `{…}` overrides the label, as
 * `@UUID[…]{…}` does. A Panic Check is judged against Stress, so it is `@Check[panicCheck]`, not a
 * `@Table`.
 */
const SYNTAX = '@(Check|Table|Gain|Apply|Damage|Harm|Retarget|Wound|Death)\\[([^\\]]*)\\](?:\\{([^}]*)\\})?';

/** `parseAction` uses its own anchored copy, so neither this nor that carries the other's `lastIndex`. */
export const ACTION_PATTERN = new RegExp(SYNTAX, 'g');

const ANCHORED = new RegExp(`^${SYNTAX}$`);

const MODIFIERS: Readonly<Record<string, Advantage>> = { '+': 'advantage', '-': 'disadvantage' };

const SIGNS: Readonly<Record<Advantage, string>> = { none: '', advantage: ' +', disadvantage: ' -' };

const NUMBER = /^[+-]?\d+$/;
const DICE = /^[+-]?\d*d\d+$/i;
const SLUG = /^[a-z][a-z0-9-]*$/;

function bad(fault: ActionFault, detail: string): ActionParse {
  return { ok: false, fault, detail };
}

function advantageOf(token: string | undefined): Advantage | null {
  if (token === undefined) return 'none';
  return MODIFIERS[token] ?? null;
}

function parseCheck(args: readonly string[]): ActionParse {
  const [scope, modifier, ...rest] = args;
  const advantage = advantageOf(modifier);
  if (rest.length > 0 || advantage === null) return bad('argument', `@Check[${args.join(' ')}]`);
  if (!(CHECK_SCOPES as readonly string[]).includes(scope)) {
    return bad('argument', `${scope} is not a roll a condition can name`);
  }
  return { ok: true, action: { verb: 'check', scope: scope as CheckScope, advantage }, label: null };
}

function parseTable(args: readonly string[]): ActionParse {
  const [key, modifier, ...rest] = args;
  const advantage = advantageOf(modifier);
  if (rest.length > 0 || advantage === null) return bad('argument', `@Table[${args.join(' ')}]`);
  // Judged against Stress, not a lookup, so a Panic Check has one spelling: @Check[panicCheck].
  if (key === 'panic') return bad('argument', 'a Panic Check is @Check[panicCheck]');
  if (!isTableKey(key)) return bad('argument', `${key} is not a table`);
  return { ok: true, action: { verb: 'table', table: key, advantage }, label: null };
}

/**
 * The Death Save the last Wound leads to (PSG 29). Like `@Wound`, it is rolled by whoever the card
 * is about rather than whoever clicks it — it takes no argument but the modifier, because there is
 * only ever the one table.
 */
function parseDeath(args: readonly string[]): ActionParse {
  const [modifier, ...rest] = args.filter((arg) => arg !== '');
  const advantage = advantageOf(modifier);
  if (rest.length > 0 || advantage === null) return bad('argument', `@Death[${args.join(' ')}]`);
  return { ok: true, action: { verb: 'death', advantage }, label: null };
}

function parseAmount(token: string): GainAmount | null {
  if (NUMBER.test(token)) return { kind: 'amount', amount: Number(token) };
  if (DICE.test(token)) return { kind: 'roll', dice: token };

  const sign = token.startsWith('-') ? -1 : 1;
  const condition = token.replace(/^[+-]/, '');
  return SLUG.test(condition) ? { kind: 'severity', condition, sign } : null;
}

function parseGain(args: readonly string[]): ActionParse {
  const [target, value, ...rest] = args;
  if (rest.length > 0 || value === undefined) return bad('argument', `@Gain[${args.join(' ')}]`);

  const [field, leaf = 'value'] = target.split('.');
  if (!isFieldKey(field)) return bad('argument', `${field} is not a field`);
  if (leaf !== 'value' && leaf !== 'min' && leaf !== 'max') {
    return bad('argument', `${leaf} is not value, min or max`);
  }

  const amount = parseAmount(value);
  if (amount === null) return bad('argument', `${value} is not an amount`);
  return { ok: true, action: { verb: 'gain', field, leaf, amount }, label: null };
}

function parseApply(args: readonly string[]): ActionParse {
  const [condition, count = '1', ...rest] = args;
  if (rest.length > 0) return bad('argument', `@Apply[${args.join(' ')}]`);
  if (!SLUG.test(condition ?? '')) return bad('argument', `${condition} is not a condition`);
  if (!NUMBER.test(count) || Number(count) === 0) return bad('argument', `${count} is not a count`);
  return { ok: true, action: { verb: 'apply', condition, count: Number(count) }, label: null };
}

/** Half is rounded down, the way every other quotient in the book is. */
export function harmAmount(action: Extract<ChatAction, { verb: 'harm' }>): number {
  return action.half ? Math.floor(action.amount / 2) : action.amount;
}

function parseHarm(args: readonly string[]): ActionParse {
  const [amount, modifier, ...rest] = args;
  if (rest.length > 0 || !NUMBER.test(amount ?? '')) return bad('argument', `@Harm[${args.join(' ')}]`);
  if (modifier !== undefined && modifier !== 'half') return bad('argument', `${modifier} is not half`);
  return { ok: true, action: { verb: 'harm', amount: Number(amount), half: modifier === 'half' }, label: null };
}

/**
 * The wound a hit led to, rolled against the actor whose card it sits in rather than whoever clicks
 * it — which is what separates it from `@Table`, the same roll asked for by the person clicking.
 */
/**
 * `@Wound[gunshot]` names the table a weapon's own wound effect calls for. `@Wound[]` names none,
 * because nothing that led here knows one — a fall, a hand-typed `@Harm`, a `@Gain[hits 1]` — so
 * the roll asks which table first. Either way it is rolled by whoever the card is about.
 */
function parseWound(args: readonly string[]): ActionParse {
  const named = args.filter((arg) => arg !== '');
  if (named.length === 0) {
    return { ok: true, action: { verb: 'wound', table: null, advantage: 'none' }, label: null };
  }

  const [key, modifier, ...rest] = named;
  const advantage = advantageOf(modifier);
  if (rest.length > 0 || advantage === null) return bad('argument', `@Wound[${args.join(' ')}]`);
  if (!isWoundTable(key)) return bad('argument', `${key} is not a wound table`);
  return { ok: true, action: { verb: 'wound', table: key, advantage }, label: null };
}

/** A damage formula like `1d10 * 2` or `{1d10,1d10}kh` keeps its spaces, so the whole bracket is one argument. */
const DAMAGE_FORMULA = /\d/;

function parseDamage(formula: string): ActionParse {
  if (!DAMAGE_FORMULA.test(formula)) return bad('argument', `${formula} is not damage`);
  return { ok: true, action: { verb: 'damage', formula }, label: null };
}

/** Reads both content text and a button's `data-mothership-action` — same parser, both directions. */
export function parseAction(text: string): ActionParse {
  const match = ANCHORED.exec(String(text ?? '').trim());
  if (match === null) return bad('syntax', String(text ?? ''));

  const verb = VERBS[match[1]];
  if (verb === undefined) return bad('verb', match[1]);

  const args = match[2].trim().split(/\s+/).filter((part) => part !== '');
  const parsed =
    verb === 'check'
      ? parseCheck(args)
      : verb === 'table'
        ? parseTable(args)
        : verb === 'gain'
          ? parseGain(args)
          : verb === 'damage'
            ? parseDamage(match[2].trim())
            : verb === 'harm'
              ? parseHarm(args)
              : verb === 'retarget'
                ? { ok: true as const, action: { verb: 'retarget' as const }, label: null }
                : verb === 'wound'
                  ? parseWound(args)
                  : verb === 'death'
                    ? parseDeath(args)
                    : parseApply(args);

  return parsed.ok && match[3] !== undefined ? { ...parsed, label: match[3] } : parsed;
}

function amountText(amount: GainAmount): string {
  switch (amount.kind) {
    case 'amount':
      return String(amount.amount);
    case 'roll':
      return amount.dice;
    case 'severity':
      return `${amount.sign === -1 ? '-' : ''}${amount.condition}`;
  }
}

export function formatAction(action: ChatAction): string {
  const args = (() => {
    switch (action.verb) {
      case 'check':
        return `${action.scope}${SIGNS[action.advantage]}`;
      case 'table':
        return `${action.table}${SIGNS[action.advantage]}`;
      case 'gain':
        return `${action.field}${action.leaf === 'value' ? '' : `.${action.leaf}`} ${amountText(action.amount)}`;
      case 'apply':
        return `${action.condition}${action.count === 1 ? '' : ` ${action.count}`}`;
      case 'damage':
        return action.formula;
      case 'harm':
        return `${action.amount}${action.half ? ' half' : ''}`;
      case 'retarget':
        return '';
      case 'wound':
        return action.table === null ? '' : `${action.table}${SIGNS[action.advantage]}`;
      case 'death':
        return SIGNS[action.advantage].trim();
    }
  })();
  return `@${SPELLING[action.verb]}[${args}]`;
}

export function gainAddress(action: Extract<ChatAction, { verb: 'gain' }>): string {
  return addressOf(action.field, action.leaf);
}

const FIELD_NOUNS: Readonly<Record<FieldKey, string>> = {
  health: 'Mothership.Health',
  wounds: 'Mothership.Wounds',
  stress: 'Mothership.Stress',
  strength: 'Mothership.Strength',
  speed: 'Mothership.Speed',
  intellect: 'Mothership.Intellect',
  combat: 'Mothership.Combat',
  sanity: 'Mothership.Sanity',
  fear: 'Mothership.Fear',
  body: 'Mothership.Body',
};

const BOUNDS: Readonly<Record<PodLeaf, string | null>> = {
  value: null,
  min: 'Mothership.Minimum',
  max: 'Mothership.Maximum',
};

const MODIFIER_LABELS: Readonly<Record<Advantage, string>> = {
  none: '',
  advantage: ' [+]',
  disadvantage: ' [-]',
};

function signed(text: string): string {
  return text.startsWith('-') ? text : `+${text}`;
}

/** Content that wants the book's own capitalization passes its own `{label}` instead. */
function conditionName(condition: string): string {
  return condition
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function fieldLabel(field: FieldKey, leaf: PodLeaf): string {
  const noun = localize(FIELD_NOUNS[field]);
  const bound = BOUNDS[leaf];
  return bound === null ? noun : format('Mothership.Chat.BoundedField', { bound: localize(bound), field: noun });
}

/** What the button says when the content does not say it itself. */
export function actionLabel(action: ChatAction): string {
  switch (action.verb) {
    case 'check':
      return `${localize(`Mothership.RollScope.${action.scope}`)}${MODIFIER_LABELS[action.advantage]}`;
    case 'table':
      return `${localize(`Mothership.Table.${action.table}`)}${MODIFIER_LABELS[action.advantage]}`;
    case 'gain':
      return action.amount.kind === 'severity'
        ? format('Mothership.Chat.SufferLabel', { condition: conditionName(action.amount.condition) })
        : format('Mothership.Chat.GainLabel', {
            amount: signed(amountText(action.amount)),
            field: fieldLabel(action.field, action.leaf),
          });
    case 'apply':
      return format('Mothership.Chat.ApplyLabel', {
        count: signed(String(action.count)),
        condition: conditionName(action.condition),
      });
    case 'damage':
      return format('Mothership.Chat.DamageLabel', { damage: damageString(action.formula) });
    case 'harm':
      return action.half
        ? format('Mothership.Chat.HarmHalfLabel', { amount: String(harmAmount(action)) })
        : format('Mothership.Chat.HarmLabel', { amount: String(action.amount) });
    case 'retarget':
      return localize('Mothership.Chat.RetargetLabel');
    case 'wound':
      return action.table === null
        ? localize('Mothership.Chat.WoundChoiceLabel')
        : format('Mothership.Chat.WoundLabel', { wound: localize(`Mothership.Table.${action.table}`) }) +
          MODIFIER_LABELS[action.advantage];
    case 'death':
      return localize('Mothership.Chat.DeathLabel') + MODIFIER_LABELS[action.advantage];
  }
}

const ICONS: Readonly<Record<ActionVerb, string>> = {
  check: 'fa-solid fa-dice-d20',
  table: 'fa-solid fa-list',
  gain: 'fa-solid fa-plus-minus',
  apply: 'fa-solid fa-notes-medical',
  damage: 'fa-solid fa-burst',
  harm: 'fa-solid fa-heart-crack',
  retarget: 'fa-solid fa-bullseye',
  wound: 'fa-solid fa-user-injured',
  death: 'fa-solid fa-skull',
};

/** The routing key the delegated listener matches, namespaced so no window claims it by accident. */
export const ACTION_ATTRIBUTE = 'mothershipChatAction';

export function actionButton(action: ChatAction, label: string | null = null): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'content-link mothership-action';
  button.dataset.action = ACTION_ATTRIBUTE;
  button.dataset.mothershipAction = formatAction(action);

  const icon = document.createElement('i');
  icon.className = ICONS[action.verb];
  button.append(icon, label ?? actionLabel(action));
  return button;
}

/** Unreadable text stays text: a typo in content is visible, never a button that does nothing. */
export function enrichAction(match: RegExpMatchArray): HTMLElement | null {
  const parsed = parseAction(match[0]);
  return parsed.ok ? actionButton(parsed.action, parsed.label) : null;
}

interface EnricherConfig {
  readonly id: string;
  readonly pattern: RegExp;
  readonly enricher: (match: RegExpMatchArray) => HTMLElement | null;
}

declare const CONFIG: { readonly TextEditor: { enrichers: EnricherConfig[] } } | undefined;

const ENRICHER_ID = 'mothership-action';

/** Registering twice would render every action twice. */
export function registerEnrichers(): void {
  if (typeof CONFIG === 'undefined') return;
  const enrichers = CONFIG?.TextEditor.enrichers;
  if (enrichers === undefined || enrichers.some((entry) => entry.id === ENRICHER_ID)) return;
  enrichers.push({ id: ENRICHER_ID, pattern: ACTION_PATTERN, enricher: enrichAction });
}
