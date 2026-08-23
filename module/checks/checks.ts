import {
  asset,
  checkCard,
  flavor,
  mutationOutcome,
  postCard,
  reloadCard,
  type Card,
  type CardTarget,
} from '../chat/cards.ts';
import { CHECK_SCOPES, type CheckScope } from '../chat/enrichers.ts';
import {
  ATTRIBUTE_KEYS,
  askReload,
  chooseAdvantage,
  chooseAttribute,
  chooseDamageMode,
  chooseSkill,
  outOfAmmo,
  type SkillRow,
} from '../dialogs/prompts.ts';
import { format, localize } from '../i18n.ts';
import { notifyMiss } from '../lookup.ts';
import { mutate, type MutationResult } from '../mutation/mutate.ts';
import { parseRollSpec } from '../rolls/parse.ts';
import type { Outcome } from '../rolls/resolve.ts';
import { CHECK_SEMANTICS, type Advantage, type Check, type RollSpec, type StatKey } from '../rolls/spec.ts';
import { CHECK_DIE } from '../rules.ts';
import { isTableKey } from '../tables/tables.ts';
import {
  cardSource,
  isCharacter,
  skillBonus,
  skillRankWord,
  speakerOf,
  statOf,
  voiceOfActor,
  type CheckActor,
  type CheckItem,
  type StatValue,
} from './actor.ts';
import { conditionModifier, conditionNote, conditionPreselect } from './conditions.ts';
import {
  cardWeapon,
  damageFlavor,
  damageModes,
  damageOffer,
  rollDamage,
  rollDamageFormula,
  woundEffectOf,
  woundRollOf,
  type DamageRoll,
} from './damage.ts';
import { evaluateRoll } from './roll.ts';
import { currentTargets } from './targets.ts';
import { autoRollDamage, autoStress } from './settings.ts';
import { runTable, type TableResult } from './tables.ts';

declare const ui: { readonly notifications?: { error(message: string): unknown } } | undefined;

const STRESS = 'system.other.stress.value';

/** PSG 22 — a Rest Save is rolled against the worst of these three. */
const SAVES: readonly StatKey[] = ['sanity', 'fear', 'body'];

const SCOPES: ReadonlySet<string> = new Set(CHECK_SCOPES);

export interface CheckOptions {
  /** `null` or absent opens the prompt, where a condition can preselect the button it argues for. */
  readonly advantage?: Advantage | null;
  /** A damage expression that is not the weapon's own: a swarm's scaled dice. */
  readonly damage?: string | null;
}

export interface CheckResult {
  readonly kind: 'check';
  readonly check: Check;
  readonly spec: RollSpec;
  readonly outcome: Outcome;
  readonly stat: StatValue;
  readonly skill: SkillRow | null;
  readonly target: number;
  /** The Stress a failure cost, or a successful rest relieved. */
  readonly stress: MutationResult | null;
  readonly card: Card;
}

export interface DamageResult {
  readonly kind: 'damage';
  readonly card: Card;
}

export type CheckOutcome = CheckResult | DamageResult | TableResult;

export function checkScope(check: Check): CheckScope | null {
  switch (check.kind) {
    case 'stat':
    case 'skill':
      return SCOPES.has(check.stat) ? (check.stat as CheckScope) : null;
    case 'weapon-attack':
      return 'combat';
    case 'rest-save':
      return 'restSave';
    case 'panic':
      return 'panicCheck';
    default:
      return null;
  }
}

/** The check a piece of content names — `@Check[fear]`, `@Check[panicCheck]`. */
export function checkOf(scope: CheckScope): Check {
  if (scope === 'panicCheck') return { kind: 'panic' };
  if (scope === 'restSave') return { kind: 'rest-save' };
  return { kind: 'stat', stat: scope };
}

function describeCheck(check: Check): string {
  const scope = checkScope(check);
  return scope === null ? check.kind : localize(`Mothership.RollScope.${scope}`);
}

/** A roll this actor has no stat for is a message, not a `undefined is not an object`. */
function notifyUnavailable(actor: CheckActor, check: Check): null {
  if (typeof ui !== 'undefined') {
    ui?.notifications?.error(
      format('Mothership.Errors.CheckUnavailable', { actor: actor.name, check: describeCheck(check) }),
    );
  }
  return null;
}

/** The stat a check is rolled against; a Rest Save finds its own — the worst save held. */
function statFor(actor: CheckActor, check: Check): StatValue | null {
  switch (check.kind) {
    case 'stat':
    case 'skill':
      return statOf(actor.system, check.stat);
    case 'weapon-attack':
      return statOf(actor.system, 'combat');
    case 'rest-save': {
      const held = SAVES.map((key) => statOf(actor.system, key)).filter(
        (save): save is StatValue => save !== null,
      );
      // Strictly worse, so saves tying for the worst resolve in the book's order.
      return held.reduce<StatValue | null>(
        (worst, save) => (worst === null || save.value + save.mod < worst.value + worst.mod ? save : worst),
        null,
      );
    }
    default:
      return null;
  }
}

function skillRows(actor: CheckActor): SkillRow[] {
  const rows: SkillRow[] = [];
  for (const item of actor.items) {
    if (item.type !== 'skill' || item.id === null) continue;
    const system = (item.system ?? {}) as { description?: unknown };
    rows.push({
      id: item.id,
      name: item.name,
      img: item.img,
      bonus: skillBonus(item.system),
      description: typeof system.description === 'string' ? system.description : '',
      rank: skillRankWord(item.system),
    });
  }
  return rows;
}

/** PSG 22 — a character may add a relevant skill to any check; a creature has none to offer. */
function offersSkill(actor: CheckActor, check: Check): boolean {
  if (!isCharacter(actor)) return false;
  return check.kind === 'stat' || check.kind === 'weapon-attack' || check.kind === 'rest-save';
}

interface Chosen {
  readonly skill: SkillRow | null;
  readonly advantage: Advantage;
}

/** PSG 2 — Adjacent range is melee, everything else is fired. A default only; the player can override it. */
function defaultCombatSkill(weapon: CheckItem, rows: readonly SkillRow[]): SkillRow | null {
  const name = (weapon.system as { range?: unknown }).range === 'adjacent' ? 'Hand-to-Hand Combat' : 'Firearms';
  return rows.find((row) => row.name === name) ?? null;
}

/** Asks only for what the caller didn't already say — skill and advantage, in one dialog. */
async function ask(
  actor: CheckActor,
  check: Check,
  options: CheckOptions,
  stat: StatValue,
  weapon: CheckItem | null,
): Promise<Chosen | null> {
  const given = options.advantage ?? null;
  const rows = skillRows(actor);
  const named = check.kind === 'skill' ? (rows.find((row) => row.id === check.skillId) ?? null) : null;
  const modifier = conditionModifier(actor.items, checkScope(check));

  // A list of one row saying "No Skill" is not an offer, so an actor holding no skills is asked
  // the plainer question instead.
  if (!offersSkill(actor, check) || rows.length === 0) {
    if (given !== null) return { skill: named, advantage: given };
    const advantage = await chooseAdvantage({
      title: stat.rollLabel,
      note: conditionNote(modifier),
      preselect: conditionPreselect(modifier),
    });
    return advantage === null ? null : { skill: named, advantage };
  }

  const answer = await chooseSkill({
    title: stat.rollLabel,
    skills: rows,
    note: conditionNote(modifier),
    preselect: conditionPreselect(modifier),
    advantage: given === null,
    defaultSkill: weapon === null ? null : defaultCombatSkill(weapon, rows),
    // What the check will roll under before a skill is added — `d100Check` totals the same two.
    stat: { label: stat.label, amount: stat.value + stat.mod },
  });
  return answer === null ? null : { skill: answer.skill, advantage: given ?? answer.advantage };
}

/** The weapon a check names — and a notification rather than a crash when the id is stale. */
function weaponOf(actor: CheckActor, itemId: string): CheckItem | null {
  const item = actor.items.get(itemId);
  if (item === undefined) {
    notifyMiss({ ref: itemId, type: 'Item' });
    return null;
  }
  return item;
}

/** A weapon that cannot fire does not attack — the reload it offers replaces the shot, not precedes it. */
async function spendShot(actor: CheckActor, item: CheckItem): Promise<boolean> {
  const outcome = await item.fire();
  if (outcome.status === 'fired') return true;

  if (outcome.status === 'needs-reload' && (await askReload())) {
    const reloaded = await item.reload();
    const card = reloadCard(item.toChat(), reloaded, cardSource(actor));
    if (card !== null) await postCard(card, { speaker: speakerOf(actor) });
  } else if (outcome.status === 'out-of-ammo') {
    await outOfAmmo();
  }
  return false;
}

function headerOf(check: Check, stat: StatValue, weapon: CheckItem | null): { title: string; image: string } {
  if (weapon !== null) return { title: weapon.name, image: weapon.img };
  if (check.kind === 'rest-save') {
    return { title: localize('Mothership.RestSave'), image: asset('images/icons/ui/macros/rest_save.png') };
  }
  return { title: stat.rollLabel, image: asset(`images/icons/ui/attributes/${stat.key}.png`) };
}

/** `null` means the dialog was dismissed, not that there's no damage. */
async function settleDamage(weapon: CheckItem, override: string | null): Promise<string | null> {
  const modes = damageModes(weapon, override);
  if (modes.length <= 1) return modes[0]?.formula ?? '';
  return await chooseDamageMode(weapon.name, modes);
}

/** Rolled when the GM leaves that to the system, offered as a button per damage when they do not. */
async function damageLine(
  actor: CheckActor,
  weapon: CheckItem,
  options: { readonly override: string | null; readonly critical: boolean },
): Promise<{ readonly text: string; readonly damage: DamageRoll | null }> {
  const offered = { text: damageOffer(actor, weapon, options), damage: null };
  if (!autoRollDamage(isCharacter(actor))) return offered;

  const chosen = await settleDamage(weapon, options.override);
  if (chosen === null) return offered;

  const damage = await rollDamageFormula(actor, weapon, { ...options, override: chosen });
  return { text: damageFlavor(damage), damage };
}

/** PSG 22 — a successful Rest Save relieves Stress equal to the ones digit of the roll. */
function restRelief(total: number): number {
  return -(Math.abs(total) % 10);
}

async function d100Check(
  actor: CheckActor,
  check: Check,
  options: CheckOptions,
): Promise<CheckResult | null> {
  const stat = statFor(actor, check);
  if (stat === null) return notifyUnavailable(actor, check);

  const weapon = check.kind === 'weapon-attack' ? weaponOf(actor, check.itemId) : null;
  if (check.kind === 'weapon-attack' && weapon === null) return null;

  const chosen = await ask(actor, check, options, stat, weapon);
  if (chosen === null) return null;

  if (weapon !== null && !(await spendShot(actor, weapon))) return null;

  const semantics = CHECK_SEMANTICS[check.kind];
  const bonus = chosen.skill?.bonus ?? 0;
  const target = stat.value + stat.mod + bonus;
  const spec: RollSpec = { ...parseRollSpec(CHECK_DIE, semantics.aim), advantage: chosen.advantage };
  const { roll, outcome } = await evaluateRoll({ spec, kind: check.kind, target });

  const voice = voiceOfActor(actor);
  const source = cardSource(actor);
  const character = isCharacter(actor);

  let stress: MutationResult | null = null;
  let flavorText = '';
  let damage: DamageRoll | null = null;
  let targets: readonly CardTarget[] = [];

  if (!outcome.success) {
    // PSG 20 — a failure is a Stress, when the GM leaves that to the system.
    if (character && autoStress()) {
      stress = await mutate(actor, STRESS, { kind: 'amount', amount: 1 });
      flavorText = mutationOutcome({ source, result: stress, voice });
    }
  } else if (weapon !== null) {
    const line = await damageLine(actor, weapon, {
      override: options.damage ?? null,
      critical: outcome.critical,
    });
    flavorText = line.text;
    damage = line.damage;
    targets = currentTargets();
  } else if (character && check.kind === 'rest-save') {
    stress = await mutate(actor, STRESS, { kind: 'amount', amount: restRelief(outcome.total) });
    flavorText = mutationOutcome({ source, result: stress, voice });
  } else if (character) {
    flavorText = flavor(voice, 'attribute', stat.key, 'check');
  }

  const header = headerOf(check, stat, weapon);
  const card = checkCard({
    source,
    outcome,
    spec,
    comparison: semantics.comparison,
    header: header.title,
    image: header.image,
    attribute: stat.label,
    skill: chosen.skill?.name ?? '',
    skillBonus: bonus,
    flavor: flavorText,
    weapon: weapon === null ? null : cardWeapon(weapon),
    woundEffect: weapon === null ? '' : woundEffectOf(weapon),
    // A critical failure is where a Panic Check comes from, and the card is where it is offered.
    critFail: character && !outcome.success && outcome.critical,
    targets,
    damageTotal: damage?.total ?? null,
    // A hit that offers its damage has no total yet, and still has targets to show and to change.
    targeting: weapon !== null && outcome.success,
    // Carried on the card so applying the damage can roll it: a Wound is the target's, and by then
    // the weapon that caused it is somebody else's document.
    wound: weapon === null || damage === null ? null : woundRollOf(weapon, outcome.critical),
  });
  await postCard(card, {
    speaker: speakerOf(actor),
    rolls: damage === null ? [roll] : [roll, damage.roll],
  });

  return { kind: 'check', check, spec, outcome, stat, skill: chosen.skill, target, stress, card };
}

async function damageOnly(
  actor: CheckActor,
  check: Extract<Check, { kind: 'weapon-damage' }>,
  options: CheckOptions,
): Promise<DamageResult | null> {
  const weapon = weaponOf(actor, check.itemId);
  if (weapon === null) return null;

  // Asked for outright, so it always rolls; what it may not do is guess which damage.
  const chosen = await settleDamage(weapon, check.damage ?? options.damage ?? null);
  if (chosen === null) return null;

  const card = await rollDamage(actor, weapon, { override: chosen });
  return { kind: 'damage', card };
}

export async function runCheck(
  actor: CheckActor,
  check: Check,
  options: CheckOptions = {},
): Promise<CheckOutcome | null> {
  switch (check.kind) {
    case 'weapon-damage':
      return await damageOnly(actor, check, options);
    case 'panic':
      return await runTable(actor, 'panic', options);
    case 'table':
      if (!isTableKey(check.tableId)) {
        notifyMiss({ ref: check.tableId, type: 'RollTable' });
        return null;
      }
      return await runTable(actor, check.tableId, options);
    default:
      return await d100Check(actor, check, options);
  }
}

/** value + mod — must match what d100Check totals. */
function statValues(actor: CheckActor): Record<string, number> {
  const values: Record<string, number> = {};
  for (const key of ATTRIBUTE_KEYS) {
    const stat = statOf(actor.system, key);
    if (stat !== null) values[key] = stat.value + stat.mod;
  }
  return values;
}

/** The roll type is asked in the last window before the dice — the Skill window — not committed early. */
export async function promptCheck(
  actor: CheckActor,
  options: CheckOptions = {},
): Promise<CheckOutcome | null> {
  const chosen = await chooseAttribute({ advantage: false, values: statValues(actor) });
  if (chosen === null) return null;
  return await runCheck(actor, { kind: 'stat', stat: chosen.stat }, options);
}

/** The skill is already known (it was clicked); this asks only for the stat it applies to. */
export async function promptSkillCheck(
  actor: CheckActor,
  skillId: string,
  options: CheckOptions = {},
): Promise<CheckOutcome | null> {
  const item = actor.items.get(skillId);
  if (item === undefined || item.type !== 'skill') {
    notifyMiss({ ref: skillId, type: 'Item' });
    return null;
  }

  const bonus = skillBonus(item.system);
  const chosen = await chooseAttribute({
    advantage: (options.advantage ?? null) === null,
    values: statValues(actor),
    skill: {
      id: skillId,
      name: item.name,
      img: item.img,
      bonus,
      description: '',
      rank: skillRankWord(item.system),
    },
  });
  if (chosen === null) return null;

  return await runCheck(
    actor,
    { kind: 'skill', stat: chosen.stat, skillId, bonus },
    { ...options, advantage: options.advantage ?? chosen.advantage },
  );
}
