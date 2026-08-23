import { afterEach, describe, expect, it } from 'vitest';

import { currentTargets, targetActor } from '../module/checks/targets.ts';
import { clearFoundryStubs } from './foundry-stubs.ts';

type Globals = Record<string, unknown>;

afterEach(clearFoundryStubs);

function token(uuid: string, name: string, actorName = name, img = 'a.png') {
  return { document: { uuid, name }, actor: { name: actorName, img } };
}

function withTargets(targets: unknown[] | undefined): void {
  (globalThis as Globals).game = { user: { targets } };
}

describe('who is being aimed at', () => {
  it('is nobody at all outside a canvas', () => {
    withTargets(undefined);
    expect(currentTargets()).toEqual([]);
  });

  // Two copies of one creature share an actor; the token names are what tell the rows apart.
  it('is named by the token, not the actor behind it', () => {
    withTargets([token('Scene.s1.Token.t1', 'Xenomorph (1)', 'Xenomorph'), token('Scene.s1.Token.t2', 'Xenomorph (2)', 'Xenomorph')]);

    expect(currentTargets()).toEqual([
      { uuid: 'Scene.s1.Token.t1', name: 'Xenomorph (1)', img: 'a.png' },
      { uuid: 'Scene.s1.Token.t2', name: 'Xenomorph (2)', img: 'a.png' },
    ]);
  });

  it('falls back to the actor’s name for a token that carries none', () => {
    withTargets([{ document: { uuid: 'Scene.s1.Token.t1' }, actor: { name: 'Wilson', img: 'w.png' } }]);
    expect(currentTargets()).toEqual([{ uuid: 'Scene.s1.Token.t1', name: 'Wilson', img: 'w.png' }]);
  });

  // A token with no actor has no Health to spend, so it is not a target this system can offer.
  it('skips a token with no actor behind it', () => {
    withTargets([{ document: { uuid: 'Scene.s1.Token.t1' }, actor: null }, token('Scene.s1.Token.t2', 'Wilson')]);
    expect(currentTargets()).toEqual([{ uuid: 'Scene.s1.Token.t2', name: 'Wilson', img: 'a.png' }]);
  });
});

describe('finding a target again', () => {
  it('is the actor behind the token the card recorded', async () => {
    const wilson = { name: 'Wilson' };
    (globalThis as Globals).foundry = { utils: { fromUuid: async () => ({ actor: wilson }) } };

    expect(await targetActor('Scene.s1.Token.t1')).toBe(wilson);
  });

  // A card about an actor's own change records the actor, not a token — there may be no token.
  it('is the actor itself when the card recorded an actor', async () => {
    const sarah = { name: 'Sarah', documentName: 'Actor' };
    (globalThis as Globals).foundry = { utils: { fromUuid: async () => sarah } };

    expect(await targetActor('Actor.actor1')).toBe(sarah);
  });

  // Neither a token nor an actor: a uuid off the wire must not become a document to write to.
  it('is null for a uuid that names something else', async () => {
    (globalThis as Globals).foundry = {
      utils: { fromUuid: async () => ({ name: 'Revolver', documentName: 'Item' }) },
    };

    expect(await targetActor('Item.item1')).toBeNull();
  });

  // The token was deleted between the roll and the click; the button says so rather than throwing.
  it('is null for a token that is gone', async () => {
    (globalThis as Globals).foundry = { utils: { fromUuid: async () => null } };
    expect(await targetActor('Scene.s1.Token.t1')).toBeNull();
  });
});
