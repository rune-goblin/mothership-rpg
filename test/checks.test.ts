import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { CheckActor, CheckItem, ItemCollection } from '../module/checks/actor.ts';
import type { FireOutcome, ReloadOutcome } from '../module/inventory/ammo.ts';
import { conditionModifier, conditionNote, conditionPreselect } from '../module/checks/conditions.ts';
import { checkOf, checkScope, promptCheck, promptSkillCheck, runCheck } from '../module/checks/checks.ts';
import { runTable } from '../module/checks/tables.ts';
import type { Check } from '../module/rolls/spec.ts';
import { TABLES } from '../module/tables/tables.ts';
import {
  clearFoundryStubs,
  installChat,
  installI18n,
  installNotifications,
  installRoll,
  installSettings,
  type ChatLog,
  type RollLog,
} from './foundry-stubs.ts';

const prompts = vi.hoisted(() => ({
  chooseAdvantage: vi.fn(),
  chooseAttribute: vi.fn(),
  chooseSkill: vi.fn(),
  chooseDamageMode: vi.fn(),
  askReload: vi.fn(),
  outOfAmmo: vi.fn(),
  chooseCover: vi.fn(),
  noCharacter: vi.fn(),
}));

// ATTRIBUTE_KEYS is data the module also exports, not a mock — beforeEach resets `prompts` only.
vi.mock('../module/dialogs/prompts.ts', () => ({
  ...prompts,
  ATTRIBUTE_KEYS: ['strength', 'speed', 'intellect', 'combat'],
}));

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const stat = (value: number, label: string, rollLabel: string, mod = 0) => ({
  value,
  mod,
  min: 0,
  max: 99,
  label,
  rollLabel,
});

function characterSystem() {
  return {
    health: { value: 10, min: 0, max: 10, label: 'Health' },
    hits: { value: 0, min: 0, max: 2, label: 'Wounds' },
    other: { stress: { value: 3, min: 2, max: 20, label: 'Stress' } },
    class: { value: '' },
    stats: {
      strength: stat(30, 'Strength', 'Strength Check'),
      speed: stat(35, 'Speed', 'Speed Check'),
      intellect: stat(40, 'Intellect', 'Intellect Check'),
      combat: stat(45, 'Combat', 'Combat Check', 5),
      sanity: stat(30, 'Sanity', 'Sanity Save'),
      fear: stat(25, 'Fear', 'Fear Save'),
      body: stat(20, 'Body', 'Body Save'),
      armor: { value: 0, mod: 2, damageReduction: 1, cover: 'none', label: 'Armor', rollLabel: 'Armor Save' },
    },
  };
}

function creatureSystem() {
  return {
    health: { value: 8, min: 0, max: 8, label: 'Health' },
    hits: { value: 0, min: 0, max: 1, label: 'Wounds' },
    other: { stress: { value: 5, min: 2, max: 20, label: 'Stress' } },
    stats: {
      combat: stat(50, 'Combat', 'Combat Check'),
      instinct: stat(40, 'Instinct', 'Instinct Check'),
    },
  };
}

interface FakeItem extends CheckItem {
  readonly fire: Mock<() => Promise<FireOutcome>>;
  readonly reload: Mock<() => Promise<ReloadOutcome>>;
}

function item(overrides: Partial<CheckItem> & { id: string; type: string }): FakeItem {
  const fire = vi.fn<() => Promise<FireOutcome>>(async () => ({ status: 'fired', spent: 1, curShots: 4 }));
  const reload = vi.fn<() => Promise<ReloadOutcome>>(async () => ({
    status: 'reloaded',
    curShots: 5,
    ammo: 5,
    loaded: 5,
  }));
  const base = {
    name: 'Thing',
    img: 'thing.png',
    system: {},
    ...overrides,
  };
  return {
    ...base,
    fire,
    reload,
    toChat: () => ({
      itemId: base.id,
      name: base.name,
      img: base.img,
      type: base.type,
      description: '',
      roll: null,
    }),
  } as FakeItem;
}

function collection(items: readonly CheckItem[]): ItemCollection {
  return {
    [Symbol.iterator]: () => items[Symbol.iterator](),
    get: (id: string) => items.find((entry) => entry.id === id),
  };
}

interface FakeActor extends CheckActor {
  readonly updates: Record<string, number>[];
}

function actorOf(type: string, system: object, items: readonly CheckItem[] = []): FakeActor {
  const updates: Record<string, number>[] = [];
  const live = clone(system) as Record<string, unknown>;

  return {
    id: 'actor1',
    name: type === 'character' ? 'Sarah' : 'Thing',
    img: `${type}.png`,
    type,
    system: live,
    items: collection(items),
    token: null,
    updates,
    toObject: () => ({ system: clone(live) }),
    update: async (data: Record<string, number>) => {
      updates.push(data);
      for (const [path, value] of Object.entries(data)) {
        const segments = path.split('.').slice(1);
        const leaf = segments.pop() as string;
        const pod = segments.reduce<Record<string, unknown>>(
          (node, key) => node[key] as Record<string, unknown>,
          live,
        );
        pod[leaf] = value;
      }
      return data;
    },
  };
}

const character = (items: readonly CheckItem[] = []) => actorOf('character', characterSystem(), items);
const creature = (items: readonly CheckItem[] = []) => actorOf('creature', creatureSystem(), items);

const skill = (id: string, name: string, rank = 'Trained', bonus = 10, description = '<p>Fixes things.</p>') =>
  item({ id, type: 'skill', name, img: `${id}.png`, system: { rank, bonus, description } });

const condition = (name: string, modifiers: { modifier: string; scope: string }[]) =>
  item({ id: `cond-${name}`, type: 'condition', name, system: { modifiers, severity: 1 } });

const weapon = (overrides: Record<string, unknown> = {}) =>
  item({
    id: 'wpn1',
    type: 'weapon',
    name: 'Revolver',
    img: 'revolver.png',
    system: {
      damage: '1d10',
      description: '<p>Six shots.</p>',
      woundEffect: 'Gunshot',
      critDmg: '10',
      useAmmo: false,
      ...overrides,
    },
  });

const globals = globalThis as unknown as Record<string, Record<string, unknown>>;

/** The world as a table roll finds it: one table, and no compendium behind it. */
function world(name: string): void {
  globals.game.tables = { get: () => table(name) };
  globals.game.packs = [];
}

const table = (name: string) => ({
  name,
  img: 'table.png',
  formula: '1d10-1',
  getResultsForRoll: (value: number) => [
    { _id: `row${value}`, type: 'text', img: 'row.png', description: `Result ${value}.`, range: [value, value] },
  ],
});

let rolls: RollLog;
let chat: ChatLog;

function stubs(dice: { faces: number; result: number }[], settings: Record<string, unknown> = {}): void {
  installI18n({
    'Mothership.RestSave': 'Rest Save',
    'Mothership.ConditionModifier': '{conditions}: this roll is at {sign}.',
    'Mothership.Chat.FieldChanged': '{field} {direction} from {from} to {to}.',
    'Mothership.Chat.Increased': 'increased',
    'Mothership.Chat.Decreased': 'decreased',
    'Mothership.Chat.DamageDealt': 'You inflict {damage} points of damage.',
    'Mothership.attribute.body.check.human': 'You keep your footing.',
  });
  installSettings({ autoStress: true, critDamage: 'advantage', damageDiceTheme: '', panicDieTheme: '', ...settings });
  rolls = installRoll(dice);
  chat = installChat();
}

beforeEach(() => {
  for (const prompt of Object.values(prompts)) prompt.mockReset();
  prompts.chooseSkill.mockResolvedValue({ skill: null, advantage: 'none' });
  prompts.chooseAdvantage.mockResolvedValue('none');
  prompts.askReload.mockResolvedValue(false);
});

afterEach(clearFoundryStubs);

const cardData = (index = 0) => chat.cards[index].data as Record<string, unknown>;
const rolled = (index = 0) => cardData(index).parsedRollResult as Record<string, unknown>;

describe('a stat check', () => {
  it('offers the character a skill, then rolls what the dialog answered', async () => {
    stubs([{ faces: 100, result: 12 }]);
    const actor = character([skill('sk1', 'Mechanical Repair')]);
    prompts.chooseSkill.mockResolvedValue({
      skill: { id: 'sk1', name: 'Mechanical Repair', img: 'sk1.png', bonus: 10, description: '' },
      advantage: 'advantage',
    });

    const result = await runCheck(actor, { kind: 'stat', stat: 'body' });

    expect(prompts.chooseSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Body Save',
        advantage: true,
        skills: [
          {
            id: 'sk1',
            name: 'Mechanical Repair',
            img: 'sk1.png',
            bonus: 10,
            description: '<p>Fixes things.</p>',
            rank: 'Trained',
          },
        ],
      }),
    );
    expect(rolls.formulas).toEqual(['{1d100,1d100}kl']);
    expect(result).toMatchObject({ kind: 'check', target: 30, outcome: { total: 12, success: true } });
    expect(cardData()).toMatchObject({
      msgHeader: 'Body Save',
      attribute: 'Body',
      skill: 'Mechanical Repair',
      skillValue: 10,
      critFail: false,
    });
    expect(chat.cards[0].template).toBe('systems/mothershiprpg/templates/chat/rollCheck.html');
    // Posted through the roll, which is what keeps the dice with the message.
    expect(rolls.messages).toHaveLength(1);
  });

  it('adds the stat’s own modifier to what must be beaten', async () => {
    stubs([{ faces: 100, result: 49 }]);
    const result = await runCheck(character(), { kind: 'stat', stat: 'combat' }, { advantage: 'none' });

    expect(result).toMatchObject({ target: 50, stat: { value: 45, mod: 5 }, outcome: { success: true } });
  });

  it('asks no skill question of a check that already names its skill', async () => {
    stubs([{ faces: 100, result: 10 }]);
    const actor = character([skill('sk1', 'Zero-G')]);

    const result = await runCheck(actor, { kind: 'skill', stat: 'body', skillId: 'sk1', bonus: 10 });

    expect(prompts.chooseSkill).not.toHaveBeenCalled();
    expect(prompts.chooseAdvantage).toHaveBeenCalledWith(expect.objectContaining({ title: 'Body Save' }));
    expect(result).toMatchObject({ target: 30, skill: { id: 'sk1', bonus: 10 } });
  });

  it('asks a creature only how to roll, naming the stat', async () => {
    stubs([{ faces: 100, result: 60 }]);
    await runCheck(creature(), { kind: 'stat', stat: 'instinct' });

    expect(prompts.chooseSkill).not.toHaveBeenCalled();
    expect(prompts.chooseAdvantage).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Instinct Check', preselect: null }),
    );
  });

  it('asks nothing at all when the caller states the modifier and the actor holds no skills', async () => {
    stubs([{ faces: 100, result: 10 }]);
    await runCheck(creature(), { kind: 'stat', stat: 'combat' }, { advantage: 'disadvantage' });

    expect(prompts.chooseAdvantage).not.toHaveBeenCalled();
    expect(rolls.formulas).toEqual(['{1d100,1d100}kh']);
  });

  it('still offers the skill when the modifier is given, without asking for it again', async () => {
    stubs([{ faces: 100, result: 10 }]);
    await runCheck(character([skill('sk1', 'Zero-G')]), { kind: 'stat', stat: 'body' }, { advantage: 'none' });

    expect(prompts.chooseSkill).toHaveBeenCalledWith(expect.objectContaining({ advantage: false }));
    expect(rolls.formulas).toEqual(['1d100']);
  });

  it('rolls nothing when the dialog is dismissed', async () => {
    stubs([{ faces: 100, result: 10 }]);
    prompts.chooseSkill.mockResolvedValue(null);
    const actor = character([skill('sk1', 'Mechanical Repair')]);

    expect(await runCheck(actor, { kind: 'stat', stat: 'body' })).toBeNull();
    expect(rolls.formulas).toEqual([]);
    expect(chat.cards).toEqual([]);
    expect(actor.updates).toEqual([]);
  });

  it('says so rather than crashing when the actor has no such stat', async () => {
    stubs([{ faces: 100, result: 10 }]);
    installI18n({ 'Mothership.Errors.CheckUnavailable': '{actor} has no {check} to roll.' });
    const notices = installNotifications();

    expect(await runCheck(creature(), { kind: 'stat', stat: 'fear' })).toBeNull();
    expect(notices.errors).toEqual(['Thing has no Mothership.RollScope.fear to roll.']);
    expect(chat.cards).toEqual([]);
  });
});

describe('a check that fails', () => {
  it('costs a character one Stress, and the card says what that did', async () => {
    stubs([{ faces: 100, result: 70 }]);
    const actor = character();

    const result = await runCheck(actor, { kind: 'stat', stat: 'body' });

    expect(actor.updates).toEqual([{ 'system.other.stress.value': 4 }]);
    expect(result).toMatchObject({ stress: { amount: 1 } });
    expect(cardData().flavorText).toBe('Stress increased from <strong>3</strong> to <strong>4</strong>.');
  });

  it('leaves the Stress alone when the GM turned that off', async () => {
    stubs([{ faces: 100, result: 70 }], { autoStress: false });
    const actor = character();

    await runCheck(actor, { kind: 'stat', stat: 'body' });

    expect(actor.updates).toEqual([]);
    expect(cardData().flavorText).toBe('');
  });

  it('offers the Panic Check on a critical failure, and only to a character', async () => {
    stubs([{ faces: 100, result: 77 }]);
    await runCheck(character(), { kind: 'stat', stat: 'body' });
    await runCheck(creature(), { kind: 'stat', stat: 'combat' });

    expect(cardData(0)).toMatchObject({ critFail: true });
    expect(rolled(0)).toMatchObject({ critical: true, success: false });
    expect(cardData(1)).toMatchObject({ critFail: false });
  });

  it('offers nothing of the kind on a critical success', async () => {
    stubs([{ faces: 100, result: 11 }]);
    await runCheck(character(), { kind: 'stat', stat: 'body' });

    expect(rolled()).toMatchObject({ critical: true, success: true });
    expect(cardData()).toMatchObject({ critFail: false });
  });

  // PSG 24 — the d100 rule, and the one place it applies.
  it('fails at 90 or more however high the stat', async () => {
    stubs([{ faces: 100, result: 95 }]);
    const actor = character();
    (actor.system as { stats: { body: { value: number } } }).stats.body.value = 99;

    const result = await runCheck(actor, { kind: 'stat', stat: 'body' });

    expect(result).toMatchObject({ outcome: { autoFailed: true, success: false } });
  });
});

describe('a Rest Save', () => {
  it('is rolled against the worst save the character holds', async () => {
    stubs([{ faces: 100, result: 15 }]);
    const result = await runCheck(character(), { kind: 'rest-save' });

    expect(result).toMatchObject({ target: 20, stat: { key: 'body' } });
    expect(cardData().msgHeader).toBe('Rest Save');
  });

  it('relieves Stress by the ones digit of a successful roll', async () => {
    stubs([{ faces: 100, result: 13 }]);
    const actor = character();

    await runCheck(actor, { kind: 'rest-save' });

    expect(actor.updates).toEqual([{ 'system.other.stress.value': 2 }]);
  });

  it('costs Stress when it fails, like any other check', async () => {
    stubs([{ faces: 100, result: 80 }]);
    const actor = character();

    await runCheck(actor, { kind: 'rest-save' });

    expect(actor.updates).toEqual([{ 'system.other.stress.value': 4 }]);
  });

  // Rest Save is its own condition scope, distinct from the stat it resolves to (§34).
  it('asks the conditions about the Rest Save, not about Body', async () => {
    stubs([{ faces: 100, result: 15 }]);
    const nightmares = condition('Nightmares', [{ modifier: 'disadvantage', scope: 'restSave' }]);
    const frightened = condition('Frightened', [{ modifier: 'disadvantage', scope: 'body' }]);

    await runCheck(character([nightmares, frightened, skill('sk1', 'Mechanical Repair')]), {
      kind: 'rest-save',
    });

    expect(prompts.chooseSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        preselect: 'disadvantage',
        note: 'Nightmares: this roll is at [-].',
      }),
    );
  });
});

describe('an attack', () => {
  it('spends the shot once, and only when it is an attack', async () => {
    stubs([{ faces: 100, result: 20 }]);
    const gun = weapon({ useAmmo: true });
    const actor = character([gun]);

    await runCheck(actor, { kind: 'weapon-attack', itemId: 'wpn1' });
    expect(gun.fire).toHaveBeenCalledTimes(1);

    await runCheck(actor, { kind: 'weapon-damage', itemId: 'wpn1', damage: null });
    expect(gun.fire).toHaveBeenCalledTimes(1);
  });

  it('names the damage and the wound its weapon deals', async () => {
    stubs([{ faces: 100, result: 20 }]);
    await runCheck(character([weapon()]), { kind: 'weapon-attack', itemId: 'wpn1' });

    expect(cardData()).toMatchObject({
      msgHeader: 'Revolver',
      woundEffect: '@Wound[gunshot]',
      needsDesc: true,
    });
    expect(cardData().flavorText).toContain('You inflict <strong>20</strong> points of damage.');
    expect(rolls.formulas).toEqual(['1d100', '1d10']);
  });

  it('does not roll when the magazine is empty, and reloads if asked to', async () => {
    stubs([{ faces: 100, result: 20 }]);
    const gun = weapon({ useAmmo: true });
    gun.fire.mockResolvedValue({ status: 'needs-reload', spent: 0, curShots: 0 });
    prompts.askReload.mockResolvedValue(true);

    expect(await runCheck(character([gun]), { kind: 'weapon-attack', itemId: 'wpn1' })).toBeNull();

    expect(gun.reload).toHaveBeenCalledTimes(1);
    expect(rolls.formulas).toEqual([]);
    expect(chat.cards).toHaveLength(1);
    expect(chat.cards[0].template).toBe('systems/mothershiprpg/templates/chat/reload.html');
  });

  it('says out of ammo when there is nothing left to load', async () => {
    stubs([{ faces: 100, result: 20 }]);
    const gun = weapon({ useAmmo: true });
    gun.fire.mockResolvedValue({ status: 'out-of-ammo', spent: 0, curShots: 0 });

    expect(await runCheck(character([gun]), { kind: 'weapon-attack', itemId: 'wpn1' })).toBeNull();

    expect(prompts.outOfAmmo).toHaveBeenCalledTimes(1);
    expect(gun.reload).not.toHaveBeenCalled();
    expect(rolls.formulas).toEqual([]);
  });

  it('offers the damage instead of rolling it when the GM turned auto-rolling off', async () => {
    stubs([{ faces: 100, result: 20 }], { autoRollDamagePlayers: false });
    installI18n({ 'Mothership.Chat.RollDamageOffer': 'Roll the damage you deal: {damage}' });

    await runCheck(character([weapon()]), { kind: 'weapon-attack', itemId: 'wpn1' });

    expect(cardData().flavorText).toBe('Roll the damage you deal: @Damage[1d10]');
    expect(prompts.chooseDamageMode).not.toHaveBeenCalled();
  });

  it('reads the players’ setting for a character and the creatures’ for a creature', async () => {
    stubs([{ faces: 100, result: 20 }], { autoRollDamagePlayers: false, autoRollDamageCreatures: true });
    installI18n({
      'Mothership.Chat.DamageDealt': 'You inflict {damage} points of damage.',
      'Mothership.Chat.RollDamageOffer': 'Roll the damage you deal: {damage}',
    });

    await runCheck(character([weapon()]), { kind: 'weapon-attack', itemId: 'wpn1' });
    await runCheck(creature([weapon()]), { kind: 'weapon-attack', itemId: 'wpn1' });

    expect(cardData(0).flavorText).toBe('Roll the damage you deal: @Damage[1d10]');
    expect(cardData(1).flavorText).toContain('You inflict <strong>20</strong> points of damage.');
  });

  // No field records the range a shot was taken at, so auto-rolling one of two has to ask which.
  const shotgun = () =>
    weapon({
      damage: '4d10',
      range: 'close',
      damageModes: [{ label: 'Long Range', formula: '1d10' }],
    });

  it('asks which damage applies before rolling one of several', async () => {
    stubs([{ faces: 100, result: 20 }]);
    installI18n({
      'Mothership.RangeBand.close': 'Close',
      'Mothership.Chat.DamageDealt': 'You inflict {damage} points of damage.',
    });
    prompts.chooseDamageMode.mockResolvedValue('1d10');

    await runCheck(character([shotgun()]), { kind: 'weapon-attack', itemId: 'wpn1' });

    expect(prompts.chooseDamageMode).toHaveBeenCalledWith('Revolver', [
      { label: 'Close', formula: '4d10' },
      { label: 'Long Range', formula: '1d10' },
    ]);
    expect(rolls.formulas).toContain('1d10');
  });

  it('offers every damage rather than losing one when that question is dismissed', async () => {
    stubs([{ faces: 100, result: 20 }]);
    installI18n({
      'Mothership.RangeBand.close': 'Close',
      'Mothership.Chat.RollDamageOffer': 'Roll the damage you deal: {damage}',
      'Mothership.Chat.DamageModeLabel': 'Roll {damage} · {mode}',
    });
    prompts.chooseDamageMode.mockResolvedValue(null);

    await runCheck(character([shotgun()]), { kind: 'weapon-attack', itemId: 'wpn1' });

    expect(cardData().flavorText).toBe(
      'Roll the damage you deal: @Damage[4d10]{Roll 4d10 · Close} @Damage[1d10]{Roll 1d10 · Long Range}',
    );
  });

  it('never asks for a damage the caller already named — a swarm’s scaled dice', async () => {
    stubs([{ faces: 100, result: 20 }]);
    await runCheck(character([shotgun()]), { kind: 'weapon-attack', itemId: 'wpn1' }, { damage: '8d10' });

    expect(prompts.chooseDamageMode).not.toHaveBeenCalled();
    expect(rolls.formulas).toContain('8d10');
  });

  it('asks on a damage roll too, and posts nothing when the question is dismissed', async () => {
    stubs([{ faces: 100, result: 20 }]);
    installI18n({ 'Mothership.RangeBand.close': 'Close' });
    prompts.chooseDamageMode.mockResolvedValue(null);

    expect(
      await runCheck(character([shotgun()]), { kind: 'weapon-damage', itemId: 'wpn1', damage: null }),
    ).toBeNull();
    expect(chat.cards).toHaveLength(0);
  });

  it('reports a weapon that is not there instead of dereferencing it', async () => {
    stubs([{ faces: 100, result: 20 }]);
    installI18n({ 'Mothership.Errors.DocumentNotFound': 'No {type} with id {id}.' });
    const notices = installNotifications();

    expect(await runCheck(character(), { kind: 'weapon-attack', itemId: 'gone' })).toBeNull();
    expect(notices.errors).toEqual(['No Item with id gone.']);
  });

  // PSG 2's weapon table — Adjacent is the melee band, everything past it is fired.
  it('opens the skill dialog on Hand-to-Hand Combat for an Adjacent-range weapon', async () => {
    stubs([{ faces: 100, result: 20 }]);
    const handToHand = skill('sk1', 'Hand-to-Hand Combat');
    const actor = character([weapon({ range: 'adjacent' }), handToHand]);

    await runCheck(actor, { kind: 'weapon-attack', itemId: 'wpn1' });

    expect(prompts.chooseSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultSkill: {
          id: 'sk1',
          name: 'Hand-to-Hand Combat',
          img: 'sk1.png',
          bonus: 10,
          description: '<p>Fixes things.</p>',
          rank: 'Trained',
        },
      }),
    );
  });

  it('opens the skill dialog on Firearms for anything with a range', async () => {
    stubs([{ faces: 100, result: 20 }]);
    const firearms = skill('sk1', 'Firearms');
    const actor = character([weapon({ range: 'close' }), firearms]);

    await runCheck(actor, { kind: 'weapon-attack', itemId: 'wpn1' });

    expect(prompts.chooseSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultSkill: {
          id: 'sk1',
          name: 'Firearms',
          img: 'sk1.png',
          bonus: 10,
          description: '<p>Fixes things.</p>',
          rank: 'Trained',
        },
      }),
    );
  });

  it('opens on no skill when the actor holds nothing matching the default', async () => {
    stubs([{ faces: 100, result: 20 }]);
    const actor = character([weapon({ range: 'close' }), skill('sk1', 'Zero-G')]);

    await runCheck(actor, { kind: 'weapon-attack', itemId: 'wpn1' });

    expect(prompts.chooseSkill).toHaveBeenCalledWith(expect.objectContaining({ defaultSkill: null }));
  });
});

describe('a Panic Check', () => {
  it('is judged against Stress and rolled on the panic table’s own die', async () => {
    stubs([{ faces: 20, result: 11 }]);
    const actor = character();
    globals.game.tables = { get: (id: string) => (id === TABLES.panic.id ? table('Panic Check') : undefined) };
    globals.game.packs = [];

    const result = await runCheck(actor, { kind: 'panic' }, { advantage: 'none' });

    expect(rolls.formulas).toEqual(['1d20']);
    expect(result).toMatchObject({ kind: 'table', key: 'panic', wound: null });
    expect(rolled()).toMatchObject({ total: 11, success: true });
    expect(chat.cards[0].template).toBe('systems/mothershiprpg/templates/chat/rollTable.html');
  });

  it('opens on the button a condition arguing about panic preselects', async () => {
    stubs([{ faces: 20, result: 11 }]);
    world('Panic Check');
    const spiraling = condition('Spiraling', [{ modifier: 'disadvantage', scope: 'panicCheck' }]);

    await runCheck(character([spiraling]), { kind: 'panic' });

    expect(prompts.chooseAdvantage).toHaveBeenCalledWith({
      title: 'Panic Check',
      die: '1d20',
      note: 'Spiraling: this roll is at [-].',
      preselect: 'disadvantage',
    });
  });

  // A creature has no `system.class.value`, so the android-panic substitution must not assume it.
  it('lets a creature through', async () => {
    stubs([{ faces: 20, result: 19 }]);
    installI18n({ 'Mothership.HEARTATTACKSHORTCIRCUITANDROIDS': 'HEART ATTACK / SHORT CIRCUIT (ANDROIDS)' });
    world('Panic Check');

    const result = await runCheck(creature(), { kind: 'panic' }, { advantage: 'none' });

    expect(result).toMatchObject({ kind: 'table' });
    expect(chat.cards).toHaveLength(1);
  });
});

describe('a table roll', () => {
  it('asks about the table it is about to roll, with that table’s die', async () => {
    stubs([{ faces: 10, result: 4 }]);
    world('Gunshot Wound');

    await runTable(character(), 'gunshot');

    expect(prompts.chooseAdvantage).toHaveBeenCalledWith({
      title: 'Gunshot Wound',
      die: '1d10',
      note: '',
      preselect: null,
    });
    expect(rolls.formulas).toEqual(['1d10']);
  });

  it('never shows the panic prompt to a table that is not the Panic Check', async () => {
    stubs([{ faces: 10, result: 4 }]);
    world('Bleeding Wound');

    await runTable(character(), 'bleeding');

    const asked = prompts.chooseAdvantage.mock.calls[0][0] as { title: string; die: string };
    expect(asked.title).not.toBe('Panic Check');
    expect(asked.die).not.toBe('1d20');
  });

  it('spends the Wound the table charges for, and says so on the card', async () => {
    stubs([{ faces: 10, result: 4 }]);
    world('Gunshot Wound');
    const actor = character();

    const result = await runTable(actor, 'gunshot', { advantage: 'none' });

    expect(actor.updates).toEqual([{ 'system.hits.value': 1 }]);
    expect(result?.wound).toMatchObject({ amount: 1 });
    expect(cardData().woundText).toContain('Wounds increased');
  });

  // The hit that emptied the bar already spent the Wound; charging again would cost two per hit.
  it('charges nothing when the damage that led here already spent the Wound', async () => {
    stubs([{ faces: 10, result: 4 }]);
    world('Gunshot Wound');
    const actor = character();

    const result = await runTable(actor, 'gunshot', { advantage: 'none', costsWound: false });

    expect(actor.updates).toEqual([]);
    expect(result?.wound).toBeNull();
    expect(cardData().woundText).toBe('');
  });

  it('charges nothing for a table that is not a Wound', async () => {
    stubs([{ faces: 10, result: 4 }]);
    world('Death Save');
    const actor = character();

    await runTable(actor, 'death', { advantage: 'none' });

    expect(actor.updates).toEqual([]);
    expect(cardData().woundText).toBe('');
  });

  it('reports a table the world no longer holds', async () => {
    stubs([{ faces: 10, result: 4 }]);
    installI18n({ 'Mothership.Errors.DocumentNotFound': 'No {type} with id {id}.' });
    const notices = installNotifications();
    globals.game.tables = { get: () => undefined };
    globals.game.packs = [];

    expect(await runTable(character(), 'gunshot', { advantage: 'none' })).toBeNull();
    expect(notices.errors).toHaveLength(1);
  });

  it('rolls nothing when the prompt is dismissed', async () => {
    stubs([{ faces: 10, result: 4 }]);
    world('Gunshot Wound');
    prompts.chooseAdvantage.mockResolvedValue(null);
    const actor = character();

    expect(await runTable(actor, 'gunshot')).toBeNull();
    expect(actor.updates).toEqual([]);
    expect(rolls.formulas).toEqual([]);
  });
});

describe('the check a piece of content names', () => {
  it('maps every scope onto a check, and every check back to its scope', () => {
    expect(checkOf('fear')).toEqual({ kind: 'stat', stat: 'fear' });
    expect(checkOf('restSave')).toEqual({ kind: 'rest-save' });
    expect(checkOf('panicCheck')).toEqual({ kind: 'panic' });

    expect(checkScope({ kind: 'stat', stat: 'fear' })).toBe('fear');
    expect(checkScope({ kind: 'weapon-attack', itemId: 'x' })).toBe('combat');
    expect(checkScope({ kind: 'rest-save' })).toBe('restSave');
    expect(checkScope({ kind: 'panic' })).toBe('panicCheck');
  });

  // A creature's stats are outside the scope space no condition can name.
  it('has no scope for a creature-only stat, or for damage', () => {
    expect(checkScope({ kind: 'stat', stat: 'instinct' })).toBeNull();
    expect(checkScope({ kind: 'weapon-damage', itemId: 'x', damage: null } as Check)).toBeNull();
  });
});

describe('promptCheck — the check nobody has named yet', () => {
  // Roll type is asked on the last window before the dice — the Skill window here, not this one.
  it('asks for the stat without asking the roll type, then rolls it', async () => {
    stubs([{ faces: 100, result: 10 }]);
    prompts.chooseAttribute.mockResolvedValue({ stat: 'combat', advantage: 'none' });
    prompts.chooseAdvantage.mockResolvedValue('disadvantage');

    const result = await promptCheck(creature());

    // A creature holds only the stats it has, so the window prices only those.
    expect(prompts.chooseAttribute).toHaveBeenCalledWith({ advantage: false, values: { combat: 50 } });
    expect(rolls.formulas).toEqual(['{1d100,1d100}kh']);
    expect(result).toMatchObject({ stat: { key: 'combat' } });
  });

  it('rolls nothing when that dialog is dismissed', async () => {
    stubs([{ faces: 100, result: 10 }]);
    prompts.chooseAttribute.mockResolvedValue(null);

    expect(await promptCheck(character())).toBeNull();
    expect(rolls.formulas).toEqual([]);
  });
});

describe('promptSkillCheck — the skill is known, the stat is not', () => {
  it('asks only for the stat, and adds the skill that was clicked', async () => {
    stubs([{ faces: 100, result: 10 }]);
    const sarah = character([skill('sk1', 'Hacking', 'Expert', 10)]);
    prompts.chooseAttribute.mockResolvedValue({ stat: 'intellect', advantage: 'none' });

    const result = await promptSkillCheck(sarah, 'sk1');

    expect(prompts.chooseAttribute).toHaveBeenCalledWith({
      advantage: true,
      values: { strength: 30, speed: 35, intellect: 40, combat: 50 },
      skill: {
        id: 'sk1',
        name: 'Hacking',
        img: 'sk1.png',
        bonus: 15,
        description: '',
        rank: 'Expert',
      },
    });
    expect(prompts.chooseSkill).not.toHaveBeenCalled();
    expect(result).toMatchObject({ target: 55, skill: { name: 'Hacking', bonus: 15 } });
  });

  it('rolls nothing when the stat dialog is dismissed', async () => {
    stubs([{ faces: 100, result: 10 }]);
    prompts.chooseAttribute.mockResolvedValue(null);

    expect(await promptSkillCheck(character([skill('sk1', 'Hacking')]), 'sk1')).toBeNull();
    expect(rolls.formulas).toEqual([]);
  });

  it('reports an id that is not a skill this actor holds', async () => {
    stubs([{ faces: 100, result: 10 }]);
    const notifications = installNotifications();

    expect(await promptSkillCheck(character([weapon()]), 'wpn1')).toBeNull();
    expect(notifications.errors).toHaveLength(1);
    expect(prompts.chooseAttribute).not.toHaveBeenCalled();
  });
});

describe('conditions reach the roll they name', () => {
  const NIGHTMARES = condition('Nightmares', [{ modifier: 'disadvantage', scope: 'restSave' }]);
  const SPIRALING = condition('Spiraling', [{ modifier: 'disadvantage', scope: 'panicCheck' }]);
  const FRIGHTENED = condition('Frightened', [{ modifier: 'disadvantage', scope: 'fear' }]);

  it('applies to the roll the condition names, and to no other', () => {
    expect(conditionModifier([NIGHTMARES], 'restSave')).toEqual({
      advantage: 'disadvantage',
      names: ['Nightmares'],
    });
    for (const scope of ['fear', 'body', 'combat', 'panicCheck'] as const) {
      expect(conditionModifier([NIGHTMARES], scope)).toBeNull();
    }
    expect(conditionModifier([FRIGHTENED], 'restSave')).toBeNull();
  });

  it('picks out the conditions in scope and names every one of them', () => {
    expect(conditionModifier([NIGHTMARES, SPIRALING, FRIGHTENED], 'panicCheck')).toEqual({
      advantage: 'disadvantage',
      names: ['Spiraling'],
    });
    const sleepless = condition('Sleepless', [{ modifier: 'disadvantage', scope: 'restSave' }]);
    expect(conditionModifier([NIGHTMARES, sleepless], 'restSave')?.names).toEqual([
      'Nightmares',
      'Sleepless',
    ]);
  });

  it('reads advantage as well, and cancels the two against each other', () => {
    const blessed = condition('Blessed', [{ modifier: 'advantage', scope: 'restSave' }]);
    expect(conditionModifier([blessed], 'restSave')).toEqual({
      advantage: 'advantage',
      names: ['Blessed'],
    });
    expect(conditionModifier([NIGHTMARES, blessed], 'restSave')).toBeNull();
  });

  it('ignores items that are not conditions, and rolls that name no scope', () => {
    const gun = weapon({ modifiers: [{ modifier: 'disadvantage', scope: 'combat' }] });
    expect(conditionModifier([gun], 'combat')).toBeNull();
    expect(conditionModifier([condition('Haunted', [])], 'fear')).toBeNull();
    expect(conditionModifier([NIGHTMARES], null)).toBeNull();
  });

  it('says which button opens, and which line the dialog shows', () => {
    installI18n({ 'Mothership.ConditionModifier': '{conditions}: this roll is at {sign}.' });
    const modifier = conditionModifier([NIGHTMARES], 'restSave');

    expect(conditionPreselect(modifier)).toBe('disadvantage');
    expect(conditionPreselect(null)).toBeNull();
    expect(conditionNote(modifier)).toBe('Nightmares: this roll is at [-].');
    expect(conditionNote(null)).toBe('');
  });
});

describe('what a skill adds', () => {
  // PSG 22 — the rank is the fact; `system.bonus` is that number denormalized at creation.
  it('is decided by the rank, not by the stored bonus', async () => {
    stubs([{ faces: 100, result: 10 }]);
    const expert = skill('sk1', 'Hacking', 'Expert', 10);
    prompts.chooseSkill.mockImplementation(async (options: { skills: { bonus: number }[] }) => ({
      skill: options.skills[0],
      advantage: 'none',
    }));

    const result = await runCheck(character([expert]), { kind: 'stat', stat: 'body' });

    expect(result).toMatchObject({ target: 35, skill: { bonus: 15 } });
  });

  it('falls back to the stored bonus for a rank the book does not name', async () => {
    stubs([{ faces: 100, result: 10 }]);
    const homebrew = skill('sk1', 'Whistling', 'Dabbler', 5);
    prompts.chooseSkill.mockImplementation(async (options: { skills: { bonus: number }[] }) => ({
      skill: options.skills[0],
      advantage: 'none',
    }));

    const result = await runCheck(character([homebrew]), { kind: 'stat', stat: 'body' });

    expect(result).toMatchObject({ target: 25 });
  });
});
