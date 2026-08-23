import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CheckActor, CheckItem, ItemCollection } from '../module/checks/actor.ts';
import {
  critFormula,
  damageFlavor,
  damageFormula,
  damageModes,
  damageOffer,
  rollDamage,
  rollDamageFormula,
  rollDamageInCard,
  weaponDamage,
  woundEffectActions,
  woundOffer,
  woundRollOf,
} from '../module/checks/damage.ts';
import { CRIT_DAMAGE_CHOICES } from '../module/checks/settings.ts';
import { checkCard, targetRows } from '../module/chat/cards.ts';
import { clearFoundryStubs, installChat, installI18n, installRoll, installSettings } from './foundry-stubs.ts';

afterEach(clearFoundryStubs);

const fire = vi.fn(async () => ({ status: 'fired' as const, spent: 1, curShots: 4 }));
const reload = vi.fn(async () => ({ status: 'reloaded' as const, curShots: 5, ammo: 0, loaded: 5 }));

function weapon(system: Record<string, unknown> = {}): CheckItem {
  return {
    id: 'wpn1',
    name: 'Revolver',
    img: 'revolver.png',
    type: 'weapon',
    system: { damage: '1d10', critDmg: '10', description: '<p>Six shots.</p>', woundEffect: '', ...system },
    fire,
    reload,
    toChat: () => ({ itemId: 'wpn1', name: 'Revolver', img: 'revolver.png', type: 'weapon', description: '', roll: null }),
  };
}

function actor(strength = 40, items: readonly CheckItem[] = []): CheckActor & { updates: object[] } {
  const updates: object[] = [];
  const system = {
    stats: { strength: { value: strength, mod: 0, label: 'Strength', rollLabel: 'Strength Check' } },
  };
  const collection: ItemCollection = {
    [Symbol.iterator]: () => items[Symbol.iterator](),
    get: (id) => items.find((item) => item.id === id),
  };

  return {
    id: 'actor1',
    name: 'Sarah',
    img: 'sarah.png',
    type: 'character',
    system,
    items: collection,
    token: null,
    updates,
    toObject: () => ({ system }),
    update: async (data: Record<string, number>) => {
      updates.push(data);
      return data;
    },
  };
}

function stubs(settings: Record<string, unknown> = {}, dice: readonly { faces: number; result: number }[] = []) {
  installI18n({
    'Mothership.Chat.DamageDealt': 'You inflict {damage} points of damage.',
    'Mothership.Chat.UnarmedDamage': 'You strike your target for {damage} damage.',
    'Mothership.Chat.RollDamageOffer': 'Roll the damage you deal: {damage}',
    'Mothership.Chat.DamageModeLabel': 'Roll {damage} · {mode}',
    'Mothership.RangeBand.close': 'Close',
    'Mothership.RangeBand.adjacent': 'Adjacent',
  });
  installSettings({ critDamage: 'advantage', damageDiceTheme: '', ...settings });
  const rolls = installRoll(dice);
  return { chat: installChat(), rolls };
}

describe('the damage a weapon deals', () => {
  it('is the weapon’s own, until a caller overrides it', () => {
    expect(weaponDamage(weapon())).toBe('1d10');
    expect(weaponDamage(weapon(), '3d10')).toBe('3d10');
    expect(weaponDamage(weapon(), '')).toBe('1d10');
  });

  it('is stated as arithmetic when it is the wielder’s Strength', async () => {
    const { rolls } = stubs({}, [{ faces: 10, result: 4 }]);
    const damage = await rollDamageFormula(actor(45), weapon({ damage: 'Str/10' }));

    expect(rolls.formulas).toEqual(['floor(45/10)']);
    expect(damageFlavor(damage)).toContain('You strike your target for <strong>4</strong> damage.');
  });

  it('wears the colorset the GM chose for damage dice', async () => {
    const { rolls } = stubs({ damageDiceTheme: 'damage' }, [{ faces: 10, result: 7 }]);
    const damage = await rollDamageFormula(actor(), weapon());

    expect(rolls.formulas).toEqual(['1d10[damage]']);
    expect(damageFlavor(damage)).toContain('You inflict <strong>7</strong> points of damage.');
  });

  // resolveOutcome keeps one die of a pool, which is a rule about checks: it read 2d10 as one d10
  // and every applied number was short. The stubs used one die, so the unit tier could not see it.
  it('sums the whole pool, rather than the one die a check would keep', async () => {
    stubs({}, [
      { faces: 10, result: 5 },
      { faces: 10, result: 6 },
    ]);
    const damage = await rollDamageFormula(actor(), weapon({ damage: '2d10' }));

    expect(damage.total).toBe(11);
    expect(damageFlavor(damage)).toContain('<strong>11</strong>');
  });

  // A critical keeps one of the pool — but by Foundry's `kh`, which is in the formula, not by us.
  it('lets the crit rule’s own keep decide, and reports what it kept', async () => {
    stubs({ critDamage: 'advantage' }, [
      { faces: 10, result: 5 },
      { faces: 10, result: 6 },
    ]);
    const damage = await rollDamageFormula(actor(), weapon(), { critical: true });

    expect(damage.formula).toBe('{1d10,1d10}kh');
    expect(damage.total).toBe(6);
  });

  // An inline roll is re-evaluated by every client that renders the message, so it could never be
  // the number this system applies to anybody.
  it('is a real roll, not an inline one the card re-rolls per viewer', async () => {
    stubs({}, [{ faces: 10, result: 7 }]);
    const damage = await rollDamageFormula(actor(), weapon());

    expect(damage.total).toBe(7);
    expect(damageFlavor(damage)).not.toContain('[[');
  });
});

// PSG 2 — the Combat Shotgun deals 4d10 up close and 1d10 at Long Range, and nothing records the
// range a shot was taken at.
describe('the damages a weapon deals', () => {
  const shotgun = () =>
    weapon({ damage: '4d10', range: 'close', damageModes: [{ label: 'Long Range', formula: '1d10' }] });

  it('are the weapon’s own first, each labelled by what decides it', () => {
    stubs();
    expect(damageModes(shotgun())).toEqual([
      { label: 'Close', formula: '4d10' },
      { label: 'Long Range', formula: '1d10' },
    ]);
  });

  it('are one, unlabelled, for a weapon with a range but no second damage', () => {
    stubs();
    expect(damageModes(weapon({ range: 'none' }))).toEqual([{ label: '', formula: '1d10' }]);
  });

  it('collapse to the one a caller named — that question is already settled', () => {
    stubs();
    expect(damageModes(shotgun(), '8d10')).toEqual([{ label: 'Close', formula: '8d10' }]);
  });

  it('drop the empty rows an editor leaves behind', () => {
    stubs();
    const rows = [{ label: 'Long Range', formula: '  ' }, { label: '', formula: '2d10' }];
    expect(damageModes(weapon({ damageModes: rows, range: 'none' }))).toEqual([
      { label: '', formula: '1d10' },
      { label: '', formula: '2d10' },
    ]);
  });

  it('become one button each when the GM rolls damage by hand', () => {
    stubs();
    expect(damageOffer(actor(), shotgun())).toBe(
      'Roll the damage you deal: @Damage[4d10]{Roll 4d10 · Close} @Damage[1d10]{Roll 1d10 · Long Range}',
    );
  });

  // The crit rule is not re-read at the click, so the button keeps rolling what its attack earned.
  it('carry the critical rule into the button', () => {
    stubs({ critDamage: 'doubleDamage' });
    expect(damageOffer(actor(), weapon({ range: 'none' }), { critical: true })).toBe(
      'Roll the damage you deal: @Damage[(1d10) * 2]',
    );
  });

  it('resolve the book’s Str/10 shorthand, which no button could roll', () => {
    stubs();
    expect(damageOffer(actor(45), weapon({ damage: 'Str/10', range: 'adjacent' }))).toBe(
      'Roll the damage you deal: @Damage[floor(45/10)]{Roll floor(45/10) · Adjacent}',
    );
  });
});

describe('what a critical hit does to it', () => {
  it.each([
    ['advantage', '{1d10,1d10}kh'],
    ['doubleDamage', '(1d10) * 2'],
    ['doubleDice', '1d10 + 1d10'],
    ['maxDamage', '1 * 10'],
    ['weaponValue', '1d10 + 10'],
    ['none', '1d10'],
  ] as const)('%s', (mode, expected) => {
    expect(critFormula('1d10', mode, '10')).toBe(expected);
  });

  /**
   * Damage that carries a modifier is where each rule shows its arithmetic. `1d10+1 * 2` is
   * Foundry's spelling of `1d10 + 2`: it doubled nothing, and a d10's worth of damage went missing
   * on every crit with a modifier behind it.
   */
  it.each([
    ['advantage', '{1d10+1,1d10+1}kh'],
    ['doubleDamage', '(1d10+1) * 2'],
    ['doubleDice', '1d10+1 + 1d10+1'],
    ['maxDamage', '1 * 10+1'],
    ['weaponValue', '1d10+1 + 10'],
    ['none', '1d10+1'],
  ] as const)('%s, on damage that carries a modifier', (mode, expected) => {
    expect(critFormula('1d10+1', mode, '10')).toBe(expected);
  });

  it('covers every choice the setting offers', () => {
    for (const mode of CRIT_DAMAGE_CHOICES) expect(critFormula('1d10', mode, '10')).not.toBe('');
  });

  it('leaves the damage alone when a weapon names no critical damage of its own', () => {
    expect(critFormula('1d10', 'weaponValue', '')).toBe('1d10');
  });

  it('reaches the roll only on a critical', () => {
    stubs({ critDamage: 'doubleDamage' });
    expect(damageFormula(actor(), weapon(), { critical: true })).toBe('(1d10) * 2');
    expect(damageFormula(actor(), weapon(), { critical: false })).toBe('1d10');
  });
});

/**
 * The same prose read as a roll rather than as a link: which table a Wound from this weapon lands
 * on, and how to roll it. A critical is one step worse, which is the book's own cancelling rule.
 */
describe('the wound roll a hit leads to', () => {
  const armed = (effect: string) => weapon({ woundEffect: effect });

  it('reads the table and the weapon’s own modifier', () => {
    expect(woundRollOf(armed('Gunshot'))).toEqual({ table: 'gunshot', advantage: 'none' });
    expect(woundRollOf(armed('Bleeding [+]'))).toEqual({ table: 'bleeding', advantage: 'advantage' });
    expect(woundRollOf(armed('Blunt Force [-]'))).toEqual({ table: 'blunt-force', advantage: 'disadvantage' });
  });

  it('has nothing to roll when the weapon names no wound this system knows', () => {
    expect(woundRollOf(armed(''))).toBe(null);
    expect(woundRollOf(armed('Existential Dread'))).toBe(null);
  });

  // PSG 19 — [+] and [-] cancel, so a crit worsens the weapon's own advantage rather than losing to it.
  it('is one step worse on a critical', () => {
    expect(woundRollOf(armed('Gunshot'), true)).toEqual({ table: 'gunshot', advantage: 'disadvantage' });
    expect(woundRollOf(armed('Gunshot [+]'), true)).toEqual({ table: 'gunshot', advantage: 'none' });
    expect(woundRollOf(armed('Gunshot [-]'), true)).toEqual({ table: 'gunshot', advantage: 'disadvantage' });
  });

  // Three buttons across a card: the roll the rules call for, with the other two beside it.
  it('offers the roll with a [-] and a [+] either side of it', () => {
    expect(woundOffer({ table: 'gunshot', advantage: 'none' })).toBe(
      '@Wound[gunshot -]{[-]} @Wound[gunshot] @Wound[gunshot +]{[+]}',
    );
    expect(woundOffer({ table: 'gunshot', advantage: 'disadvantage' })).toBe(
      '@Wound[gunshot -]{[-]} @Wound[gunshot -] @Wound[gunshot +]{[+]}',
    );
  });
});

describe('the wound a weapon names', () => {
  it('becomes the table action for that wound', () => {
    expect(woundEffectActions('Gunshot')).toBe('@Wound[gunshot]');
    expect(woundEffectActions('Bleeding [+]')).toBe('@Wound[bleeding +]');
    expect(woundEffectActions('Fire & Explosives [-]')).toBe('@Wound[fire-explosives -]');
    expect(woundEffectActions('Gore & Massive')).toBe('@Wound[gore-massive]');
    expect(woundEffectActions('Blunt Force [+] Gunshot')).toBe('@Wound[blunt-force +] @Wound[gunshot]');
  });

  it('leaves text naming no table as the text it is', () => {
    expect(woundEffectActions('Target is deafened')).toBe('Target is deafened');
    expect(woundEffectActions('')).toBe('');
  });
});

describe('the damage card', () => {
  it('is posted as a damage card, with the weapon and its wound', async () => {
    const { chat } = stubs({}, [{ faces: 10, result: 6 }]);
    const gun = weapon({ woundEffect: 'Gunshot' });

    await rollDamage(actor(40, [gun]), gun);

    expect(chat.cards).toHaveLength(1);
    expect(chat.cards[0].template).toBe('systems/mothershiprpg/templates/chat/rollCheck.html');
    expect(chat.cards[0].data).toMatchObject({
      showCheck: false,
      msgHeader: 'Revolver',
      woundEffect: '@Wound[gunshot]',
    });
    expect(chat.cards[0].data.flavorText).toContain('You inflict <strong>6</strong> points of damage.');
  });

  it('takes the caller’s damage when it has one — a swarm’s scaled dice', async () => {
    const { rolls } = stubs({}, [{ faces: 10, result: 6 }]);
    const gun = weapon();

    await rollDamage(actor(40, [gun]), gun, { override: '4d10' });

    expect(rolls.formulas).toEqual(['4d10']);
  });
});

// The ammo block used to run before the damage branch, double-decrementing curShots on
// attack-then-damage. The rule is now structural: nothing the damage flow can reach writes shots.
describe('the damage flow never touches the magazine', () => {
  it('calls neither fire nor reload, and writes nothing', async () => {
    stubs();
    fire.mockClear();
    reload.mockClear();
    const gun = weapon({ useAmmo: true, curShots: 6, shots: 6, ammo: 12, shotsPerFire: 1 });
    const sarah = actor(40, [gun]);

    await rollDamage(sarah, gun, { critical: true });

    expect(fire).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(sarah.updates).toEqual([]);
    expect((gun.system as { curShots: number }).curShots).toBe(6);
  });

  const root = fileURLToPath(new URL('../module', import.meta.url));
  const IMPORT = /^\s*import\s+(?!type\b)(?:[^'";]*?from\s+)?'([^']+)'/gm;

  /** Every module reachable from an entry by a *runtime* import; `import type` is erased. */
  function graph(entry: string): Set<string> {
    const seen = new Set<string>();
    const queue = [entry];

    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file) || !file.endsWith('.ts')) continue;
      seen.add(file);

      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(IMPORT)) {
        if (!match[1].startsWith('.')) continue;
        queue.push(resolve(dirname(file), match[1]));
      }
    }
    return seen;
  }

  it('has no path to the modules that can spend a shot', () => {
    const reached = [...graph(`${root}/checks/damage.ts`)].map((file) => relative(root, file));

    expect(reached).toContain('checks/damage.ts');
    expect(reached).not.toContain('inventory/ammo.ts');
    expect(reached).not.toContain('documents/item.ts');
    // The attack path is the one that does reach them, or this assertion proves nothing.
    const attack = [...graph(`${root}/checks/checks.ts`)].map((file) => relative(root, file));
    expect(attack).toContain('checks/damage.ts');
    expect(attack).toContain('checks/actor.ts');
  });

  it('names no part of the magazine in its own source', () => {
    const source = readFileSync(`${root}/checks/damage.ts`, 'utf8');

    for (const field of ['curShots', 'shotsPerFire', 'useAmmo', '.fire(', '.reload(']) {
      expect(source).not.toContain(field);
    }
  });
});

/**
 * The offer path: the GM left damage to be rolled from the card, so the card was posted with no
 * damage total — and everything the total decides was settled then, with the answer "none".
 */
describe('the damage a card was asked for', () => {
  const TARGET = 'Scene.s1.Token.t1';

  function offered(overrides: Record<string, unknown> = {}) {
    const data = {
      damageTotal: null,
      showTargets: false,
      targets: targetRows([{ uuid: TARGET, name: 'beastie', img: 'b.png' }], null),
      ...overrides,
    };
    return {
      getFlag: () => ({ kind: 'check', data }),
      canUserModify: () => true,
      update: vi.fn(async () => undefined),
    };
  }

  const roll = async (message: ReturnType<typeof offered>) =>
    await rollDamageInCard(message, {}, actor(40, [weapon()]), weapon(), '1d10');

  it('turns the Targets block back on, which the card was posted without', async () => {
    stubs({}, [{ faces: 10, result: 5 }]);
    const card = offered();

    expect(await roll(card)).toBe('rewritten');

    const [update] = card.update.mock.lastCall as unknown as [Record<string, unknown>];
    expect(update['flags.mothershiprpg.card.data.damageTotal']).toBe(5);
    expect(update['flags.mothershiprpg.card.data.showTargets']).toBe(true);
  });

  // Without this the row is drawn, and has no button on it — the damage has nowhere to be spent.
  it('gives every recorded row the buttons that spend the damage just rolled', async () => {
    stubs({}, [{ faces: 10, result: 5 }]);
    const card = offered();

    await roll(card);

    const [update] = card.update.mock.lastCall as unknown as [Record<string, unknown>];
    const rows = update['flags.mothershiprpg.card.data.targets'] as { uuid: string; actions: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].uuid).toBe(TARGET);
    expect(rows[0].actions).toContain('@Harm[5]');
  });

  it('leaves a row that already paid alone', async () => {
    stubs({}, [{ faces: 10, result: 5 }]);
    const card = offered({
      targets: targetRows([{ uuid: TARGET, name: 'beastie', img: 'b.png' }], 4, { [TARGET]: 4 }),
    });

    await roll(card);

    const [update] = card.update.mock.lastCall as unknown as [Record<string, unknown>];
    const rows = update['flags.mothershiprpg.card.data.targets'] as { taken: boolean; applied: number }[];
    expect(rows[0]).toMatchObject({ taken: true, applied: 4 });
  });

  // The block is drawn before the damage exists: the row names who was aimed at, and Change Target
  // is the only way to aim a shot that was fired at nothing.
  it('is offered against the targets the card named, before the roll', () => {
    stubs();
    const card = checkCard({
      source: { actorId: 'a1', actorImg: 'a.png', tokenId: null },
      outcome: { total: 42, success: true, critical: false, autoFailed: false, dice: [], keep: 'low' } as never,
      spec: { die: 'd100', modifier: 0, advantage: 'none', aim: 'low' } as never,
      comparison: 'lessThan' as never,
      header: 'Smart Rifle',
      image: 'rifle.png',
      attribute: 'Combat',
      weapon: { _id: 'w1', name: 'Smart Rifle', img: 'r.png', system: { description: 'A rifle.' } },
      targets: [{ uuid: TARGET, name: 'beastie', img: 'b.png' }],
      damageTotal: null,
      targeting: true,
    });

    const data = card.data as { showTargets: boolean; targets: { name: string; actions: string }[]; retarget: string };
    expect(data.showTargets).toBe(true);
    expect(data.targets[0].name).toBe('beastie');
    // No damage to spend yet, so the row names the target and offers no button.
    expect(data.targets[0].actions).toBe('');
    expect(data.retarget).toBe('@Retarget[]');
  });

  it('refuses a card this user does not own', async () => {
    stubs({}, [{ faces: 10, result: 5 }]);
    const card = { ...offered(), canUserModify: () => false };

    expect(await roll(card)).toBe('forbidden');
    expect(card.update).not.toHaveBeenCalled();
  });
});
