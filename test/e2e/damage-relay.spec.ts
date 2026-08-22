import { type Browser, type Page } from '@playwright/test';
import { test, expect, joinAs, waitForGameReady } from './fixtures/foundry-clients.ts';

/**
 * The Warden's client applying damage a player may not apply themselves. Two real sessions on one
 * socket is the only place this can be proved: a player owns neither the creature nor the write.
 */

const OWNERSHIP_OWNER = 3;

/** Reads through the token, so an unlinked token's own actor is the one measured. */
const tokenHealth = (page: Page, token: string) =>
  page.evaluate(async (uuid: string) => {
    const w = window as any;
    return (await w.fromUuid(uuid)).actor.toObject().system.health.value as number;
  }, token);

/** Activating a scene is the Warden's to do; every other client is pulled onto it and waits. */
async function activateScene(gmPage: Page): Promise<void> {
  await gmPage.evaluate(async () => {
    const w = window as any;
    if (w.canvas.scene?.name === '__e2e_stage') return;
    const existing = w.game.scenes.find((s: any) => s.name === '__e2e_stage');
    const scene = existing ?? (await w.Scene.create({ name: '__e2e_stage', width: 2000, height: 2000 }));
    await scene.activate();
  });
  await awaitCanvas(gmPage);
}

async function awaitCanvas(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => (window as any).canvas?.ready === true), { timeout: 30_000 })
    .toBe(true);
}

test.describe('the Warden’s client applies what a player may not', () => {
  let playerPage: Page;
  let playerId: string;

  test.beforeAll(async ({ gmPage, browser }: { gmPage: Page; browser: Browser }) => {
    await gmPage.reload();
    await waitForGameReady(gmPage);
    await activateScene(gmPage);

    playerId = await gmPage.evaluate(async () => {
      const w = window as any;
      const existing = w.game.users.find((u: any) => u.name === '__e2e_player');
      const user = existing ?? (await w.User.create({ name: '__e2e_player', role: 1 }));
      return user.id as string;
    });

    const context = await browser.newContext();
    playerPage = await context.newPage();
    await joinAs(playerPage, playerId);
    await awaitCanvas(playerPage);
    await playerPage.addStyleTag({ content: '#notifications { display: none !important; }' });
  });

  test.afterAll(async ({ gmPage }: { gmPage: Page }) => {
    await playerPage.context().close();
    await gmPage.evaluate(async (id: string) => {
      const w = window as any;
      const tokens = w.canvas.scene.tokens.filter((t: any) => t.name.startsWith('__e2e_')).map((t: any) => t.id);
      if (tokens.length) await w.canvas.scene.deleteEmbeddedDocuments('Token', tokens);
      const actors = w.game.actors.filter((a: any) => a.name.startsWith('__e2e_')).map((a: any) => a.id);
      if (actors.length) await w.game.actors.documentClass.deleteDocuments(actors);
      await w.game.users.get(id)?.delete();

      // An active scene changes the client's chrome, and the visual baselines measure windows
      // against it — a stage left standing here is a failure over in that file.
      const scenes = w.game.scenes.filter((scene: any) => scene.name.startsWith('__e2e_')).map((s: any) => s.id);
      if (scenes.length) await w.game.scenes.documentClass.deleteDocuments(scenes);
    }, playerId);
  });

  /** A gun the player owns, and a creature the Warden alone owns, standing on the canvas. */
  async function arm(gmPage: Page, woundEffect = ''): Promise<string> {
    return await gmPage.evaluate(
      async ({ id, owner, woundEffect }: { id: string; owner: number; woundEffect: string }) => {
        const w = window as any;

        const shooter = await w.Actor.create({
          name: '__e2e_shooter',
          type: 'character',
          system: { stats: { combat: { value: 90 } } },
          ownership: { [id]: owner },
        });
        await shooter.createEmbeddedDocuments('Item', [
          {
            name: '__e2e_gun',
            type: 'weapon',
            system: { damage: '2d10', range: 'close', useAmmo: false, woundEffect },
          },
        ]);
        await w.game.users.get(id).update({ character: shooter.id });

        // No ownership entry for the player: this is the Warden's creature.
        const victim = await w.Actor.create({
          name: '__e2e_victim',
          type: 'creature',
          system: { health: { value: 20, max: 20 }, hits: { value: 0, max: 3 } },
        });
        const [token] = await w.canvas.scene.createEmbeddedDocuments('Token', [
          { name: '__e2e_victim', actorId: victim.id, x: 1000, y: 1000 },
        ]);
        return token.uuid as string;
      },
      { id: playerId, owner: OWNERSHIP_OWNER, woundEffect },
    );
  }

  /** The player targets the creature, fires, and answers the skill prompt. */
  async function playerFires(token: string): Promise<{ message: string; total: number }> {
    await awaitCanvas(playerPage);

    await playerPage.evaluate(async (uuid: string) => {
      const w = window as any;
      w.foundry.dice.terms.DiceTerm.prototype._roll = async () => 5;
      const document = await w.fromUuid(uuid);
      (document.object ?? w.canvas.tokens.get(document.id))?.setTarget(true, { releaseOthers: true });
      w.ui.sidebar.collapse();
      await new Promise((resolve) => setTimeout(resolve, 200));

      const actor = w.game.user.character;
      void actor.rollWeapon(actor.items.find((i: any) => i.type === 'weapon').id);
    }, token);

    const dialog = playerPage.locator('dialog[open].macro-popup-dialog').last();
    await expect(dialog).toBeVisible();
    await dialog.locator('button[data-action="none"]').click();

    return await playerPage.evaluate(async () => {
      const w = window as any;
      for (let tries = 0; tries < 60; tries += 1) {
        const message = w.game.messages.contents.at(-1);
        const total = message?.flags?.mothershiprpg?.card?.data?.damageTotal ?? null;
        if (typeof total === 'number') return { message: message.id as string, total };
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('the player posted no damage card');
    });
  }

  test('a player’s Apply spends a creature only the Warden owns', async ({ gmPage }) => {
    const token = await arm(gmPage);
    expect(await tokenHealth(gmPage, token)).toBe(20);

    const { message, total } = await playerFires(token);

    // The write is refused on this client, which is the whole reason for the relay.
    const ownedHere = await playerPage.evaluate(async (uuid: string) => {
      const w = window as any;
      return (await w.fromUuid(uuid)).actor.isOwner as boolean;
    }, token);
    expect(ownedHere).toBe(false);

    await playerPage.locator(`[data-message-id="${message}"] .card-target .mothership-action`).first().click();

    await expect.poll(() => tokenHealth(gmPage, token), { timeout: 20_000 }).toBe(20 - total);
  });

  // The relay would be a hole if the request could name its own number: the Warden's client reads
  // the amount off the card instead, so a forged one spends exactly what the card rolled.
  test('a forged amount buys nothing — the card is what is believed', async ({ gmPage }) => {
    const token = await arm(gmPage);
    const { message, total } = await playerFires(token);

    await playerPage.evaluate(
      async ({ messageId, uuid }: { messageId: string; uuid: string }) => {
        const w = window as any;
        w.game.socket.emit('system.mothershiprpg', {
          kind: 'request',
          action: 'harm',
          data: { messageId, uuid, half: false, amount: 9999, total: 9999 },
          senderId: w.game.user.id,
          requestId: 'forged',
        });
      },
      { messageId: message, uuid: token },
    );

    await expect.poll(() => tokenHealth(gmPage, token), { timeout: 20_000 }).toBe(20 - total);
  });

  /**
   * The other half of a hit: rolling the Wound writes to whoever took it, so it goes the same way
   * the damage did. A `@Table` here would have rolled against the shooter's own character instead.
   */
  test('a player’s Wound roll charges a creature only the Warden owns', async ({ gmPage }) => {
    const token = await arm(gmPage, 'Gunshot');
    const { message } = await playerFires(token);

    await playerPage.locator(`[data-message-id="${message}"] .card-wound .mothership-action`).first().click();

    await expect
      .poll(
        () =>
          gmPage.evaluate(
            async (uuid: string) => (await (window as any).fromUuid(uuid)).actor.toObject().system.hits.value,
            token,
          ),
        { timeout: 20_000 },
      )
      .toBe(1);

    // The roll and the row it landed on, in a card both clients can read.
    await expect(gmPage.locator('#chat-notifications .chat-message').last()).toContainText('Gunshot Wound');
  });

  test('a request aimed somewhere the card never was is refused', async ({ gmPage }) => {
    const token = await arm(gmPage);
    const bystander = await gmPage.evaluate(async () => {
      const w = window as any;
      const actor = await w.Actor.create({
        name: '__e2e_bystander',
        type: 'creature',
        system: { health: { value: 20, max: 20 } },
      });
      const [placed] = await w.canvas.scene.createEmbeddedDocuments('Token', [
        { name: '__e2e_bystander', actorId: actor.id, x: 1400, y: 1000 },
      ]);
      return placed.uuid as string;
    });

    const { message } = await playerFires(token);

    await playerPage.evaluate(
      async ({ messageId, uuid }: { messageId: string; uuid: string }) => {
        const w = window as any;
        w.game.socket.emit('system.mothershiprpg', {
          kind: 'request',
          action: 'harm',
          data: { messageId, uuid, half: false },
          senderId: w.game.user.id,
          requestId: 'redirected',
        });
      },
      { messageId: message, uuid: bystander },
    );

    // Given time to be wrong, then measured: the bystander was never on that card.
    await gmPage.waitForTimeout(3000);
    expect(await tokenHealth(gmPage, bystander)).toBe(20);
  });
});
