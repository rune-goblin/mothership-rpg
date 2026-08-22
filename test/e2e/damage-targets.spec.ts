import { type Page } from '@playwright/test';
import { test, expect } from './fixtures/foundry-clients.ts';

/**
 * Only a real Foundry proves this end to end: the target set is Foundry's own, the row is drawn by
 * Handlebars, `@Harm[…]` becomes a button through the enricher, and the click routes through the
 * delegated listener to a document write.
 */

/**
 * Read through the token, not the base actor: a token is unlinked unless it says otherwise, so its
 * actor is the synthetic one and a write lands in the token's delta. That is what a hit hits.
 */
const stored = (page: Page, token: string, path: string) =>
  page.evaluate(
    async ({ u, p }: { u: string; p: string }) => {
      const w = window as any;
      return w.foundry.utils.getProperty((await w.fromUuid(u)).actor.toObject(), p);
    },
    { u: token, p: path },
  );

const rigDie = (page: Page, n: number) =>
  page.evaluate((result: number) => {
    const w = window as any;
    w.__unrigDie = w.foundry.dice.terms.DiceTerm.prototype._roll;
    w.foundry.dice.terms.DiceTerm.prototype._roll = async () => result;
  }, n);

const unrigDie = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    if (w.__unrigDie) w.foundry.dice.terms.DiceTerm.prototype._roll = w.__unrigDie;
    delete w.__unrigDie;
  });

const answer = async (page: Page, action: string) => {
  const dialog = page.locator('dialog[open].macro-popup-dialog').last();
  await expect(dialog).toBeVisible();
  await dialog.locator(`button[data-action="${action}"]`).click();
  await expect(dialog).toHaveCount(0);
};

/** The uuids the cast is reached by, built once in `beforeAll` and reset between tests. */
type Cast = { shooter: string; victim: string; actor: string };
let cast: Cast;

/**
 * A shooter with a gun, and a victim on the canvas — built once. Nine tests used to create and
 * delete this whole cast apiece, which was most of what the file spent its time on; what actually
 * differs between them is the victim's numbers, and `aim` writes those.
 */
async function buildCast(page: Page): Promise<Cast> {
  await page.evaluate(async () => {
    const w = window as any;
    if (w.canvas.scene?.name === '__e2e_stage') return;
    const scene = await w.Scene.create({ name: '__e2e_stage', width: 2000, height: 2000 });
    await scene.activate();
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).canvas.ready === true), { timeout: 30_000 })
    .toBe(true);

  return await page.evaluate(async () => {
    const w = window as any;

    const shooter = await w.Actor.create({
      name: '__e2e_shooter',
      type: 'character',
      system: { stats: { combat: { value: 90 } } },
    });
    await shooter.createEmbeddedDocuments('Item', [
      { name: '__e2e_gun', type: 'weapon', system: { damage: '2d10', range: 'close', useAmmo: false } },
    ]);
    await w.game.user.update({ character: shooter.id });

    const victim = await w.Actor.create({ name: '__e2e_victim', type: 'character' });
    const [token] = await w.canvas.scene.createEmbeddedDocuments('Token', [
      { name: '__e2e_victim', actorId: victim.id, x: 1000, y: 1000 },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 200));

    w.ui.sidebar.collapse();
    return { shooter: shooter.uuid as string, victim: token.uuid as string, actor: victim.uuid as string };
  });
}

/**
 * Point the standing cast at this test's situation: the victim's numbers, the crosshairs, and
 * nothing left over from the test before.
 *
 * Every field a test reads is written every time rather than merged — the token is unlinked, so a
 * hit lands in its delta, and a partial reset would leave the previous test's number underneath.
 */
async function aim(page: Page, victimSystem: Record<string, unknown> = {}): Promise<Cast> {
  await page.evaluate(
    async ({ ids, system }: { ids: Cast; system: Record<string, unknown> }) => {
      const w = window as any;
      const health = (system.health ?? {}) as { value?: number; max?: number };
      const hits = (system.hits ?? {}) as { value?: number; max?: number };

      const base = await w.fromUuid(ids.actor);
      const worn = base.items.filter((item: any) => item.name.startsWith('__e2e_')).map((i: any) => i.id);
      if (worn.length) await base.deleteEmbeddedDocuments('Item', worn);

      const token = await w.fromUuid(ids.victim);
      await token.actor.update({
        system: {
          health: { value: health.value ?? 20, max: health.max ?? 20 },
          hits: { value: hits.value ?? 0, max: hits.max ?? 2 },
        },
      });

      // The wound effect is the shooter's, and two tests set it.
      const shooter = await w.fromUuid(ids.shooter);
      await shooter.items.find((i: any) => i.type === 'weapon').update({ 'system.woundEffect': '' });

      // A second victim belongs to the one test that makes it.
      const strays = w.canvas.scene.tokens.filter((t: any) => t.name === '__e2e_second').map((t: any) => t.id);
      if (strays.length) await w.canvas.scene.deleteEmbeddedDocuments('Token', strays);
      const strayActors = w.game.actors.filter((a: any) => a.name === '__e2e_second').map((a: any) => a.id);
      if (strayActors.length) await w.game.actors.documentClass.deleteDocuments(strayActors);

      for (const targeted of [...w.game.user.targets]) targeted.setTarget(false, { releaseOthers: false });
      (token.object ?? w.canvas.tokens.get(token.id))?.setTarget(true, { releaseOthers: true });
    },
    { ids: cast, system: victimSystem },
  );
  return cast;
}

/** Returns the card's own damage total: what the buttons offer is what the dice said, not a constant. */
async function fire(page: Page, shooter: string): Promise<{ message: string; total: number }> {
  await rigDie(page, 5); // 5 against Combat 90 is a hit, so the card carries damage.
  await page.evaluate(async (u: string) => {
    const actor = await (window as any).fromUuid(u);
    void actor.rollWeapon(actor.items.find((i: any) => i.type === 'weapon').id);
  }, shooter);
  await answer(page, 'none');

  // Every run leaves its own cards in the log, so the row under test is found by message id.
  return await page.evaluate(async () => {
    const w = window as any;
    for (let tries = 0; tries < 60; tries += 1) {
      const message = w.game.messages.contents.at(-1);
      const total = message?.flags?.mothershiprpg?.card?.data?.damageTotal ?? null;
      if (typeof total === 'number') return { message: message.id as string, total };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('no damage card was posted');
  });
}

const row = (page: Page, message: string) =>
  page.locator(`[data-message-id="${message}"] .card-target`).first();

test.describe('applying damage to the targeted actor', () => {
  test.beforeAll(async ({ gmPage }) => {
    cast = await buildCast(gmPage);
  });

  // The cast and its scene are this file's, and an active scene changes the client's chrome — which
  // moves every window `visual-baselines.spec.ts` measures. Leaving one behind is what made those
  // baselines depend on whether this file ran first.
  test.afterAll(async ({ gmPage }) => {
    await gmPage.evaluate(async () => {
      const w = window as any;
      await w.game.user.update({ character: null });
      for (const targeted of [...w.game.user.targets]) targeted.setTarget(false, { releaseOthers: false });

      const tokens = w.canvas.scene.tokens.filter((t: any) => t.name.startsWith('__e2e_')).map((t: any) => t.id);
      if (tokens.length) await w.canvas.scene.deleteEmbeddedDocuments('Token', tokens);
      const actors = w.game.actors.filter((a: any) => a.name.startsWith('__e2e_')).map((a: any) => a.id);
      if (actors.length) await w.game.actors.documentClass.deleteDocuments(actors);
      const scenes = w.game.scenes.filter((scene: any) => scene.name.startsWith('__e2e_')).map((s: any) => s.id);
      if (scenes.length) await w.game.scenes.documentClass.deleteDocuments(scenes);
    });
  });

  test.afterEach(async ({ gmPage }) => {
    await unrigDie(gmPage);
    await gmPage.evaluate(async () => {
      const w = window as any;

      // Only what a test opened. Foundry keeps its persistent chrome in `ui` — the sidebar the chat
      // log lives in above all — and closing that leaves no chat UI to click a button in, which is
      // what used to cost this file a full client reload before every test.
      const persistent = new Set(Object.values(w.ui).filter((part: any) => part && typeof part === 'object'));
      for (const app of (w.foundry.applications.instances?.values?.() ?? []) as any[]) {
        if (!persistent.has(app)) await app.close?.();
      }
    });
  });

  test('a hit names who it was aimed at, and its button spends their Health', async ({ gmPage }) => {
    const { shooter, victim } = await aim(gmPage, { health: { value: 20, max: 20 } });

    const { message, total } = await fire(gmPage, shooter);

    await expect(row(gmPage, message)).toContainText('__e2e_victim');
    expect(await stored(gmPage, victim, 'system.health.value')).toBe(20);

    await row(gmPage, message).locator('.mothership-action').first().click();

    await expect.poll(() => stored(gmPage, victim, 'system.health.value')).toBe(20 - total);
  });

  test('the same damage cannot be spent on the same target twice', async ({ gmPage }) => {
    const { shooter, victim } = await aim(gmPage, { health: { value: 20, max: 20 } });

    const { message, total } = await fire(gmPage, shooter);
    await row(gmPage, message).locator('.mothership-action').first().click();
    await expect.poll(() => stored(gmPage, victim, 'system.health.value')).toBe(20 - total);

    // The row redraws as a record of what was taken, so there is no button left to click.
    await expect(row(gmPage, message)).toContainText(String(total));
    await expect(row(gmPage, message).locator('.mothership-action')).toHaveCount(0);
  });

  test('the half button spends half, rounded down', async ({ gmPage }) => {
    const { shooter, victim } = await aim(gmPage, { health: { value: 20, max: 20 } });

    const { message, total } = await fire(gmPage, shooter);
    await row(gmPage, message).locator('.mothership-action').nth(1).click();

    await expect.poll(() => stored(gmPage, victim, 'system.health.value')).toBe(20 - Math.floor(total / 2));
  });

  // PSG 25 — a suit's Damage Reduction comes off each hit before the bar is touched.
  test('armour keeps its Damage Reduction off the hit', async ({ gmPage }) => {
    const { shooter, victim, actor } = await aim(gmPage, { health: { value: 20, max: 20 } });
    await gmPage.evaluate(async (u: string) => {
      const actor = await (window as any).fromUuid(u);
      await actor.createEmbeddedDocuments('Item', [
        { name: '__e2e_suit', type: 'armor', system: { damageReduction: 3, armorPoints: 10, equipped: true } },
      ]);
    }, actor);

    const { message, total } = await fire(gmPage, shooter);
    await row(gmPage, message).locator('.mothership-action').first().click();

    await expect.poll(() => stored(gmPage, victim, 'system.health.value')).toBe(20 - (total - 3));
  });

  // The damage was already rolled: aiming again moves who it is offered to, and must not lose it.
  test('aiming again keeps the damage the card already rolled', async ({ gmPage }) => {
    const { shooter, victim, actor } = await aim(gmPage, { health: { value: 20, max: 20 } });

    const { message, total } = await fire(gmPage, shooter);

    // A second creature, targeted after the shot — the case of forgetting to target first.
    const second = await gmPage.evaluate(async () => {
      const w = window as any;
      const other = await w.Actor.create({
        name: '__e2e_second',
        type: 'character',
        system: { health: { value: 20, max: 20 } },
      });
      const [token] = await w.canvas.scene.createEmbeddedDocuments('Token', [
        { name: '__e2e_second', actorId: other.id, x: 1400, y: 1000 },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 200));
      (token.object ?? w.canvas.tokens.get(token.id))?.setTarget(true, { releaseOthers: true });
      return token.uuid as string;
    });

    // A card renders twice — in the log and in the notification column — so one copy is picked.
    await gmPage
      .locator(`[data-message-id="${message}"] .card-target-retarget .mothership-action`)
      .first()
      .click();

    const rows = gmPage.locator(`[data-message-id="${message}"] .card-target`).first();
    await expect(rows).toContainText('__e2e_second');

    // Still the same damage, on the new row: the card was rewritten, not re-rolled.
    await rows.locator('.mothership-action').first().click();
    await expect.poll(() => stored(gmPage, second, 'system.health.value')).toBe(20 - total);
    expect(await stored(gmPage, victim, 'system.health.value')).toBe(20);
    expect(actor).toBeTruthy();
  });

  // The crosshairs empty by accident — clicking away, or toggling the same token off — and the
  // card must survive it: an emptied card can never be aimed again, and its record of what was
  // already taken would go with the rows.
  test('aiming with nothing targeted leaves the card as it stands', async ({ gmPage }) => {
    const { shooter, victim } = await aim(gmPage, { health: { value: 20, max: 20 } });

    const { message, total } = await fire(gmPage, shooter);
    await row(gmPage, message).locator('.mothership-action').first().click();
    await expect.poll(() => stored(gmPage, victim, 'system.health.value')).toBe(20 - total);

    await gmPage.evaluate(() => {
      const w = window as any;
      for (const token of [...w.game.user.targets]) token.setTarget(false, { releaseOthers: false });
    });
    await gmPage
      .locator(`[data-message-id="${message}"] .card-target-retarget .mothership-action`)
      .first()
      .click();

    // Still the row it was, still paid: no button came back to spend the same damage again.
    await expect(row(gmPage, message)).toContainText('__e2e_victim');
    await expect(row(gmPage, message)).toContainText(String(total));
    await expect(row(gmPage, message).locator('.mothership-action')).toHaveCount(0);
  });

  /**
   * PSG 28-29 — the hit that empties the bar costs a Wound, and rolling on the weapon's table is
   * what that Wound means. Both halves are one hit: the table charges no second Wound for it.
   */
  test('a hit that empties the bar rolls the weapon’s wound table, and costs one Wound', async ({
    gmPage,
  }) => {
    const { shooter, victim } = await aim(gmPage, {
      health: { value: 1, max: 10 },
      hits: { value: 0, max: 2 },
    });
    await gmPage.evaluate(async (u: string) => {
      const actor = await (window as any).fromUuid(u);
      const weapon = actor.items.find((i: any) => i.type === 'weapon');
      await weapon.update({ 'system.woundEffect': 'Gunshot' });
    }, shooter);

    const { message } = await fire(gmPage, shooter);
    await row(gmPage, message).locator('.mothership-action').first().click();

    // One Wound for the hit, and the table that follows adds none of its own.
    await expect.poll(() => stored(gmPage, victim, 'system.hits.value')).toBe(1);

    const recent = () =>
      gmPage.evaluate(() =>
        (window as any).game.messages.contents
          .slice(-3)
          .map((message: any) => String(message.content))
          .join(''),
      );
    await expect.poll(recent).toContain('Gunshot');
    expect(await stored(gmPage, victim, 'system.hits.value')).toBe(1);
  });

  /**
   * With the roll left to the table, the card offers it — and the button rolls against the actor
   * whose card it sits in. `@Table` would have rolled it against whoever clicked, which for a
   * creature's Wound is the player who shot it.
   */
  test('a Wound the setting leaves unrolled is offered on the card, aimed at who took it', async ({
    gmPage,
  }) => {
    await gmPage.evaluate(async () => {
      await (window as any).game.settings.set('mothershiprpg', 'autoRollWoundsCharacters', false);
    });
    try {
      const { shooter, victim } = await aim(gmPage, {
        health: { value: 1, max: 10 },
        hits: { value: 0, max: 2 },
      });
      await gmPage.evaluate(async (u: string) => {
        const actor = await (window as any).fromUuid(u);
        const weapon = actor.items.find((i: any) => i.type === 'weapon');
        await weapon.update({ 'system.woundEffect': 'Gunshot' });
      }, shooter);

      const { message } = await fire(gmPage, shooter);
      await row(gmPage, message).locator('.mothership-action').first().click();
      await expect.poll(() => stored(gmPage, victim, 'system.hits.value')).toBe(1);

      // [-] · Roll Gunshot Wound · [+], on the card that reports the Wound.
      // The log copy, not the notification column's: a card that is fading out is not clickable.
      const offer = gmPage.locator('.chat-message .card-wound-roll').first();
      await expect(offer.locator('.mothership-action')).toHaveCount(3);
      await offer.locator('.mothership-action').nth(1).click();

      await expect(gmPage.locator('#chat-notifications .chat-message').last()).toContainText('Gunshot Wound');
      // Rolled against the actor the card names, and still only the one Wound the hit cost.
      expect(await stored(gmPage, victim, 'system.hits.value')).toBe(1);
    } finally {
      await gmPage.evaluate(async () => {
        await (window as any).game.settings.set('mothershiprpg', 'autoRollWoundsCharacters', true);
      });
    }
  });

  // PSG 28 — the surplus carries into the refilled bar, and the Wound is what pays for it.
  test('a hit worth more than the bar spends a Wound and refills it', async ({ gmPage }) => {
    const { shooter, victim } = await aim(gmPage, {
      health: { value: 1, max: 10 },
      hits: { value: 0, max: 2 },
    });

    const { message, total } = await fire(gmPage, shooter);
    expect(total).toBeGreaterThan(1);

    await row(gmPage, message).locator('.mothership-action').first().click();

    await expect.poll(() => stored(gmPage, victim, 'system.hits.value')).toBe(1);
    expect(await stored(gmPage, victim, 'system.health.value')).toBe(10 - (total - 1));
  });
});
