import { afterEach, describe, expect, it, vi } from 'vitest';

const rolledTables = vi.hoisted(() => [] as { key: string; options: Record<string, unknown> }[]);

// The draw itself is `checks/tables.ts`'s and needs a compendium; what this file proves is who the
// Wound is rolled against, and whether it charges one.
vi.mock('../module/checks/tables.ts', () => ({
  runTable: async (actor: { id?: string }, key: string, options: Record<string, unknown>) => {
    rolledTables.push({ key, options: { ...options, actor: actor.id } });
    return null;
  },
}));

import { targetRows } from '../module/chat/cards.ts';
import { isWoundRequest, woundFromCard } from '../module/checks/wound.ts';
import { clearFoundryStubs, installChat, installI18n, installSettings } from './foundry-stubs.ts';

afterEach(() => {
  clearFoundryStubs();
  rolledTables.length = 0;
});

const WILSON = 'Scene.s1.Token.t1';
const HARDY = 'Scene.s1.Token.t2';

function stubs() {
  installI18n({});
  installSettings({});
  return installChat();
}

function message(kind: string, data: Record<string, unknown>, owns = true) {
  return {
    getFlag: () => ({ kind, data }),
    canUserModify: () => owns,
    update: vi.fn(async () => undefined),
  };
}

function attackCard(overrides: Record<string, unknown> = {}, owns = true) {
  return message(
    'check',
    {
      woundEffect: '@Wound[gunshot]',
      damageTotal: 7,
      targets: targetRows(
        [
          { uuid: WILSON, name: 'Wilson', img: 'w.png' },
          { uuid: HARDY, name: 'Hardy', img: 'h.png' },
        ],
        7,
      ),
      ...overrides,
    },
    owns,
  );
}

function hitCard(overrides: Record<string, unknown> = {}, owns = true) {
  return message(
    'mutation',
    { woundActions: '@Wound[gunshot]', subject: WILSON, ...overrides },
    owns,
  );
}

/** Merged onto whatever `installChat` put there — replacing it takes the renderer with it. */
function resolving(uuids: Readonly<Record<string, unknown>>): void {
  const foundry = ((globalThis as Record<string, unknown>).foundry ?? {}) as Record<string, unknown>;
  foundry.utils = { fromUuid: async (uuid: string) => ({ actor: uuids[uuid] ?? null }) };
  (globalThis as Record<string, unknown>).foundry = foundry;
}

const request = (overrides: Record<string, unknown> = {}) => ({
  messageId: 'm1',
  uuid: null,
  table: 'gunshot' as const,
  advantage: 'none' as const,
  ...overrides,
});

describe('what a wound request has to be', () => {
  it('names a wound table — the Panic Check and the Death Save are not Wounds', () => {
    expect(isWoundRequest(request())).toBe(true);
    expect(isWoundRequest(request({ table: 'panic' }))).toBe(false);
    expect(isWoundRequest(request({ table: 'nonsense' }))).toBe(false);
  });

  it('names a modifier the system knows', () => {
    expect(isWoundRequest(request({ advantage: 'advantage' }))).toBe(true);
    expect(isWoundRequest(request({ advantage: 'lucky' }))).toBe(false);
  });

  it('names a row or nothing, never a number', () => {
    expect(isWoundRequest(request({ uuid: WILSON }))).toBe(true);
    expect(isWoundRequest(request({ uuid: 7 }))).toBe(false);
  });
});

describe('the Wound a weapon’s card leads to', () => {
  it('is rolled against the row the button sits in, and charges the Wound', async () => {
    stubs();
    resolving({ [WILSON]: { id: 'wilson' } });

    const outcome = await woundFromCard(
      { message: attackCard(), sender: {} },
      request({ uuid: WILSON, advantage: 'disadvantage' }),
    );

    expect(outcome).toMatchObject({ kind: 'rolled' });
    expect(rolledTables).toEqual([
      { key: 'gunshot', options: { advantage: 'disadvantage', costsWound: true, actor: 'wilson' } },
    ]);
  });

  it('takes every target the card recorded when the button names no row', async () => {
    stubs();
    resolving({ [WILSON]: { id: 'wilson' }, [HARDY]: { id: 'hardy' } });

    await woundFromCard({ message: attackCard(), sender: {} }, request());

    expect(rolledTables.map((rolled) => rolled.options.actor)).toEqual(['wilson', 'hardy']);
  });

  // The crosshairs are the obvious way to abuse a relay: the card is the record, not the selection.
  it('refuses a target the card did not record', async () => {
    stubs();
    resolving({ 'Scene.s1.Token.elsewhere': { id: 'bystander' } });

    const outcome = await woundFromCard(
      { message: attackCard(), sender: {} },
      request({ uuid: 'Scene.s1.Token.elsewhere' }),
    );

    expect(outcome).toEqual({ kind: 'unaimed' });
    expect(rolledTables).toEqual([]);
  });

  it('refuses a sender the card does not belong to', async () => {
    stubs();
    resolving({ [WILSON]: { id: 'wilson' } });

    const outcome = await woundFromCard(
      { message: attackCard({}, false), sender: {} },
      request({ uuid: WILSON }),
    );

    expect(outcome).toEqual({ kind: 'forbidden' });
    expect(rolledTables).toEqual([]);
  });

  it('refuses a card whose weapon names no wound effect', async () => {
    stubs();
    resolving({ [WILSON]: { id: 'wilson' } });

    const outcome = await woundFromCard(
      { message: attackCard({ woundEffect: '' }), sender: {} },
      request({ uuid: WILSON }),
    );

    expect(outcome).toEqual({ kind: 'unaimed' });
    expect(rolledTables).toEqual([]);
  });

  it('refuses a message this system put no card in', async () => {
    stubs();
    const bare = { getFlag: () => undefined, canUserModify: () => true, update: vi.fn() };

    expect(await woundFromCard({ message: bare, sender: {} }, request())).toEqual({ kind: 'forbidden' });
  });
});

describe('the Wound a hit already spent', () => {
  it('is rolled against the actor the card recorded, and charges nothing', async () => {
    stubs();
    resolving({ [WILSON]: { id: 'wilson' } });

    const outcome = await woundFromCard({ message: hitCard(), sender: {} }, request());

    expect(outcome).toMatchObject({ kind: 'rolled' });
    expect(rolledTables).toEqual([
      { key: 'gunshot', options: { advantage: 'none', costsWound: false, actor: 'wilson' } },
    ]);
  });

  it('ignores a row the request names — the card knows whose Wound it is', async () => {
    stubs();
    resolving({ [WILSON]: { id: 'wilson' }, [HARDY]: { id: 'hardy' } });

    await woundFromCard({ message: hitCard(), sender: {} }, request({ uuid: HARDY }));

    expect(rolledTables.map((rolled) => rolled.options.actor)).toEqual(['wilson']);
  });

  it('spends the offer in the card that made it, so one hit cannot be rolled twice', async () => {
    stubs();
    resolving({ [WILSON]: { id: 'wilson' } });
    const card = hitCard();

    await woundFromCard({ message: card, sender: {} }, request());

    expect(card.update).toHaveBeenCalledWith(
      expect.objectContaining({ 'flags.mothershiprpg.card.data.woundActions': '' }),
    );
  });

  it('refuses a card whose offer has already been spent', async () => {
    stubs();
    resolving({ [WILSON]: { id: 'wilson' } });

    const outcome = await woundFromCard({ message: hitCard({ woundActions: '' }), sender: {} }, request());

    expect(outcome).toEqual({ kind: 'unaimed' });
    expect(rolledTables).toEqual([]);
  });

  // Posted by the Warden's client, which the player who landed the hit does not own — and the roll
  // it offers writes nothing, because the damage already spent the Wound.
  it('is rolled by whoever clicks it, card or no card', async () => {
    stubs();
    resolving({ [WILSON]: { id: 'wilson' } });

    const outcome = await woundFromCard({ message: hitCard({}, false), sender: {} }, request());

    expect(outcome).toMatchObject({ kind: 'rolled' });
    expect(rolledTables).toHaveLength(1);
  });

  it('refuses a card posted before this system recorded whose Wound it is', async () => {
    stubs();
    resolving({ [WILSON]: { id: 'wilson' } });

    const outcome = await woundFromCard({ message: hitCard({ subject: null }), sender: {} }, request());

    expect(outcome).toEqual({ kind: 'unaimed' });
    expect(rolledTables).toEqual([]);
  });
});
