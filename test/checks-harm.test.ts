import { afterEach, describe, expect, it, vi } from 'vitest';

const rolledTables = vi.hoisted(() => [] as { key: string; options: Record<string, unknown> }[]);

// The table roll itself is `checks/tables.ts`'s and needs a compendium; what this file proves is
// which roll a Wound asks for, and that it never charges the Wound the hit already spent.
vi.mock('../module/checks/tables.ts', () => ({
  runTable: async (_actor: unknown, key: string, options: Record<string, unknown>) => {
    rolledTables.push({ key, options });
    return null;
  },
}));

import { targetRows } from '../module/chat/cards.ts';
import type { CheckActor, ItemCollection } from '../module/checks/actor.ts';
import {
  damageReduction,
  harmActor,
  harmAfterArmor,
  harmFromCard,
  isHarmRequest,
  recordHarm,
  retargetCard,
} from '../module/checks/harm.ts';
import { clearFoundryStubs, installChat, installI18n, installSettings } from './foundry-stubs.ts';

afterEach(() => {
  clearFoundryStubs();
  rolledTables.length = 0;
});

interface Wearer {
  readonly health?: number;
  readonly healthMax?: number;
  readonly wounds?: number;
  readonly woundsMax?: number;
  /** Derived on a real actor, so the fixture puts it where `deriveArmor` would. */
  readonly reduction?: number;
  readonly isOwner?: boolean;
}

function actor(options: Wearer = {}): CheckActor & { updates: Record<string, number>[] } {
  const {
    health = 10,
    healthMax = 10,
    wounds = 0,
    woundsMax = 2,
    reduction = 0,
    isOwner = true,
  } = options;

  const stored = {
    health: { value: health, min: 0, max: healthMax },
    hits: { value: wounds, min: 0, max: woundsMax },
    stats: { armor: { value: 0, mod: 0, total: 0, damageReduction: reduction } },
  };
  const updates: Record<string, number>[] = [];
  const items: ItemCollection = { [Symbol.iterator]: () => [][Symbol.iterator](), get: () => undefined };

  return {
    id: 'target1',
    name: 'Wilson',
    img: 'wilson.png',
    type: 'character',
    system: stored,
    items,
    token: null,
    isOwner,
    updates,
    toObject: () => ({ system: stored }),
    update: async (data: Record<string, number>) => {
      updates.push(data);
      return data;
    },
  };
}

function message(data: Record<string, unknown>, owns = true) {
  return {
    getFlag: () => ({ kind: 'check', data }),
    canUserModify: () => owns,
    update: vi.fn(async () => undefined),
  };
}

const stubs = (settings: Record<string, unknown> = {}) => {
  installI18n({ 'Mothership.Chat.FieldChanged': '{field} {direction} from {from} to {to}.' });
  installSettings(settings);
  return installChat();
};

const GUNSHOT = { table: 'gunshot', advantage: 'none' } as const;

describe('what the armour keeps off', () => {
  it('is the derived reduction, which is where cover is folded in', () => {
    expect(damageReduction(actor({ reduction: 3 }))).toBe(3);
    expect(damageReduction(actor())).toBe(0);
  });

  it('comes off the hit, and never turns a hit into healing', () => {
    expect(harmAfterArmor(actor({ reduction: 3 }), 7)).toBe(4);
    expect(harmAfterArmor(actor({ reduction: 3 }), 3)).toBe(0);
    expect(harmAfterArmor(actor({ reduction: 5 }), 2)).toBe(0);
  });

  it('reads the derived copy, not the stored one — a bad reduction is no reduction', () => {
    const wearer = actor();
    (wearer.system as { stats: { armor: { damageReduction: unknown } } }).stats.armor.damageReduction = 'lots';
    expect(damageReduction(wearer)).toBe(0);
  });
});

describe('spending a target’s Health', () => {
  it('writes the damage that got through', async () => {
    stubs();
    const wilson = actor({ health: 10, reduction: 3 });

    const outcome = await harmActor(wilson, 7);

    expect(outcome).toMatchObject({ kind: 'applied', amount: 4 });
    expect(wilson.updates).toEqual([{ 'system.health.value': 6 }]);
  });

  // PSG 28's rollover is mutate()'s, not this module's — this only proves it is reached.
  it('spends a Wound when the bar empties, and refills it', async () => {
    stubs();
    const wilson = actor({ health: 4, healthMax: 10 });

    const outcome = await harmActor(wilson, 6 + 3);

    expect(outcome).toMatchObject({ kind: 'applied', amount: 9 });
    expect(wilson.updates).toEqual([{ 'system.health.value': 5, 'system.hits.value': 1 }]);
  });

  it('writes nothing when the armour absorbed the whole hit', async () => {
    stubs();
    const wilson = actor({ reduction: 9 });

    expect(await harmActor(wilson, 7)).toEqual({ kind: 'absorbed', amount: 0 });
    expect(wilson.updates).toEqual([]);
  });

  // Holding the card is not holding the creature it was fired at.
  it('refuses a target this client may not write to', async () => {
    stubs();
    const wilson = actor({ isOwner: false });

    expect(await harmActor(wilson, 7)).toEqual({ kind: 'forbidden' });
    expect(wilson.updates).toEqual([]);
  });
});

/**
 * PSG 29.1 — rolling on the Wound table is what taking a Wound means. The hit spends the Wound, so
 * the roll that follows must not spend a second one, and it is rolled against whoever took it.
 */
describe('the Wound a hit costs', () => {
  const wounded = () => actor({ health: 4, healthMax: 10 });

  it('rolls the weapon’s table for the wounded actor, charging no second Wound', async () => {
    stubs({ autoRollWoundsCharacters: true });
    const wilson = wounded();

    await harmActor(wilson, 9, GUNSHOT);

    expect(rolledTables).toEqual([{ key: 'gunshot', options: { advantage: 'none', costsWound: false } }]);
    expect(wilson.updates).toEqual([{ 'system.health.value': 5, 'system.hits.value': 1 }]);
  });

  it('rolls it the way the hit says — a critical keeps the worse of two rows', async () => {
    stubs({ autoRollWoundsCharacters: true });

    await harmActor(wounded(), 9, { table: 'gunshot', advantage: 'disadvantage' });

    expect(rolledTables[0].options).toMatchObject({ advantage: 'disadvantage' });
  });

  // Off for this actor's kind: the card offers the roll instead, so the table can roll it itself.
  it('offers the roll instead when the setting leaves it to the players', async () => {
    const chat = stubs({ autoRollWoundsCharacters: false });

    await harmActor(wounded(), 9, GUNSHOT);

    expect(rolledTables).toEqual([]);
    expect(chat.cards.at(-1)?.data).toMatchObject({
      woundActions: '@Wound[gunshot -]{[-]} @Wound[gunshot] @Wound[gunshot +]{[+]}',
    });
  });

  // The offer is answered from the card, on the Warden's client — so the card has to say whose
  // Wound it is, by the uuid the hit arrived at rather than the actor's own.
  it('records whose Wound the offer is, and which table it rolls', async () => {
    const chat = stubs({ autoRollWoundsCharacters: false });

    await harmActor(wounded(), 9, GUNSHOT, 'Scene.s1.Token.t1');

    expect(chat.cards.at(-1)?.data).toMatchObject({
      subject: 'Scene.s1.Token.t1',
      wound: { table: 'gunshot', advantage: 'none' },
    });
  });

  it('says nothing about wounds when the hit cost none', async () => {
    const chat = stubs({ autoRollWoundsCharacters: false });

    await harmActor(actor({ health: 10 }), 3, GUNSHOT);

    expect(rolledTables).toEqual([]);
    expect(chat.cards.at(-1)?.data).toMatchObject({ woundActions: '' });
  });

  // A fall, a Bleeding condition, a hand-typed @Harm: damage with no weapon names no table. The
  // Wound is still taken, so the card offers the roll and the button asks which table.
  it('offers the choice for a Wound with no weapon behind it, rather than rolling one', async () => {
    const chat = stubs({ autoRollWoundsCharacters: true });

    await harmActor(wounded(), 9);

    expect(rolledTables).toEqual([]);
    expect(chat.cards.at(-1)?.data).toMatchObject({ woundActions: '@Wound[]' });
  });

  // Past the last Wound there is nothing to roll on: the card is a death, not an injury.
  it('rolls nothing once the last Wound is spent', async () => {
    stubs({ autoRollWoundsCharacters: true });

    await harmActor(actor({ health: 4, healthMax: 10, wounds: 2, woundsMax: 2 }), 9, GUNSHOT);

    expect(rolledTables).toEqual([]);
  });
});

describe('the card’s record of what was taken', () => {
  const rows = (applied: Record<string, number> = {}) =>
    targetRows([{ uuid: 'Scene.s1.Token.t1', name: 'Wilson', img: 'w.png' }], 7, applied);

  it('offers a full and a half button until the damage is taken', () => {
    expect(rows()[0]).toMatchObject({ taken: false, actions: '@Harm[7] @Harm[7 half]' });
  });

  it('drops the buttons once it is, so the same damage cannot be spent twice', async () => {
    stubs();
    const card = message({ damageTotal: 7, targets: rows() });

    expect(await recordHarm(card, {}, 'Scene.s1.Token.t1', 4)).toBe('rewritten');

    const [update] = card.update.mock.lastCall as unknown as [Record<string, unknown>];
    expect(update['flags.mothershiprpg.card.data.targets']).toEqual([
      { uuid: 'Scene.s1.Token.t1', name: 'Wilson', img: 'w.png', taken: true, applied: 4, actions: '' },
    ]);
  });

  // Zero is a real answer — the armour ate it — so the row has its own flag rather than reading 0.
  it('counts damage the armour absorbed as taken', async () => {
    stubs();
    const card = message({ damageTotal: 7, targets: rows() });

    await recordHarm(card, {}, 'Scene.s1.Token.t1', 0);

    const [update] = card.update.mock.lastCall as unknown as [Record<string, unknown>];
    expect(update['flags.mothershiprpg.card.data.targets']).toMatchObject([{ taken: true, applied: 0 }]);
  });

  it('leaves a card belonging to somebody else alone', async () => {
    stubs();
    const card = message({ damageTotal: 7, targets: rows() }, false);

    expect(await recordHarm(card, {}, 'Scene.s1.Token.t1', 4)).toBe('forbidden');
    expect(card.update).not.toHaveBeenCalled();
  });
});

describe('aiming a card again', () => {
  it('replaces the rows with what is targeted now', async () => {
    stubs();
    const card = message({
      damageTotal: 7,
      targets: targetRows([{ uuid: 'Scene.s1.Token.t1', name: 'Wilson', img: 'w.png' }], 7),
    });

    await retargetCard(card, {}, [{ uuid: 'Scene.s1.Token.t2', name: 'Sarah', img: 's.png' }]);

    // The damage was already rolled: retargeting moves who it is offered to, never re-rolls it.
    const [update] = card.update.mock.lastCall as unknown as [Record<string, unknown>];
    expect(update['flags.mothershiprpg.card.data.targets']).toEqual([
      { uuid: 'Scene.s1.Token.t2', name: 'Sarah', img: 's.png', taken: false, applied: 0, actions: '@Harm[7] @Harm[7 half]' },
    ]);
  });

  it('leaves the card’s own damage, dice and all, untouched', async () => {
    const chat = stubs();
    const card = message({
      damageTotal: 7,
      flavorText: 'You inflict <strong>7</strong> points of damage.',
      targets: targetRows([{ uuid: 'Scene.s1.Token.t1', name: 'Wilson', img: 'w.png' }], 7),
    });

    await retargetCard(card, {}, [{ uuid: 'Scene.s1.Token.t2', name: 'Sarah', img: 's.png' }]);

    expect(chat.cards.at(-1)?.data).toMatchObject({
      damageTotal: 7,
      flavorText: 'You inflict <strong>7</strong> points of damage.',
    });
  });

  // Retargeting adds the row that was missed; it is not an undo for a row already paid.
  it('keeps damage a surviving row has already taken', async () => {
    stubs();
    const paid = { uuid: 'Scene.s1.Token.t1', name: 'Wilson', img: 'w.png' };
    const card = message({
      damageTotal: 7,
      targets: targetRows([paid], 7, { 'Scene.s1.Token.t1': 4 }),
    });

    await retargetCard(card, {}, [paid, { uuid: 'Scene.s1.Token.t2', name: 'Sarah', img: 's.png' }]);

    const [update] = card.update.mock.lastCall as unknown as [Record<string, unknown>];
    expect(update['flags.mothershiprpg.card.data.targets']).toMatchObject([
      { name: 'Wilson', taken: true, applied: 4 },
      { name: 'Sarah', taken: false },
    ]);
  });

  // Aiming somewhere else does not hand back the buttons the old row already paid with.
  it('keeps a row that has paid even when the crosshairs have left it', async () => {
    stubs();
    const paid = { uuid: 'Scene.s1.Token.t1', name: 'Wilson', img: 'w.png' };
    const card = message({
      damageTotal: 7,
      targets: targetRows([paid], 7, { 'Scene.s1.Token.t1': 4 }),
    });

    await retargetCard(card, {}, [{ uuid: 'Scene.s1.Token.t2', name: 'Sarah', img: 's.png' }]);

    const [update] = card.update.mock.lastCall as unknown as [Record<string, unknown>];
    expect(update['flags.mothershiprpg.card.data.targets']).toMatchObject([
      { name: 'Wilson', taken: true, applied: 4, actions: '' },
      { name: 'Sarah', taken: false, actions: '@Harm[7] @Harm[7 half]' },
    ]);
  });

  // The crosshairs are empty far more often by accident than on purpose, and an emptied card can
  // never be aimed again — its damage, and the record of what it already cost, are gone with it.
  it('leaves the card alone when nothing is targeted', async () => {
    stubs();
    const card = message({
      damageTotal: 7,
      targets: targetRows([{ uuid: 'Scene.s1.Token.t1', name: 'Wilson', img: 'w.png' }], 7),
    });

    expect(await retargetCard(card, {}, [])).toBe('unaimed');
    expect(card.update).not.toHaveBeenCalled();
  });
});

/**
 * What the Warden's client does with a player's request. The whole point is that it believes the
 * card and not the request: a client that could name its own number could empty any actor.
 */
describe('a request the Warden’s client runs for somebody else', () => {
  const TOKEN = 'Scene.s1.Token.t1';

  function card(overrides: Record<string, unknown> = {}, owns = true) {
    return message(
      {
        damageTotal: 7,
        targets: targetRows([{ uuid: TOKEN, name: 'Wilson', img: 'w.png' }], 7),
        ...overrides,
      },
      owns,
    );
  }

  // Merged onto whatever `installChat` put there — replacing it takes the renderer with it.
  function withTarget(wilson: CheckActor): void {
    const foundry = ((globalThis as Record<string, unknown>).foundry ?? {}) as Record<string, unknown>;
    foundry.utils = { fromUuid: async () => ({ actor: wilson }) };
    (globalThis as Record<string, unknown>).foundry = foundry;
  }

  it('reads the amount off the card, never off the request', async () => {
    stubs();
    const wilson = actor({ health: 20, healthMax: 20 });
    withTarget(wilson);

    const outcome = await harmFromCard({ message: card(), sender: {} }, { messageId: 'm1', uuid: TOKEN, half: false });

    expect(outcome).toMatchObject({ kind: 'applied', amount: 7 });
    expect(wilson.updates).toEqual([{ 'system.health.value': 13 }]);
  });

  it('halves the card’s own number when the request asks for half', async () => {
    stubs();
    const wilson = actor({ health: 20, healthMax: 20 });
    withTarget(wilson);

    await harmFromCard({ message: card(), sender: {} }, { messageId: 'm1', uuid: TOKEN, half: true });

    expect(wilson.updates).toEqual([{ 'system.health.value': 17 }]);
  });

  // Redirecting the damage at somebody the card never aimed at is the obvious way to abuse a relay.
  it('refuses a target the card did not record', async () => {
    stubs();
    const wilson = actor();
    withTarget(wilson);

    const outcome = await harmFromCard(
      { message: card(), sender: {} },
      { messageId: 'm1', uuid: 'Scene.s1.Token.elsewhere', half: false },
    );

    expect(outcome).toEqual({ kind: 'forbidden' });
    expect(wilson.updates).toEqual([]);
  });

  it('refuses a sender the card does not belong to', async () => {
    stubs();
    const wilson = actor();
    withTarget(wilson);

    const outcome = await harmFromCard(
      { message: card({}, false), sender: {} },
      { messageId: 'm1', uuid: TOKEN, half: false },
    );

    expect(outcome).toEqual({ kind: 'forbidden' });
    expect(wilson.updates).toEqual([]);
  });

  it('refuses a card that rolled no damage', async () => {
    stubs();
    const wilson = actor();
    withTarget(wilson);

    const outcome = await harmFromCard(
      { message: card({ damageTotal: null, targets: targetRows([{ uuid: TOKEN, name: 'W', img: '' }], null) }), sender: {} },
      { messageId: 'm1', uuid: TOKEN, half: false },
    );

    expect(outcome).toEqual({ kind: 'forbidden' });
    expect(wilson.updates).toEqual([]);
  });

  it('marks the row spent, so the relay cannot be asked twice', async () => {
    stubs();
    withTarget(actor({ health: 20, healthMax: 20 }));
    const spent = card();

    await harmFromCard({ message: spent, sender: {} }, { messageId: 'm1', uuid: TOKEN, half: false });

    const [update] = spent.update.mock.lastCall as unknown as [Record<string, unknown>];
    expect(update['flags.mothershiprpg.card.data.targets']).toMatchObject([{ taken: true, applied: 7 }]);
  });

  it('reads only a request shaped like one', () => {
    expect(isHarmRequest({ messageId: 'm1', uuid: 't1', half: false })).toBe(true);
    expect(isHarmRequest({ messageId: 'm1', uuid: 't1' })).toBe(false);
    expect(isHarmRequest({ messageId: 'm1', uuid: 't1', half: false, amount: 999 })).toBe(true);
    expect(isHarmRequest(null)).toBe(false);
    expect(isHarmRequest('harm')).toBe(false);
  });
});
