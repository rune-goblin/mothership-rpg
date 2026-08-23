import { asset } from '../chat/cards.ts';
import { enrich } from '../enrich.ts';
import { format, localize } from '../i18n.ts';
import type { Amount } from '../mutation/mutate.ts';
import type { Advantage, StatKey } from '../rolls/spec.ts';
import { COVER_EXAMPLES, COVER_KEYS, COVER_LABEL, type Cover } from '../rules.ts';
import { WOUND_TABLE_KEYS, type TableKey } from '../tables/tables.ts';
import CheckPrompt from './CheckPrompt.svelte';
import CoverPrompt from './Cover.svelte';
import Prompt from './Prompt.svelte';
import { svelteDialog, type DialogButton } from './svelte-dialog.ts';

const DIALOG_WIDTH = 600;

/** Wide enough for the list and the roll rail side by side. */
const RAIL_WIDTH = 660;

/** `css/mothership.css` draws the `[+]`/`[−]` marks from these classes; a plain roll gets the
 *  empty `roll-mark` class so the three labels still align in the empty column. */
const ICONS: Readonly<Record<Advantage, string>> = {
  advantage: 'roll-mark roll-mark-advantage',
  none: 'roll-mark',
  disadvantage: 'roll-mark roll-mark-disadvantage',
};

const LABELS: Readonly<Record<Advantage, string>> = {
  advantage: 'Mothership.Advantage',
  none: 'Mothership.Normal',
  disadvantage: 'Mothership.Disadvantage',
};

const ORDER: readonly Advantage[] = ['none', 'advantage', 'disadvantage'];

const PRESELECT = 'condition-preselect';

/** Normal is the default (Enter rolls it) unless a condition names this roll, in which case
 *  its own button is preselected — and DialogV2 autofocuses — instead. */
function advantageButtons<V, T>(
  preselect: Advantage | null,
  answer: (advantage: Advantage, value: V) => T,
): DialogButton<V, T>[] {
  const fallback = preselect ?? 'none';
  return ORDER.map((advantage) => ({
    action: advantage,
    label: localize(LABELS[advantage]),
    icon: ICONS[advantage],
    ...(advantage === fallback ? { default: true } : {}),
    ...(preselect === advantage ? { class: PRESELECT } : {}),
    answer: (value: V) => answer(advantage, value),
  }));
}

function nextButton<V, T>(answer: (value: V) => T): DialogButton<V, T> {
  return {
    action: 'next',
    label: localize('Mothership.Next'),
    icon: 'fas fa-chevron-circle-right',
    answer,
  };
}

interface StatRow {
  readonly key: StatKey;
  readonly label: string;
  readonly example: string;
}

const ATTRIBUTES: readonly StatRow[] = [
  { key: 'strength', label: 'Mothership.Strength', example: 'Mothership.StrengthSkillExample' },
  { key: 'speed', label: 'Mothership.Speed', example: 'Mothership.SpeedSkillExample' },
  { key: 'intellect', label: 'Mothership.Intellect', example: 'Mothership.IntellectSkillExample' },
  { key: 'combat', label: 'Mothership.Combat', example: 'Mothership.CombatSkillExample' },
];

export const ATTRIBUTE_KEYS: readonly StatKey[] = ATTRIBUTES.map((row) => row.key);

const SAVES: readonly StatRow[] = [
  { key: 'sanity', label: 'Mothership.Sanity', example: 'Mothership.SanitySaveExample' },
  { key: 'fear', label: 'Mothership.Fear', example: 'Mothership.FearSaveExample' },
  { key: 'body', label: 'Mothership.Body', example: 'Mothership.BodySaveExample' },
];

export interface ChosenAttribute {
  readonly stat: StatKey;
  readonly advantage: Advantage;
}

export interface AttributePrompt {
  /** When false, one Next button closes the window instead of the three roll-type buttons. */
  readonly advantage: boolean;
  /** Each Stat's `value + mod`, the number `d100Check` rolls under. Omitted for a Save asked
   *  before its actor is settled, so the window shows no total rather than a wrong one. */
  readonly values?: Readonly<Record<string, number>>;
  /** Set when the click that opened this window was a Skill's. */
  readonly skill?: SkillRow | null;
}

interface StatPromptText {
  readonly title: string;
  readonly heading: string;
  readonly intro: string;
}

/** The Stat and Save examples run to 125 characters, which is three lines in this window. */
const STAT_DESCRIPTION_LINES = 3;

async function pickStat(
  rows: readonly StatRow[],
  text: StatPromptText,
  prompt: AttributePrompt,
): Promise<ChosenAttribute | null> {
  const values = prompt.values ?? {};
  const skill = prompt.skill ?? null;
  const props = {
    heading: text.heading,
    intro: text.intro,
    options: rows.map((entry) => ({
      key: entry.key,
      label: localize(entry.label),
      cells: [{ text: values[entry.key] === undefined ? '' : String(values[entry.key]), boxed: true }],
      amount: values[entry.key],
      description: localize(entry.example),
    })),
    picks: 'stat',
    fixed: skill === null ? null : { label: skill.name, amount: skill.bonus },
    lines: STAT_DESCRIPTION_LINES,
  };

  return await svelteDialog<string, ChosenAttribute, typeof props>({
    component: CheckPrompt,
    props,
    title: text.title,
    initial: rows[0].key,
    width: RAIL_WIDTH,
    rail: true,
    buttons: prompt.advantage
      ? advantageButtons(null, (advantage, stat) => ({ stat: stat as StatKey, advantage }))
      : [nextButton((stat: string) => ({ stat: stat as StatKey, advantage: 'none' as Advantage }))],
  });
}

export async function chooseAttribute(options: AttributePrompt): Promise<ChosenAttribute | null> {
  const skill = options.skill ?? null;
  return await pickStat(
    ATTRIBUTES,
    {
      title: localize('Mothership.ChooseAStat'),
      heading: localize('Mothership.AgainstWhichStat'),
      intro:
        skill === null
          ? localize('Mothership.AddASkillNext')
          : format('Mothership.SkillAppliesToStat', { skill: skill.name, bonus: skill.bonus }),
    },
    options,
  );
}

export async function chooseSave(): Promise<ChosenAttribute | null> {
  return await pickStat(
    SAVES,
    {
      title: localize('Mothership.ChooseASave'),
      heading: localize('Mothership.SelectASave'),
      intro: localize('Mothership.FailedSaveCostsStress'),
    },
    { advantage: true },
  );
}

export interface SkillRow {
  readonly id: string;
  readonly name: string;
  readonly img: string;
  readonly bonus: number;
  readonly description: string;
  /** `Trained`/`Expert`/`Master`, or null for a rank the book does not name. */
  readonly rank: string | null;
}

export interface ChosenSkill {
  readonly skill: SkillRow | null;
  readonly advantage: Advantage;
}

export interface SkillPrompt {
  readonly title: string;
  readonly skills: readonly SkillRow[];
  readonly note: string;
  readonly preselect: Advantage | null;
  readonly advantage: boolean;
  /** The skill the dialog opens with checked. */
  readonly defaultSkill: SkillRow | null;
  readonly stat: { readonly label: string; readonly amount: number };
}

/** Empty, since no real skill id is the empty string. */
const NO_SKILL = '';

const SKILL_DESCRIPTION_LINES = 2;

export async function chooseSkill(options: SkillPrompt): Promise<ChosenSkill | null> {
  const skills = await Promise.all(
    options.skills.map(async (skill) => ({ ...skill, description: await enrich(skill.description) })),
  );
  const chosen = (key: string): SkillRow | null =>
    options.skills.find((skill) => skill.id === key) ?? null;

  const props = {
    heading: localize('Mothership.AddASkill'),
    intro: localize('Mothership.ARelevantSkillRaises'),
    options: [
      {
        key: NO_SKILL,
        label: localize('Mothership.NoSkill'),
        amount: 0,
        description: localize('Mothership.NoSkillExplanation'),
        muted: true,
      },
      ...skills.map((skill) => ({
        key: skill.id,
        label: skill.name,
        cells: [
          skill.rank === null ? '' : localize(`Mothership.SkillRank${skill.rank}`),
          { text: `+${skill.bonus}`, boxed: true },
        ],
        amount: skill.bonus,
        description: skill.description,
      })),
    ],
    picks: 'skill',
    fixed: options.stat,
    lines: SKILL_DESCRIPTION_LINES,
    note: options.note,
  };

  return await svelteDialog<string, ChosenSkill, typeof props>({
    component: CheckPrompt,
    props,
    title: options.title,
    initial: options.defaultSkill?.id ?? NO_SKILL,
    width: RAIL_WIDTH,
    rail: true,
    buttons: options.advantage
      ? advantageButtons(options.preselect, (advantage, key) => ({ skill: chosen(key), advantage }))
      : [nextButton((key: string) => ({ skill: chosen(key), advantage: 'none' as Advantage }))],
  });
}

export interface AdvantagePrompt {
  /** A stat's roll label, or a table's own name. */
  readonly title: string;
  readonly note: string;
  readonly preselect: Advantage | null;
  /** The dice about to be rolled, when they are worth naming: a table's own die. */
  readonly die?: string;
}

export async function chooseAdvantage(options: AdvantagePrompt): Promise<Advantage | null> {
  const die = options.die ?? '';
  const props = {
    heading: localize('Mothership.SelectYourRollType'),
    intro: localize('Mothership.WhatARollTypeBuys'),
    note: options.note,
    readout: die === '' ? null : { label: localize('Mothership.Rolling'), value: die },
  };

  return await svelteDialog<null, Advantage, typeof props>({
    component: Prompt,
    props,
    title: options.title,
    initial: null,
    width: DIALOG_WIDTH,
    rail: true,
    buttons: advantageButtons(options.preselect, (advantage) => advantage),
  });
}

export async function askReload(): Promise<boolean> {
  const answer = await svelteDialog<null, boolean, { heading: string }>({
    component: Prompt,
    props: { heading: localize('Mothership.OutOfAmmoNeedReload') },
    title: localize('Mothership.WeaponIssue'),
    initial: null,
    buttons: [
      { action: 'reload', label: localize('Mothership.Reload'), icon: 'fas fa-check', answer: () => true },
      { action: 'cancel', label: localize('Mothership.Cancel'), icon: 'fas fa-times', answer: () => false },
    ],
  });
  return answer === true;
}

/** Nothing in the system knows the range a shot was taken at, so a weapon with more than one
 *  damage formula (e.g. a Combat Shotgun's 4d10 vs. its 1d10 at Long Range) can only be told
 *  apart by asking. */
export async function chooseDamageMode(
  weapon: string,
  modes: readonly { label: string; formula: string }[],
): Promise<string | null> {
  return await svelteDialog<null, string, { heading: string }>({
    component: Prompt,
    props: { heading: format('Mothership.WhichDamageApplies', { weapon }) },
    title: localize('Mothership.Damage'),
    initial: null,
    width: DIALOG_WIDTH,
    buttons: modes.map((mode, index) => ({
      action: `damage-${index}`,
      label:
        mode.label === ''
          ? format('Mothership.Chat.DamageLabel', { damage: mode.formula })
          : format('Mothership.Chat.DamageModeLabel', { damage: mode.formula, mode: mode.label }),
      icon: 'fas fa-burst',
      ...(index === 0 ? { default: true } : {}),
      answer: () => mode.formula,
    })),
  });
}

export async function outOfAmmo(): Promise<void> {
  await svelteDialog<null, null, { heading: string }>({
    component: Prompt,
    props: { heading: localize('Mothership.OutOfAmmo') },
    title: localize('Mothership.WeaponIssue'),
    initial: null,
    buttons: [{ action: 'ok', label: localize('Mothership.OK'), icon: 'fas fa-check', answer: () => null }],
  });
}

export interface CoverPromptArmor {
  readonly armorPoints: number;
  readonly damageReduction: number;
}

export async function chooseCover(current: Cover, armor: CoverPromptArmor): Promise<Cover | null> {
  const options = COVER_KEYS.map((key) => ({
    key,
    label: localize(COVER_LABEL[key]),
    examples: localize(COVER_EXAMPLES[key]),
  }));
  const props = {
    heading: localize('Mothership.Cover'),
    intro: `${localize('Mothership.TheEnvironmentCanProvideProtectionCalled')} <strong>${localize(
      'Mothership.Cover',
    )}</strong>. ${localize('Mothership.ItCanBeDestroyedLikeArmor')} <strong>${localize(
      'Mothership.IfYouShotWhileInCover',
    )}.</strong>`,
    options,
    armorLabel: localize('Mothership.ArmorPoints'),
    reductionLabel: localize('Mothership.DMGReduction'),
    ...armor,
  };

  return await svelteDialog<Cover, Cover, typeof props>({
    component: CoverPrompt,
    props,
    title: localize('Mothership.Cover'),
    initial: current,
    width: DIALOG_WIDTH,
    buttons: [
      { action: 'ok', label: localize('Mothership.OK'), icon: 'fas fa-check', answer: (cover: Cover) => cover },
    ],
  });
}

export type StressDirection = 'gain' | 'relieve';

interface StressPromptText {
  readonly title: string;
  readonly image: string;
  readonly body: string;
  readonly label: string;
  readonly icons: readonly [one: string, two: string, dice: string];
  readonly sign: 1 | -1;
}

const STRESS_PROMPTS: Readonly<Record<StressDirection, StressPromptText>> = {
  gain: {
    title: 'Mothership.GainStress',
    image: 'images/icons/ui/macros/gain_stress.png',
    body: 'Mothership.WhatGainingStressIs',
    label: 'Mothership.GainNStress',
    icons: ['fas fa-angle-up', 'fas fa-angle-double-up', 'fas fa-arrow-circle-up'],
    sign: 1,
  },
  relieve: {
    title: 'Mothership.RelieveStress',
    image: 'images/icons/ui/macros/relieve_stress.png',
    body: 'Mothership.WhatRelievingStressIs',
    label: 'Mothership.RelieveNStress',
    icons: ['fas fa-angle-down', 'fas fa-angle-double-down', 'fas fa-arrow-circle-down'],
    sign: -1,
  },
};

const STRESS_STEPS = ['1', '2', '1d5'] as const;

/** Returns an `Amount` — what `modify` takes — rather than applying the change itself, so the
 *  mutation engine stays the one place a change is applied. */
export async function chooseStress(direction: StressDirection): Promise<Amount | null> {
  const text = STRESS_PROMPTS[direction];
  const heading = localize(text.title);
  const props = { image: asset(text.image), heading, intro: localize(text.body) };

  return await svelteDialog<null, Amount, typeof props>({
    component: Prompt,
    props,
    title: heading,
    initial: null,
    width: DIALOG_WIDTH,
    buttons: STRESS_STEPS.map((step, index) => ({
      action: step,
      label: format(text.label, { amount: step }),
      icon: text.icons[index],
      answer: (): Amount =>
        step === '1d5'
          ? { kind: 'roll', dice: text.sign < 0 ? `-${step}` : step }
          : { kind: 'amount', amount: Number(step) * text.sign },
    })),
  });
}

export interface ChosenWound {
  readonly key: TableKey;
  readonly advantage: Advantage;
}

/** The shipped icon filenames keep the `&` the table keys spell as a dash. */
const WOUND_ICONS: Readonly<Record<string, string>> = {
  bleeding: 'wounds_bleeding.png',
  'blunt-force': 'wounds_blunt_force.png',
  'fire-explosives': 'wounds_fire_&_explosives.png',
  'gore-massive': 'wounds_gore_&_massive.png',
  gunshot: 'wounds_gunshot.png',
};

const DEFAULT_WOUND: TableKey = 'blunt-force';

/** Uses the keys `tables/` resolves, so a GM's re-pointed table is honoured here too. */
export async function chooseWound(): Promise<ChosenWound | null> {
  const props = {
    image: asset('images/icons/ui/macros/wound_roll.png'),
    heading: localize('Mothership.WoundRoll'),
    intro: localize('Mothership.WhatAWoundRollIs'),
    options: WOUND_TABLE_KEYS.map((key) => ({
      key,
      label: localize(`Mothership.Table.${key}`),
      img: asset(`images/icons/ui/rolltables/${WOUND_ICONS[key]}`),
    })),
    // Five bare names, and the head already carries the art: a dropdown says it in one line.
    picker: 'select',
  };

  return await svelteDialog<TableKey, ChosenWound, typeof props>({
    component: Prompt,
    props,
    title: localize('Mothership.WoundRoll'),
    initial: DEFAULT_WOUND,
    width: RAIL_WIDTH,
    rail: true,
    buttons: advantageButtons(null, (advantage, key) => ({ key, advantage })),
  });
}

const NO_CHARACTER: Readonly<Record<string, string>> = {
  character: 'Mothership.Errors.NoCharacterSelected',
  token: 'Mothership.Errors.NoTokenSelected',
};

export async function noCharacter(target: string): Promise<void> {
  const heading = localize('Mothership.Errors.NoCharacterTitle');
  const props = {
    heading,
    intro: localize(NO_CHARACTER[target] ?? NO_CHARACTER.character),
  };

  await svelteDialog<null, null, typeof props>({
    component: Prompt,
    props,
    title: heading,
    initial: null,
    buttons: [{ action: 'ok', label: localize('Mothership.OK'), icon: 'fas fa-check', answer: () => null }],
  });
}
