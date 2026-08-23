import { type Page } from '@playwright/test';
import { test, expect } from './fixtures/foundry-clients.ts';

const open = async (page: Page, system: Record<string, unknown> = {}, name = '__e2e_character') => {
  const opened = await page.evaluate(
    async ({ s, n }: { s: Record<string, unknown>; n: string }) => {
      const doc = await (window as any).Actor.create({ name: n, type: 'character', system: s });
      await doc.sheet.render(true);
      return { appId: doc.sheet.id as string, uuid: doc.uuid as string };
    },
    { s: system, n: name },
  );
  await expect(page.locator(`#${opened.appId}`)).toBeVisible();
  return opened;
};

const addItem = (page: Page, uuid: string, data: Record<string, unknown>) =>
  page.evaluate(
    async ({ u, d }: { u: string; d: Record<string, unknown> }) => {
      const actor = await (window as any).fromUuid(u);
      const [item] = await actor.createEmbeddedDocuments('Item', [d]);
      return item.id as string;
    },
    { u: uuid, d: data },
  );

const stored = (page: Page, uuid: string, path: string) =>
  page.evaluate(
    async ({ u, p }: { u: string; p: string }) =>
      (window as any).foundry.utils.getProperty((await (window as any).fromUuid(u)).toObject(), p),
    { u: uuid, p: path },
  );

const itemField = (page: Page, uuid: string, itemId: string, path: string) =>
  page.evaluate(
    async ({ u, i, p }: { u: string; i: string; p: string }) => {
      const actor = await (window as any).fromUuid(u);
      return (window as any).foundry.utils.getProperty(actor.items.get(i).toObject(), p);
    },
    { u: uuid, i: itemId, p: path },
  );

const setHideWeight = (page: Page, value: boolean) =>
  page.evaluate(
    (v: boolean) => (window as any).game.settings.set('mothershiprpg', 'hideWeight', v),
    value,
  );

test.describe('character sheet', () => {
  test.afterEach(async ({ gmPage }) => {
    await gmPage.evaluate(async () => {
      for (const app of ((window as any).foundry.applications.instances?.values?.() ?? []) as any[]) {
        await app.close?.();
      }
      const g = (window as any).game;
      const actors = g.actors.filter((a: any) => a.name.startsWith('__e2e_')).map((a: any) => a.id);
      if (actors.length) await g.actors.documentClass.deleteDocuments(actors);
      const items = g.items.filter((i: any) => i.name.startsWith('__e2e_')).map((i: any) => i.id);
      if (items.length) await g.items.documentClass.deleteDocuments(items);
    });
  });

  test('opens with the identity header filled from the document', async ({ gmPage }) => {
    const { appId } = await open(gmPage, {
      class: { value: 'Marine' },
      pronouns: { value: 'they/them' },
      credits: { value: '250' },
      attributes: { level: { value: 3 } },
    });
    const sheet = gmPage.locator(`#${appId}`);

    await expect(sheet.locator('.window-title')).toContainText('__e2e_character');
    await expect(sheet.locator('input[name="name"]')).toHaveValue('__e2e_character');
    await expect(sheet.locator('input[name="system.class.value"]')).toHaveValue('Marine');
    await expect(sheet.locator('input[name="system.pronouns.value"]')).toHaveValue('they/them');
    await expect(sheet.locator('input[name="system.credits.value"]')).toHaveValue('250');
    await expect(sheet.locator('input[name="system.attributes.level.value"]')).toHaveValue('3');
  });

  // Neither table hands out a document, so the header is the only place either roll survives.
  test('the patch and the trinket read back, and persist', async ({ gmPage }) => {
    const { appId, uuid } = await open(gmPage, {
      patch: { value: '"LONER"' },
      trinket: { value: 'Bone Knife' },
    });
    const sheet = gmPage.locator(`#${appId}`);

    await expect(sheet.locator('input[name="system.patch.value"]')).toHaveValue('"LONER"');
    await expect(sheet.locator('input[name="system.trinket.value"]')).toHaveValue('Bone Knife');

    const trinket = sheet.locator('input[name="system.trinket.value"]');
    await trinket.fill('Snake Whiskey');
    await trinket.blur();
    await expect.poll(() => stored(gmPage, uuid, 'system.trinket.value')).toBe('Snake Whiskey');
  });

  test('shows all four stats and all three saves, each with its bonus', async ({ gmPage }) => {
    const { appId } = await open(gmPage, {
      stats: {
        strength: { value: 45, mod: 5 },
        speed: { value: 30, mod: 0 },
        intellect: { value: 25, mod: 0 },
        combat: { value: 55, mod: 10 },
        sanity: { value: 30, mod: 0 },
        fear: { value: 40, mod: 5 },
        body: { value: 35, mod: 0 },
      },
    });
    const sheet = gmPage.locator(`#${appId}`);

    for (const [stat, value, mod] of [
      ['strength', '45', '5'],
      ['speed', '30', '0'],
      ['intellect', '25', '0'],
      ['combat', '55', '10'],
      ['sanity', '30', '0'],
      ['fear', '40', '5'],
      ['body', '35', '0'],
    ] as const) {
      await expect(sheet.locator(`input[name="system.stats.${stat}.value"]`)).toHaveValue(value);
      await expect(sheet.locator(`input[name="system.stats.${stat}.mod"]`)).toHaveValue(mod);
      await expect(sheet.locator(`span[data-key="${stat}"]`)).toBeVisible();
      await expect(sheet.locator(`span[data-key="${stat}"] i.fa-dice-d20`)).toBeVisible();
    }
  });

  // The die marks what rolls, so a field that only holds a number must not wear one. Armour is in
  // the second list: it once wore a die that opened the cover picker, and cover is a dropdown in
  // the block itself now — nothing on that label ever rolled.
  test('the roll cue sits on every rollable label and nowhere else', async ({ gmPage }) => {
    const { appId, uuid } = await open(gmPage);
    await addItem(gmPage, uuid, { name: '__e2e_zerog', type: 'skill', system: { rank: 'Trained', bonus: 10 } });
    const sheet = gmPage.locator(`#${appId}`);

    await expect(sheet.locator('label.rollable', { hasText: 'Stress' }).locator('i.fa-dice-d20')).toBeVisible();
    for (const label of ['Health', 'Wounds', 'Armor']) {
      await expect(sheet.locator('.resource-label.minmaxtext', { hasText: label }).locator('i')).toHaveCount(0);
    }
    await expect(sheet.locator('.skill-name', { hasText: '__e2e_zerog' }).locator('i.fa-dice-d20')).toBeVisible();
  });

  test('editing a stat persists through Foundry form handling', async ({ gmPage }) => {
    const { appId, uuid } = await open(gmPage);
    const combat = gmPage.locator(`#${appId} input[name="system.stats.combat.value"]`);

    await combat.fill('62');
    await combat.blur();
    await expect.poll(() => stored(gmPage, uuid, 'system.stats.combat.value')).toBe(62);
  });

  test('the trauma response persists', async ({ gmPage }) => {
    const { appId, uuid } = await open(gmPage);
    const sheet = gmPage.locator(`#${appId}`);

    const trauma = sheet.locator('textarea[name="system.other.stressdesc.value"]');
    await trauma.fill('Adrenaline surge');
    await trauma.blur();
    await expect
      .poll(() => stored(gmPage, uuid, 'system.other.stressdesc.value'))
      .toBe('Adrenaline surge');
  });

  // Stress carries a *minimum*, not a maximum -- MinMaxField names both sides for that reason.
  test('the stress block shows current over minimum and rolls a panic check', async ({ gmPage }) => {
    const { appId } = await open(gmPage, { other: { stress: { value: 5, min: 2 } } });
    const sheet = gmPage.locator(`#${appId}`);

    await expect(sheet.locator('input[name="system.other.stress.value"]')).toHaveValue('5');
    await expect(sheet.locator('input[name="system.other.stress.min"]')).toHaveValue('2');

    // rollPanic() with no advantage asks for it first, so this opens a dialog naming the table, not a chat message.
    await sheet.locator('label[for="system.other.stress.value"]').click();
    await expect(gmPage.locator('dialog[open].macro-popup-dialog')).toContainText('Panic Check');
  });

  // Foundry sizes a textarea and pads an input differently inside .window-app than .application;
  // an .application sheet never saw either rule.
  test('the trauma box fills its column and a two-digit bonus fits its pill', async ({ gmPage }) => {
    const { appId } = await open(gmPage, { stats: { combat: { mod: 10 } } });
    const sheet = gmPage.locator(`#${appId}`);

    const trauma = sheet.locator('textarea[name="system.other.stressdesc.value"]');
    const spans = await trauma.evaluate((node) => {
      const cell = node.parentElement!.getBoundingClientRect().width;
      return node.getBoundingClientRect().width >= cell;
    });
    expect(spans).toBe(true);

    // Measured open, not closed: StatModifier is a 16px dot at rest that says everything with its
    // fill, and grows to 40px when aimed at. Open is where the digits have to fit.
    const modifier = sheet.locator('input[name="system.stats.combat.mod"]');
    await modifier.focus();
    await expect
      .poll(() => modifier.evaluate((node: HTMLInputElement) => node.scrollWidth > node.clientWidth))
      .toBe(false);
  });

  // ArmorBlock's numbers are derived, so equipping armour has to move them without a reload.
  test('the armour readout follows equipped armour', async ({ gmPage }) => {
    const { appId, uuid } = await open(gmPage);
    const id = await addItem(gmPage, uuid, {
      name: '__e2e_vac',
      type: 'armor',
      system: { armorPoints: 3, damageReduction: 1, equipped: false },
    });
    const armour = gmPage
      .locator(`#${appId} .resource`)
      .filter({ has: gmPage.locator('.resource-label', { hasText: 'Armor' }) });

    await expect(armour.locator('.whiteText').first()).toHaveText('0');

    await gmPage.locator(`#${appId} a.tab-select[data-tab="armor"]`).click();
    await gmPage.locator(`#${appId} li.item[data-item-id="${id}"] input[type="checkbox"]`).check();

    await expect(armour.locator('.whiteText').first()).toHaveText('3');
    await expect(armour.locator('.whiteText').nth(1)).toHaveText('1');
  });

  test('opens on the skills tab and switches', async ({ gmPage }) => {
    const { appId } = await open(gmPage);
    const sheet = gmPage.locator(`#${appId}`);

    await expect(sheet.locator('.tab[data-tab="skills"]')).toBeVisible();
    await sheet.locator('a.tab-select[data-tab="weapons"]').click();
    await expect(sheet.locator('.tab[data-tab="weapons"]')).toBeVisible();
    await expect(sheet.locator('.tab[data-tab="skills"]')).toHaveCount(0);
  });

  test('the notes tab shows bio and notes together', async ({ gmPage }) => {
    const { appId } = await open(gmPage, {
      notes: '<p>owes the company money</p>',
      biography: '<p>born on Prospero</p>',
    });
    const sheet = gmPage.locator(`#${appId}`);

    await sheet.locator('a.tab-select[data-tab="notes"]').click();
    await expect(sheet.locator('.tab[data-tab="notes"]')).toContainText('owes the company money');
    await expect(sheet.locator('.tab[data-tab="notes"]')).toContainText('born on Prospero');
  });

  test('a condition shows its treatment pips and steps them', async ({ gmPage }) => {
    const { appId, uuid } = await open(gmPage);
    const id = await addItem(gmPage, uuid, {
      name: '__e2e_frightened',
      type: 'condition',
      system: { severity: 2, treatment: { value: 1 } },
    });
    await gmPage.locator(`#${appId} a.tab-select[data-tab="conditions"]`).click();
    const row = gmPage.locator(`#${appId} li.item[data-item-id="${id}"]`);

    await expect(row.locator('i.fas.fa-circle')).toHaveCount(1);
    await expect(row.locator('i.far.fa-circle')).toHaveCount(2);

    await row.locator('.list-roll.flex').click();
    await expect.poll(() => itemField(gmPage, uuid, id, 'system.treatment.value')).toBe(2);
    await expect(row.locator('i.fas.fa-circle')).toHaveCount(2);
  });

  test('a weapon spends a shot and reloads', async ({ gmPage }) => {
    const { appId, uuid } = await open(gmPage);
    const id = await addItem(gmPage, uuid, {
      name: '__e2e_smg',
      type: 'weapon',
      system: { damage: '2d10', useAmmo: true, ammo: 4, shots: 6, curShots: 2, range: 'close' },
    });
    const sheet = gmPage.locator(`#${appId}`);

    await sheet.locator('a.tab-select[data-tab="weapons"]').click();
    const row = sheet.locator(`li.item[data-item-id="${id}"]`);
    await expect(row).toContainText('Close');

    await row.locator('a.list-roll').first().click();
    await expect.poll(() => itemField(gmPage, uuid, id, 'system.curShots')).toBe(3);
    await expect.poll(() => itemField(gmPage, uuid, id, 'system.ammo')).toBe(3);

    await row.locator('a.list-roll').last().click();
    await expect.poll(() => itemField(gmPage, uuid, id, 'system.curShots')).toBe(6);
  });

  test('the carrying-capacity footer reports derived weight', async ({ gmPage }) => {
    await setHideWeight(gmPage, false);
    try {
      const { appId, uuid } = await open(gmPage, { stats: { strength: { value: 45 } } });
      await addItem(gmPage, uuid, {
        name: '__e2e_ration',
        type: 'item',
        system: { quantity: 3, weight: 2 },
      });
      const sheet = gmPage.locator(`#${appId}`);

      await sheet.locator('a.tab-select[data-tab="items"]').click();
      const footer = sheet.locator('.tab[data-tab="items"] .item.flex-group-left');
      await expect(footer).toContainText('5');
      await expect(footer).toContainText('6');

      // Nothing is stored: the field is gone from the schema, so a write would be discarded.
      expect(await stored(gmPage, uuid, 'system.weight')).toBeUndefined();
    } finally {
      await setHideWeight(gmPage, true);
    }
  });

  test('the weight column and footer disappear when the setting hides them', async ({ gmPage }) => {
    const { appId, uuid } = await open(gmPage);
    await addItem(gmPage, uuid, { name: '__e2e_ration', type: 'item', system: { quantity: 1, weight: 2 } });
    const sheet = gmPage.locator(`#${appId}`);

    await sheet.locator('a.tab-select[data-tab="items"]').click();
    await expect(sheet.locator('.tab[data-tab="items"] .item.flex-group-left')).toHaveCount(0);
  });

  test('a panel adds a pack document through the picker, and deletes it', async ({ gmPage }) => {
    const { appId, uuid } = await open(gmPage);
    const sheet = gmPage.locator(`#${appId}`);

    await sheet.locator('a.tab-select[data-tab="weapons"]').click();
    await sheet.locator('.item-header a.item-control').click();

    const picker = gmPage.locator('.macro-popup-dialog');
    await picker.locator('#choice-filter').fill('revolver');
    await picker.getByRole('radio').check();
    await picker.locator('button[data-action="add"]').click();

    await expect(sheet.locator('li.item[data-item-id]')).toHaveCount(1);
    await expect.poll(() =>
      gmPage.evaluate(
        async (u: string) =>
          (await (window as any).fromUuid(u)).items.map((i: any) => [i.type, i.name]),
        uuid,
      ),
    ).toEqual([['weapon', 'Revolver']]);

    await sheet.locator('li.item[data-item-id] a.item-control').last().click();
    await expect(sheet.locator('li.item[data-item-id]')).toHaveCount(0);
  });

  test('the skill picker resolves prerequisites from the pack, and the toggle lifts them', async ({
    gmPage,
  }) => {
    const { appId, uuid } = await open(gmPage);
    const sheet = gmPage.locator(`#${appId}`);
    await addItem(gmPage, uuid, { name: 'Zero-G', type: 'skill' });

    await sheet.locator('.item-header a.item-control').first().click();
    const picker = gmPage.locator('.macro-popup-dialog');

    // PSG 22: Piloting is unlocked by Zero-G, which this character owns.
    await picker.locator('#choice-filter').fill('piloting');
    await expect(picker.getByRole('radio')).toBeEnabled();

    await picker.locator('#choice-filter').fill('sophontology');
    await expect(picker.getByRole('radio')).toBeDisabled();

    await picker.locator('#pick-enforce').uncheck();
    await expect(picker.getByRole('radio')).toBeEnabled();
    await picker.getByRole('radio').check();
    await picker.locator('button[data-action="add"]').click();

    await expect.poll(() =>
      gmPage.evaluate(
        async (u: string) =>
          (await (window as any).fromUuid(u)).items.map((i: any) => [i.type, i.name]),
        uuid,
      ),
    ).toEqual([
      ['skill', 'Zero-G'],
      ['skill', 'Sophontology'],
    ]);
  });

  test('cancelling the picker adds nothing', async ({ gmPage }) => {
    const { appId, uuid } = await open(gmPage);
    const sheet = gmPage.locator(`#${appId}`);

    await sheet.locator('a.tab-select[data-tab="weapons"]').click();
    await sheet.locator('.item-header a.item-control').click();

    const picker = gmPage.locator('.macro-popup-dialog');
    await picker.getByRole('radio').first().check();
    await picker.locator('button[data-action="cancel"]').click();

    await expect(picker).toHaveCount(0);
    await expect(sheet.locator('li.item[data-item-id]')).toHaveCount(0);
    await expect.poll(() =>
      gmPage.evaluate(
        async (u: string) => (await (window as any).fromUuid(u)).items.size,
        uuid,
      ),
    ).toBe(0);
  });

  // Create is a body control, not a footer button: a footer button would answer the picker, and
  // the form has to open over a picker that is still standing until the draft is written.
  test('the picker opens a new-weapon form, and Save to World files it without arming the actor', async ({
    gmPage,
  }) => {
    const clearWorld = () =>
      gmPage.evaluate(async () => {
        const g = (window as any).game;
        const ids = g.items
          .filter((i: any) => i.name.startsWith('New ') || i.name.startsWith('__e2e_'))
          .map((i: any) => i.id);
        if (ids.length) await g.items.documentClass.deleteDocuments(ids);
      });

    await clearWorld();
    const { appId, uuid } = await open(gmPage);
    const sheet = gmPage.locator(`#${appId}`);

    await sheet.locator('a.tab-select[data-tab="weapons"]').click();
    await sheet.locator('.item-header a.item-control').click();

    const picker = gmPage.locator('.macro-popup-dialog').first();
    await expect(picker.locator('.choice-group')).toHaveCount(0);

    await picker.locator('#pick-create').click();

    const form = gmPage.locator('.macro-popup-dialog').nth(1);
    await expect(form.locator('input[name="name"]')).toHaveValue('New Weapon');

    // Nothing is written until a button is pressed — Cancel leaves the world as it found it.
    await form.locator('button[data-action="cancel"]').click();
    expect(
      await gmPage.evaluate(() =>
        (window as any).game.items.filter((i: any) => i.name === 'New Weapon').length,
      ),
    ).toBe(0);
    await expect(picker).toBeVisible();

    await picker.locator('#pick-create').click();
    const second = gmPage.locator('.macro-popup-dialog').nth(1);
    await second.locator('input[name="name"]').fill('__e2e_Bolt Thrower');
    await second.locator('input[name="system.damage"]').fill('2d10');
    await second.locator('button[data-action="world"]').click();

    // Save to World writes the document and takes the picker down; the actor gains nothing.
    await expect(picker).toBeHidden();
    await expect
      .poll(() =>
        gmPage.evaluate(() =>
          (window as any).game.items
            .filter((i: any) => i.name === '__e2e_Bolt Thrower')
            .map((i: any) => [i.type, i.system.damage]),
        ),
      )
      .toEqual([['weapon', '2d10']]);
    expect(
      await gmPage.evaluate(
        async (u: string) => (await (window as any).fromUuid(u)).items.size,
        uuid,
      ),
    ).toBe(0);

    await clearWorld();
  });

  test('Add to Character files the draft in the world and arms the actor with a copy', async ({
    gmPage,
  }) => {
    const clearWorld = () =>
      gmPage.evaluate(async () => {
        const g = (window as any).game;
        const ids = g.items
          .filter((i: any) => i.name.startsWith('New ') || i.name.startsWith('__e2e_'))
          .map((i: any) => i.id);
        if (ids.length) await g.items.documentClass.deleteDocuments(ids);
      });

    await clearWorld();
    const { appId, uuid } = await open(gmPage);
    const sheet = gmPage.locator(`#${appId}`);

    await sheet.locator('a.tab-select[data-tab="weapons"]').click();
    await sheet.locator('.item-header a.item-control').click();

    const picker = gmPage.locator('.macro-popup-dialog').first();
    await picker.locator('#pick-create').click();

    const form = gmPage.locator('.macro-popup-dialog').nth(1);
    await form.locator('input[name="name"]').fill('__e2e_Rivet Gun');
    await form.locator('button[data-action="add"]').click();

    await expect(picker).toBeHidden();
    await expect
      .poll(() =>
        gmPage.evaluate(
          async (u: string) =>
            (await (window as any).fromUuid(u)).items.map((i: any) => [i.type, i.name]),
          uuid,
        ),
      )
      .toEqual([['weapon', '__e2e_Rivet Gun']]);
    expect(
      await gmPage.evaluate(() =>
        (window as any).game.items.filter((i: any) => i.name === '__e2e_Rivet Gun').length,
      ),
    ).toBe(1);

    await clearWorld();
  });

  test('a row added while the sheet is open is draggable', async ({ gmPage }) => {
    const { appId, uuid } = await open(gmPage);
    const id = await addItem(gmPage, uuid, { name: '__e2e_zerog', type: 'skill' });
    await expect(gmPage.locator(`#${appId} li.item[data-item-id="${id}"]`)).toBeVisible();

    const payload = await gmPage.evaluate(
      ({ a, i }: { a: string; i: string }) => {
        const row = document.querySelector(`#${a} li.item[data-item-id="${i}"]`)!;
        const dataTransfer = new DataTransfer();
        row.dispatchEvent(
          new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }),
        );
        return dataTransfer.getData('text/plain');
      },
      { a: appId, i: id },
    );

    expect(JSON.parse(payload || '{}')).toMatchObject({ type: 'Item' });
  });

  test('a dropped item is added to the character', async ({ gmPage }) => {
    const { appId, uuid } = await open(gmPage);
    const weapon = await gmPage.evaluate(async () => {
      const doc = await (window as any).Item.create({ name: '__e2e_smg', type: 'weapon' });
      return doc.uuid as string;
    });

    await gmPage.evaluate(
      async ({ sel, u }: { sel: string; u: string }) => {
        const dropped = await (window as any).fromUuid(u);
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', JSON.stringify(dropped.toDragData()));
        document
          .querySelector(sel)!
          .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
      },
      { sel: `#${appId}`, u: weapon },
    );

    await expect
      .poll(() =>
        gmPage.evaluate(
          async (u: string) => (await (window as any).fromUuid(u)).items.map((i: any) => i.name),
          uuid,
        ),
      )
      .toEqual(['__e2e_smg']);
  });

  // Sanity, Fear and Body are d100 roll-unders like the four stats, and are now drawn by the same
  // control. This replaces a spec that measured the bespoke save row's caption against its value
  // box; that row, and the four classes it needed, are gone.
  test('a save is the same control as a stat', async ({ gmPage }) => {
    const { appId } = await open(gmPage, { stats: { sanity: { value: 21, mod: 0 } } });

    const shape = await gmPage.evaluate((id: string) => {
      const app = document.getElementById(id)!;
      const read = (rail: string) =>
        [...app.querySelectorAll(`${rail} .mainstatwrapper`)].map((row) => ({
          label: row.querySelector('.mainstattext')!.textContent!.trim(),
          rolls: row.querySelector('.mainstattext.rollable') !== null,
          circle: Math.round(row.querySelector('.circle-input')!.getBoundingClientRect().width),
          modifier: row.querySelector('.stat-modifier') !== null,
        }));
      return { stats: read('.abilities'), saves: read('.saves') };
    }, appId);

    expect(shape.saves.map((s) => s.label)).toEqual(['Sanity', 'Fear', 'Body']);
    expect(shape.saves.every((s) => s.rolls && s.modifier)).toBe(true);
    expect(new Set(shape.saves.map((s) => s.circle))).toEqual(
      new Set(shape.stats.map((s) => s.circle)),
    );
  });

  // Every document in the book carries the same placeholder art, so the frame around it read as a
  // control that did nothing. The disclosure took the column instead.
  test('no list has an art column, and the header lines up with its rows', async ({ gmPage }) => {
    const { appId, uuid } = await open(gmPage);
    await addItem(gmPage, uuid, {
      name: '__e2e_linguistics',
      type: 'skill',
      img: 'icons/svg/book.svg',
      system: { rank: 'Trained', bonus: 10 },
    });
    const sheet = gmPage.locator(`#${appId}`);
    await sheet.locator('a.tab-select[data-tab="skills"]').click();

    const skills = sheet.locator('.tab[data-tab="skills"]');
    await expect(skills.locator('.item-image')).toHaveCount(0);
    await expect(skills.locator('.items-list li .item-disclosure')).toHaveCount(2);
    const [header, row] = await skills.locator('.items-list li').evaluateAll((rows) =>
      rows.slice(0, 2).map((entry) => entry.firstElementChild!.getBoundingClientRect().left),
    );
    expect(row).toBeCloseTo(header, 0);
  });

  test('an item opens its description under its row instead of posting it', async ({ gmPage }) => {
    const { appId, uuid } = await open(gmPage);
    const id = await addItem(gmPage, uuid, {
      name: '__e2e_defibrillator',
      type: 'item',
      system: { quantity: 1, cost: 0, description: '<p>Restarts a stopped heart. Once.</p>' },
    });
    const sheet = gmPage.locator(`#${appId}`);
    await sheet.locator('a.tab-select[data-tab="items"]').click();

    const row = sheet.locator(`li.item[data-item-id="${id}"]`);
    const before = await gmPage.evaluate(() => (window as any).game.messages.size as number);

    await expect(sheet.locator('.item-description')).toHaveCount(0);
    await row.locator('.item-disclosure a').click();
    await expect(sheet.locator('.item-description')).toContainText('Restarts a stopped heart');

    // The name opens it too — that click used to print the description to chat.
    await row.locator('.skill-name').click();
    await expect(sheet.locator('.item-description')).toHaveCount(0);

    expect(await gmPage.evaluate(() => (window as any).game.messages.size as number)).toBe(before);
  });

  test('an item with no description offers no chevron', async ({ gmPage }) => {
    const { appId, uuid } = await open(gmPage);
    const id = await addItem(gmPage, uuid, {
      name: '__e2e_flashlight',
      type: 'item',
      system: { quantity: 1, cost: 30 },
    });
    const sheet = gmPage.locator(`#${appId}`);
    await sheet.locator('a.tab-select[data-tab="items"]').click();

    await expect(sheet.locator(`li.item[data-item-id="${id}"] .item-disclosure a`)).toHaveCount(0);
  });

  test('a hovered roll control turns its die over', async ({ gmPage }) => {
    const { appId } = await open(gmPage);
    const sheet = gmPage.locator(`#${appId}`);
    const die = sheet.locator('.mainstat .roll-die').first();

    expect(await die.evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.transitionProperty, style.transitionDuration, style.transitionTimingFunction];
    })).toEqual(['transform', '0.5s', 'ease-in-out']);

    const turn = () => die.evaluate((el) => getComputedStyle(el).transform);
    expect(await turn()).toBe('none');
    await sheet.locator('.mainstat .mainstattext').first().hover();
    await expect.poll(turn).not.toBe('none');
  });

  test('the header control opens the creation wizard', async ({ gmPage }) => {
    const { appId } = await open(gmPage);
    const sheet = gmPage.locator(`#${appId}`);

    await sheet.locator('.header-control[data-action="toggleControls"]').click();
    await gmPage.locator('.context-item', { hasText: 'Character Creation Wizard' }).click();

    // The window id is still the generator's — only the control's label changed when the page became a wizard.
    await expect(gmPage.locator('.application[id^="mothership-generator-"]')).toBeVisible();
  });
});
