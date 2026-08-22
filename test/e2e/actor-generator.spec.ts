import { type Page } from '@playwright/test';
import { test, expect } from './fixtures/foundry-clients.ts';

// Foundry rolls ceil((1 - randomUniform()) * faces); a value just under 1 pins every die to 1,
// and every table to row 0.
const LOWEST_FACE = 0.9999;

/** `gmPage` is worker-scoped: thaw must restore `CONFIG.Dice.randomUniform`, not delete it, or later tests throw. */
const freezeDice = (page: Page, value: number) =>
  page.evaluate((v: number) => {
    const dice = (window as any).CONFIG.Dice;
    (window as any).__randomUniform ??= dice.randomUniform;
    dice.randomUniform = () => v;
  }, value);

const thawDice = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    if (w.__randomUniform) w.CONFIG.Dice.randomUniform = w.__randomUniform;
  });

const closeEverything = (page: Page) =>
  page.evaluate(async () => {
    const w = window as any;
    for (const app of w.foundry.applications.instances.values()) await app.close?.();
    for (const app of Object.values(w.ui.windows ?? {}) as any[]) await app.close?.();
  });

const openGenerator = async (
  page: Page,
  system: Record<string, unknown> = {},
  { fromCreation = false } = {},
) => {
  // Close other sheets first — the header button is found by selector, and a leftover sheet has one too.
  await closeEverything(page);
  const uuid = await page.evaluate(async ({ s, renderSheet }) => {
    const actor = await (window as any).Actor.create(
      { name: '__e2e_recruit', type: 'character', system: s },
      { renderSheet },
    );
    return actor.uuid as string;
  }, { s: system, renderSheet: fromCreation });
  if (fromCreation) {
    await page.click('dialog[open] button[data-action="wizard"]');
  } else {
    // The real entry is a header-menu control, not a title-bar button; calling the method directly
    // skips it (menu wiring covered by character-sheet.spec.ts).
    await page.evaluate(async (u: string) => {
      const actor = await (window as any).fromUuid(u);
      await actor.sheet.render(true);
      actor.sheet.generateCharacter();
    }, uuid);
  }
  await expect(page.locator('form.character-wizard')).toHaveCount(1);
  return uuid;
};

const goTo = async (page: Page, pane: string) => {
  await page.click(`button.wizard-rail-step[data-pane="${pane}"]`);
  await expect(page.locator(`section.wizard-pane[data-pane="${pane}"]`)).toHaveCount(1);
};

const rollStatsAndSaves = async (page: Page) => {
  for (const pane of ['stats', 'saves']) {
    await goTo(page, pane);
    // The bulk roller retires once its pane's last die is in, so a second call finds nothing.
    const bulk = page.locator('button[data-roll="all"]');
    if (await bulk.count()) await bulk.click();
  }
};

const chooseClass = async (page: Page, name: string) => {
  if (await page.locator('button.wizard-rail-step[data-pane="class"]').isDisabled()) {
    await rollStatsAndSaves(page);
  }
  await goTo(page, 'class');
  await page.click(`button.wizard-class[data-class="${name}"]`);
};

const takeSkillBonus = async (page: Page, position: number) => {
  await goTo(page, 'adjustments');
  await page.click(`button.wizard-package >> nth=${position}`);
};

const reachSkills = async (page: Page) => {
  if (await page.locator('button.wizard-rail-step[data-pane="skills"]').isDisabled()) {
    await goTo(page, 'health');
    await page.click('img[data-roll="health"]');
  }
  await goTo(page, 'skills');
};

/** Picking a skill can reveal new available skills, so this loops rather than walking a fixed slot list. */
const pickEverySkill = async (page: Page) => {
  await reachSkills(page);
  while (await page.locator('[data-skill][data-state="available"]').count() > 0) {
    await page.click('[data-skill][data-state="available"] >> nth=0');
  }
};

const closeWizard = (page: Page) =>
  page.evaluate(async () => {
    const w = window as any;
    for (const app of w.foundry.applications.instances.values()) {
      if (String(app.id).startsWith('mothership-generator-')) await app.close();
    }
  });

const stored = (page: Page, uuid: string, path: string): Promise<any> =>
  page.evaluate(
    async ({ u, p }: { u: string; p: string }) =>
      (window as any).foundry.utils.getProperty((await (window as any).fromUuid(u)).toObject(), p),
    { u: uuid, p: path },
  );

const items = (page: Page, uuid: string): Promise<{ name: string; type: string; quantity: number }[]> =>
  page.evaluate(async (u: string) => {
    const actor = await (window as any).fromUuid(u);
    return actor.items.map((i: any) => ({
      name: i.name,
      type: i.type,
      quantity: i.system.quantity ?? 1,
    }));
  }, uuid);

test.describe('character generator', () => {
  test.afterEach(async ({ gmPage }) => {
    await thawDice(gmPage);
    await closeEverything(gmPage);
    await gmPage.evaluate(async () => {
      const g = (window as any).game;
      const ids = g.actors.filter((a: any) => a.name.startsWith('__e2e_')).map((a: any) => a.id);
      if (ids.length) await g.actors.documentClass.deleteDocuments(ids);
    });
  });

  test('a new character is offered the wizard, and taking it opens the window', async ({ gmPage }) => {
    await closeEverything(gmPage);
    await gmPage.evaluate(() => {
      void (window as any).Actor.implementation.createDialog({ name: '__e2e_offered', type: 'character' });
    });
    await gmPage.click('dialog[open] button[data-action="ok"]');

    await expect(gmPage.locator('.application.character')).toHaveCount(0);
    await gmPage.click('dialog[open] button[data-action="wizard"]');
    await expect(gmPage.locator('form.character-wizard')).toHaveCount(1);
    await expect(gmPage.locator('.application.character:not(:has(form.character-wizard))')).toHaveCount(0);
    // Intro pane shows only the book's first two front-matter paragraphs beside the cover, not the third (procedural) one.
    const intro = gmPage.locator('section.wizard-pane[data-pane="intro"]');
    await expect(intro).toHaveCount(1);
    await expect(intro.locator('.wizard-intro .wizard-prose p')).toHaveCount(2);
    const cover = intro.locator('.wizard-intro-cover');
    await expect(cover).toHaveAttribute(
      'src',
      '/systems/mothershiprpg/images/mothership-cover.webp',
    );
    await expect.poll(() => cover.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    const composition = await intro.locator('.wizard-intro').evaluate((element) => {
      const text = element.querySelector('.wizard-prose')!.getBoundingClientRect();
      const image = element.querySelector('.wizard-intro-cover')!.getBoundingClientRect();
      const frame = element.getBoundingClientRect();
      const pane = element.closest('.wizard-pane')!.getBoundingClientRect();
      return {
        position: getComputedStyle(element.querySelector('.wizard-intro-cover')!).position,
        bottomGap: Math.abs(frame.bottom - image.bottom),
        paneBottomGap: Math.abs(pane.bottom - image.bottom),
        overlaps: text.right > image.left,
      };
    });
    expect(composition.position).toBe('absolute');
    expect(composition.bottomGap).toBeLessThan(1);
    expect(composition.paneBottomGap).toBeLessThan(1);
    expect(composition.overlaps).toBe(true);
  });

  test('blank characters render on request, while creatures bypass the choice', async ({ gmPage }) => {
    await closeEverything(gmPage);
    await gmPage.evaluate(() => {
      void (window as any).Actor.implementation.createDialog({ name: '__e2e_blank', type: 'character' });
    });
    await gmPage.click('dialog[open] button[data-action="ok"]');
    await expect(gmPage.locator('.application.character')).toHaveCount(0);
    await gmPage.click('dialog[open] button[data-action="blank"]');
    await expect(gmPage.locator('.application.character')).toHaveCount(1);

    await closeEverything(gmPage);
    await gmPage.evaluate(() => {
      void (window as any).Actor.implementation.createDialog({ name: '__e2e_creature', type: 'creature' });
    });
    await gmPage.click('dialog[open] button[data-action="ok"]');
    await expect(gmPage.locator('.application.creature')).toHaveCount(1);
    await expect(gmPage.locator('dialog[open] button[data-action="wizard"]')).toHaveCount(0);
  });

  test('the rail walks the book, and step 3 lists the shipped classes', async ({ gmPage }) => {
    await openGenerator(gmPage);

    const rail = await gmPage.$$eval('button.wizard-rail-step', (nodes) =>
      nodes.map((n) => (n as HTMLElement).dataset.pane),
    );
    // Steps 5-6 ask the player nothing (Stress starts at 2, Trauma Response is fixed by class), so
    // the wizard skips panes for them; step 3 asks two things, so it's two panes.
    expect(rail).toEqual([
      'intro', 'stats', 'saves', 'class', 'adjustments', 'health', 'skills', 'gear', 'finish',
    ]);

    await freezeDice(gmPage, LOWEST_FACE);
    await rollStatsAndSaves(gmPage);
    await goTo(gmPage, 'class');
    const options = await gmPage.$$eval('button.wizard-class .wizard-class-name', (nodes) =>
      nodes.map((n) => n.textContent),
    );
    expect(options.sort()).toEqual(['Android', 'Marine', 'Scientist', 'Teamster']);

    const icons = await gmPage.$$eval('button.wizard-class', (nodes) =>
      Object.fromEntries(nodes.map((node) => [
        (node as HTMLElement).dataset.class,
        node.querySelector('img')?.getAttribute('src'),
      ])),
    );
    expect(icons).toEqual({
      Android: '/systems/mothershiprpg/images/class_icons/android.png',
      Marine: '/systems/mothershiprpg/images/class_icons/marine.png',
      Scientist: '/systems/mothershiprpg/images/class_icons/scientist.png',
      Teamster: '/systems/mothershiprpg/images/class_icons/teamster.png',
    });
    const columns = await gmPage.locator('.wizard-classes').evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(' '),
    );
    expect(columns).toHaveLength(4);
    await expect(gmPage.locator('.wizard-class-brings, .wizard-class-source')).toHaveCount(0);
    await expect(gmPage.locator('section.wizard-pane[data-pane="class"] .wizard-instruction')).toHaveCount(0);
    await expect(gmPage.locator('section.wizard-pane[data-pane="class"] .wizard-prose')).toHaveCount(0);
    await expect(gmPage.locator('[data-class-detail]')).toHaveCount(0);

    await gmPage.click('button.wizard-class[data-class="Android"]');
    const androidDetail = gmPage.locator('[data-class-detail="Android"]');
    await expect(androidDetail.locator('[data-class-description]')).toHaveText(
      'Androids are a terrifying and exciting addition to any crew. They tend to unnerve other crewmembers with their cold inhumanity.',
    );
    const labelTypography = await androidDetail.locator('dt').first().evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        fontSize: Number.parseFloat(style.fontSize),
        textShadow: style.textShadow,
        textTransform: style.textTransform,
      };
    });
    expect(labelTypography.fontSize).toBeGreaterThan(12);
    expect(labelTypography.textShadow).toBe('none');
    expect(labelTypography.textTransform).toBe('none');
    await goTo(gmPage, 'adjustments');
    const adjustments = gmPage.locator('section.wizard-pane[data-pane="adjustments"]');
    await expect(adjustments.locator('h2')).toHaveText('Android Adjustments');
    await expect(adjustments.locator('.wizard-pane-art')).toHaveAttribute(
      'src',
      '/systems/mothershiprpg/images/class_icons/android.png',
    );

    await goTo(gmPage, 'class');
    await gmPage.click('button.wizard-class[data-class="Marine"]');
    const detail = gmPage.locator('[data-class-detail="Marine"]');
    await expect(detail).toHaveCount(1);
    await expect(detail.locator('[data-bonus="combat"]')).toHaveText('+10');
    await expect(detail.locator('[data-value="trauma"]')).not.toBeEmpty();

    // The book's class card prints granted skills alongside adjustments, so this pane does too.
    await expect(detail.locator('[data-skills="granted"]')).toHaveText('Military Training, Athletics');
    await expect(detail.locator('[data-skills="group"]')).toHaveText('1 Expert Skill or 2 Trained Skills');

    // The book's card collapses a class that moves everything by one amount, so the pane does too.
    await gmPage.click('button.wizard-class[data-class="Teamster"]');
    const teamster = gmPage.locator('[data-class-detail="Teamster"]');
    await expect(teamster.locator('[data-bonus="all_stats"]')).toHaveText('+5');
    await expect(teamster.locator('[data-bonus="all_saves"]')).toHaveText('+10');
    await expect(teamster.locator('[data-bonus="strength"]')).toHaveCount(0);

    // The Scientist grants no skills outright — its whole benefit is the qualified pick, so the pane must spell that out.
    await gmPage.click('button.wizard-class[data-class="Scientist"]');
    const scientist = gmPage.locator('[data-class-detail="Scientist"]');
    await expect(scientist.locator('[data-skills="granted"]')).toHaveCount(0);
    await expect(scientist.locator('[data-skills="pick"]')).toHaveText([
      '1 Master Skill, and an Expert and Trained Skill prerequisite',
      '1 Trained Skill',
    ]);
  });

  test('each pane gates forward navigation until its task is complete', async ({ gmPage }) => {
    await openGenerator(gmPage);

    await goTo(gmPage, 'stats');
    await expect(gmPage.locator('button[data-action="next"]')).toBeDisabled();
    await expect(gmPage.locator('button.wizard-rail-step[data-pane="saves"]')).toBeDisabled();

    await freezeDice(gmPage, LOWEST_FACE);
    await gmPage.click('button[data-roll="all"]');
    await expect(gmPage.locator('button[data-action="next"]')).toBeEnabled();
    await expect(gmPage.locator('button.wizard-rail-step[data-pane="saves"]')).toBeEnabled();

    await goTo(gmPage, 'saves');
    await expect(gmPage.locator('button[data-action="next"]')).toBeDisabled();
    await gmPage.click('button[data-roll="all"]');
    await expect(gmPage.locator('button[data-action="next"]')).toBeEnabled();

    await chooseClass(gmPage, 'Teamster');

    // The Teamster leaves no adjustment to place, so that pane is already complete and opens no dialog.
    await expect(gmPage.locator('dialog[open]')).toHaveCount(0);
    await expect(gmPage.locator('button.wizard-rail-step[data-pane="health"]')).toBeEnabled();
    await goTo(gmPage, 'health');
    await expect(gmPage.locator('button[data-action="next"]')).toBeDisabled();
    await gmPage.click('img[data-roll="health"]');
    await expect(gmPage.locator('button[data-action="next"]')).toBeEnabled();
  });

  test('generates a Marine, whose three-item loadout row arrives with an unlisted Unarmed', async ({ gmPage }) => {
    // Stress starts pre-drifted here so the test can tell whether the generator writes it or leaves the schema default.
    const uuid = await openGenerator(
      gmPage,
      { other: { stress: { value: 9, min: 4 } } },
      { fromCreation: true },
    );
    // Row 0 of the Marine loadouts is "Tank Top and Camo Pants, Combat Knife, Stimpak".
    await freezeDice(gmPage, LOWEST_FACE);

    await chooseClass(gmPage, 'Marine');

    // The Marine's bonus skills are a choice of two packages, taken with the class's other benefits;
    // the rail blocks skills until it's answered.
    await expect(gmPage.locator('button.wizard-rail-step[data-pane="skills"]')).toBeDisabled();
    await takeSkillBonus(gmPage, 1);
    await expect(gmPage.locator('section.wizard-pane[data-pane="adjustments"] button.wizard-package')).toHaveCount(2);

    await reachSkills(gmPage);
    await expect(gmPage.locator('section.wizard-pane[data-pane="skills"] button.wizard-package')).toHaveCount(0);

    const picker = gmPage.locator('.skill-selector');
    const trainedColumn = picker.locator('.skill-selector-column[data-rank="Trained"]');
    await expect(trainedColumn.locator('[data-state="granted"]')).not.toHaveCount(0);
    await expect(trainedColumn.locator('[data-state="available"]')).not.toHaveCount(0);
    // Trained has no prerequisites, so every unowned skill in that column is available.
    await expect(trainedColumn.locator('[data-state="unavailable"]')).toHaveCount(0);
    await expect(picker.locator('svg')).toHaveCount(0);

    // The description travels with the row rather than sitting in a header the list scrolls away
    // from: hovering one opens the card, which names what it needs and what it opens.
    const hovered = trainedColumn.locator('[data-state="available"]').first();
    await hovered.hover();
    const detail = gmPage.locator('.skill-selector-card.is-open');
    await expect(detail).toBeVisible();
    await expect(detail).not.toContainText(await hovered.locator('.skill-selector-name').innerText());
    await expect(detail.locator('.skill-selector-chip')).not.toHaveCount(0);

    // The whole catalog stands in three columns at once, not one slot opened at a time.
    const columnCount = await picker.locator('.skill-selector-columns').evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
    );
    expect(columnCount).toBe(3);

    // Checks WCAG AA contrast; color isn't the only signal, as shape/border/symbols also distinguish states.
    const contrast = await picker.locator('[data-skill]').evaluateAll((nodes) => {
      const channel = (value: number) => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (color: string) => {
        const [red, green, blue] = color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
      };
      return nodes.map((node) => {
        const style = getComputedStyle(node);
        const light = Math.max(luminance(style.color), luminance(style.backgroundColor));
        const dark = Math.min(luminance(style.color), luminance(style.backgroundColor));
        return (light + 0.05) / (dark + 0.05);
      });
    });
    expect(Math.min(...contrast)).toBeGreaterThanOrEqual(4.5);

    await pickEverySkill(gmPage);
    await expect(gmPage.locator('ul[data-list="skills"] li')).toHaveCount(4);

    // Locked rows report disabled, so `force` is needed to click them at all; the click must still
    // do nothing and leave no focus ring on a skill never taken.
    await expect(trainedColumn.locator('.skill-selector-bonus.is-spent')).toHaveCount(1);
    const locked = trainedColumn.locator('[data-state="unavailable"][data-reason="spent"]').first();
    await locked.click({ force: true });
    await expect(locked).not.toBeFocused();
    await expect(gmPage.locator('ul[data-list="skills"] li')).toHaveCount(4);

    await expect(gmPage.locator('dialog[open]')).toHaveCount(0);

    await rollStatsAndSaves(gmPage);
    await goTo(gmPage, 'health');
    await expect(gmPage.locator('input[data-value="wounds"]')).toHaveValue('3');

    await goTo(gmPage, 'gear');
    await gmPage.click('button[data-roll="all"]');
    await expect(gmPage.locator('input[data-value="loadout"]')).toHaveValue('0');
    // The row's three items and nothing else: Unarmed is granted at the finish, not drawn, so no
    // list prints it back as if the table had rolled it.
    await expect(gmPage.locator('ul[data-list="loadout"] li')).toHaveText([
      /Tank Top and Camo Pants/, /Combat Knife/, /Stimpak/,
    ]);

    await goTo(gmPage, 'finish');
    await gmPage.fill('form.character-wizard input[name="name"]', '');
    await expect(gmPage.locator('button[data-action="save"]')).toBeDisabled();
    await gmPage.fill('form.character-wizard input[name="name"]', '__e2e_recruit');
    await expect(gmPage.locator('button[data-action="save"]')).toBeEnabled();
    await gmPage.fill('form.character-wizard input[name="pronouns"]', 'they/them');
    await gmPage.click('button[data-action="save"]');
    await gmPage.waitForSelector('form.character-wizard', { state: 'detached' });
    await expect(gmPage.locator('.application.character')).toHaveCount(1);

    // Marine: +10 COMBAT, +10 BODY SAVE, +20 FEAR SAVE, +1 MAX WOUNDS.
    expect(await stored(gmPage, uuid, 'system.stats.strength.value')).toBe(27);
    expect(await stored(gmPage, uuid, 'system.stats.combat.value')).toBe(37);
    expect(await stored(gmPage, uuid, 'system.stats.sanity.value')).toBe(12);
    expect(await stored(gmPage, uuid, 'system.stats.body.value')).toBe(22);
    expect(await stored(gmPage, uuid, 'system.stats.fear.value')).toBe(32);
    expect(await stored(gmPage, uuid, 'system.health.max')).toBe(11);
    expect(await stored(gmPage, uuid, 'system.health.value')).toBe(11);
    expect(await stored(gmPage, uuid, 'system.hits.max')).toBe(3);
    expect(await stored(gmPage, uuid, 'system.credits.value')).toBe('20');
    expect(await stored(gmPage, uuid, 'system.class.value')).toBe('Marine');
    expect(await stored(gmPage, uuid, 'system.other.stressdesc.value')).toMatch(/\S/);

    // Neither table hands out a document, so the run keeps both rows as the text they printed.
    expect(await stored(gmPage, uuid, 'system.patch.value')).toMatch(/\S/);
    expect(await stored(gmPage, uuid, 'system.trinket.value')).toMatch(/\S/);

    // PSG step 9 asks for the pronouns beside the name, so the last pane collects both.
    expect(await stored(gmPage, uuid, 'system.pronouns.value')).toBe('they/them');

    // PSG step 5: current Stress and Minimum Stress both start at 2.
    expect(await stored(gmPage, uuid, 'system.other.stress.value')).toBe(2);
    expect(await stored(gmPage, uuid, 'system.other.stress.min')).toBe(2);

    const carried = await items(gmPage, uuid);
    expect(carried.filter((i) => i.type === 'skill')).toHaveLength(4);

    // The class arrives as a document, not just `system.class.value`: its `robotic` flag is what
    // tells the Panic table android from human.
    expect(carried.filter((i) => i.type === 'class').map((i) => i.name)).toEqual(['Marine']);

    // The row links armour, a weapon and equipment under the book's names; all three must arrive as
    // resolved documents, and the unlisted Unarmed with them.
    const gear = carried
      .filter((i) => i.type !== 'skill' && i.type !== 'class')
      .map((i) => i.name)
      .sort();
    expect(gear).toEqual(['Scalpel', 'Stimpak', 'Tank Top and Camo Pants', 'Unarmed']);
  });

  test('the skills pane swaps the bonus package without a trip back to adjustments', async ({ gmPage }) => {
    await openGenerator(gmPage);
    await freezeDice(gmPage, LOWEST_FACE);

    await chooseClass(gmPage, 'Marine');
    await takeSkillBonus(gmPage, 1);
    await reachSkills(gmPage);

    const swap = gmPage.locator('.skill-selector-swap-select');
    await expect(swap).toHaveValue('1');
    await expect(gmPage.locator('.skill-selector-pick-rank')).toHaveText(['Trained', 'Trained']);

    await swap.selectOption('0');

    // The slots the other package promises replace the ones this one left, and a pick taken under
    // the old package goes with them.
    await expect(gmPage.locator('.skill-selector-pick-rank')).toHaveText(['Expert']);

    // Both controls read the same answer, so the pane behind it shows the swap already made.
    await goTo(gmPage, 'adjustments');
    await expect(gmPage.locator('button.wizard-package[aria-pressed="true"]')).toHaveText(/1 Expert Skill/);
  });

  test('a class replaces the one before it rather than stacking on it', async ({ gmPage }) => {
    const uuid = await openGenerator(gmPage);
    await freezeDice(gmPage, LOWEST_FACE);

    // The Teamster grants skills outright (1 Trained, 1 Expert); the Trained pick must land first
    // to make an Expert available.
    await chooseClass(gmPage, 'Teamster');
    await pickEverySkill(gmPage);
    // +5 to all stats and +10 to all saves, so the readout collapses each into a row of its own.
    await goTo(gmPage, 'adjustments');
    await expect(gmPage.locator('[data-modifier="all_stats"]')).toHaveText('+5');
    await expect(gmPage.locator('[data-modifier="all_saves"]')).toHaveText('+10');

    await chooseClass(gmPage, 'Android');

    // The Android's "-10 to 1 stat" gates the rail until spent; spending it again moves the penalty
    // rather than doubling it — park it on Strength, then move it to Speed.
    await expect(gmPage.locator('button.wizard-rail-step[data-pane="health"]')).toBeDisabled();
    await goTo(gmPage, 'adjustments');
    await gmPage.selectOption('[data-choice="0"] select', 'strength');
    await expect(gmPage.locator('[data-modifier="strength"]')).toHaveText('-10');
    await expect(gmPage.locator('[data-choice="0"] option[value="strength"]')).toContainText('→ 17');
    await gmPage.selectOption('[data-choice="0"] select', 'speed');
    // The readout carries what moved and nothing else, so Strength leaves it entirely.
    await expect(gmPage.locator('[data-modifier="strength"]')).toHaveCount(0);
    await expect(gmPage.locator('[data-modifier="speed"]')).toHaveText('-10');

    // The pane asks two questions; placing the adjustment alone isn't enough — the either/or bonus also gates the rail.
    await expect(gmPage.locator('button.wizard-rail-step[data-pane="health"]')).toBeDisabled();
    await gmPage.click('button.wizard-package >> nth=1');
    await expect(gmPage.locator('button.wizard-rail-step[data-pane="health"]')).toBeEnabled();

    await pickEverySkill(gmPage);

    // The Teamster's +5 is gone rather than added to: Android is +20 INTELLECT, +60 FEAR.
    await goTo(gmPage, 'adjustments');
    await expect(gmPage.locator('[data-modifier="intellect"]')).toHaveText('+20');
    await expect(gmPage.locator('[data-modifier="speed"]')).toHaveText('-10');
    await expect(gmPage.locator('[data-modifier="combat"]')).toHaveCount(0);
    await expect(gmPage.locator('[data-modifier="fear"]')).toHaveText('+60');
    // Three granted plus the two chosen, not the Teamster's on top.
    await goTo(gmPage, 'skills');
    await expect(gmPage.locator('ul[data-list="skills"] li')).toHaveCount(5);

    await goTo(gmPage, 'gear');
    await gmPage.click('button[data-roll="all"]');
    await goTo(gmPage, 'finish');
    await gmPage.click('button[data-action="save"]');
    await gmPage.waitForSelector('form.character-wizard', { state: 'detached' });

    expect(await stored(gmPage, uuid, 'system.stats.strength.value')).toBe(27);
    expect(await stored(gmPage, uuid, 'system.class.value')).toBe('Android');
    // The class item follows the class: one of them, and it is the one that was saved.
    const carried = await items(gmPage, uuid);
    expect(carried.filter((i) => i.type === 'class').map((i) => i.name)).toEqual(['Android']);
    // Completing every prior pane means the unmodified rolled Combat score is written too.
    expect(await stored(gmPage, uuid, 'system.stats.combat.value')).toBe(27);
  });

  test('the Scientist’s Master set is filled from the bottom up', async ({ gmPage }) => {
    const uuid = await openGenerator(gmPage);
    await freezeDice(gmPage, LOWEST_FACE);

    await chooseClass(gmPage, 'Scientist');
    await goTo(gmPage, 'adjustments');
    await gmPage.selectOption('[data-choice="0"] select', 'intellect');
    await reachSkills(gmPage);

    const picker = gmPage.locator('.skill-selector');
    const column = (rank: string) => picker.locator(`.skill-selector-column[data-rank="${rank}"]`);

    // The class's demands stand above the columns before anything is picked: the Master set as the
    // chain it is, then the loose Trained pick.
    const chips = picker.locator('.skill-selector-pick');
    await expect(chips.locator('.skill-selector-pick-rank')).toHaveText([
      'Trained', 'Expert', 'Master', 'Trained',
    ]);
    await expect(chips.locator('.skill-selector-pick-name')).toHaveText([
      'Choose one', 'Choose one', 'Choose one', 'Choose one',
    ]);

    // The Scientist starts with no skills at all, so only the base of the set is open.
    await expect(column('Trained').locator('[data-state="available"]')).not.toHaveCount(0);
    await expect(column('Expert').locator('[data-state="available"]')).toHaveCount(0);
    await expect(column('Master').locator('[data-state="available"]')).toHaveCount(0);

    // Chemistry's two Experts are both terminal (no Master stands on either); spending the set's one
    // Expert pick there would leave the Master pick unfillable, so the picker refuses them outright.
    await column('Trained').locator('[data-skill]:has-text("Chemistry")').click();
    await expect(column('Expert').locator('[data-state="available"]')).toHaveCount(0);
    await expect(column('Expert').locator('[data-skill]:has-text("Explosives")'))
      .toHaveAttribute('data-reason', 'strands');

    // Industrial Equipment gates Asteroid Mining and Mechanical Repair; Mechanical Repair gates
    // Cybernetics, Engineering and Robotics — each pick opens only what stands on it.
    await column('Trained').locator('[data-skill]:has-text("Industrial Equipment")').click();
    await expect(column('Expert').locator('[data-state="available"]')).toHaveText([
      /Asteroid Mining/, /Mechanical Repair/,
    ]);
    await expect(column('Master').locator('[data-state="available"]')).toHaveCount(0);

    await column('Expert').locator('[data-skill]:has-text("Mechanical Repair")').click();
    await expect(column('Master').locator('[data-state="available"]')).toHaveText([
      /Robotics/, /Engineering/, /Cybernetics/,
    ]);

    await column('Master').locator('[data-skill]:has-text("Cybernetics")').click();
    // Each chip now names what took it, so the class's demands read the same answered as asked.
    await expect(chips.locator('.skill-selector-pick-name')).toHaveText([
      'Chemistry', 'Mechanical Repair', 'Cybernetics', 'Industrial Equipment',
    ]);

    await pickEverySkill(gmPage);
    await expect(gmPage.locator('ul[data-list="skills"] li')).toHaveCount(4);

    await rollStatsAndSaves(gmPage);
    await goTo(gmPage, 'gear');
    await gmPage.click('button[data-roll="all"]');
    await goTo(gmPage, 'finish');
    await gmPage.fill('form.character-wizard input[name="name"]', '__e2e_scientist');
    await gmPage.click('button[data-action="save"]');
    await gmPage.waitForSelector('form.character-wizard', { state: 'detached' });

    // What was saved is the chain the book describes, plus the class's own free Trained pick.
    const carried = await items(gmPage, uuid);
    const skills = carried.filter((item) => item.type === 'skill').map((item) => item.name).sort();
    expect(skills).toEqual(['Chemistry', 'Cybernetics', 'Industrial Equipment', 'Mechanical Repair']);
  });

  test('a run closed halfway resumes from the menu, which retires once the run finishes', async ({ gmPage }) => {
    const uuid = await openGenerator(gmPage);
    await freezeDice(gmPage, LOWEST_FACE);
    await chooseClass(gmPage, 'Teamster');
    await goTo(gmPage, 'adjustments');
    await closeWizard(gmPage);

    const record = await stored(gmPage, uuid, 'flags.mothershiprpg.creation');
    expect(record).toMatchObject({ done: false, step: 4 });
    expect(record.rolled.strength).toBeGreaterThan(0);
    // The run is the only place the answers live: the sheet itself is untouched until Create.
    expect(await stored(gmPage, uuid, 'system.class.value')).toBe('');

    // By id, not by contents: a closing generator window is briefly still in the DOM with its
    // form already unmounted.
    const sheet = gmPage.locator('.application.character:not([id^="mothership-generator-"])');
    const control = gmPage.locator('.context-item', { hasText: 'Character Creation Wizard' });
    await sheet.locator('.header-control[data-action="toggleControls"]').click();
    await expect(control).toHaveCount(1);
    await control.click();

    await expect(gmPage.locator('section.wizard-pane[data-pane="adjustments"]')).toHaveCount(1);
    await goTo(gmPage, 'class');
    await expect(gmPage.locator('button.wizard-class.chosen')).toHaveAttribute('data-class', 'Teamster');
    await goTo(gmPage, 'stats');
    await expect(gmPage.locator('input[data-value="strength"]')).not.toHaveValue('');

    await pickEverySkill(gmPage);
    await goTo(gmPage, 'gear');
    await gmPage.click('button[data-roll="all"]');
    await goTo(gmPage, 'finish');
    await gmPage.fill('form.character-wizard input[name="name"]', '__e2e_resumed');
    await gmPage.click('button[data-action="save"]');
    await gmPage.waitForSelector('form.character-wizard', { state: 'detached' });

    // Finishing keeps the fact of the run and drops its answers, and the control goes with them.
    expect(await stored(gmPage, uuid, 'flags.mothershiprpg.creation')).toEqual({ version: 1, done: true });
    expect(await stored(gmPage, uuid, 'system.class.value')).toBe('Teamster');
    await sheet.locator('.header-control[data-action="toggleControls"]').click();
    await expect(control).toHaveCount(0);
  });

  // In the wizard the die is the button, not a mark riding one, so it turns on its own hover.
  test('a hovered wizard die turns over', async ({ gmPage }) => {
    await openGenerator(gmPage);
    await goTo(gmPage, 'stats');
    const die = gmPage.locator('img[data-roll="strength"]');

    expect(await die.evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.transitionProperty, style.transitionDuration, style.transitionTimingFunction];
    })).toEqual(['transform', '0.5s', 'ease-in-out']);

    const turn = () => die.evaluate((el) => getComputedStyle(el).transform);
    expect(await turn()).toBe('none');
    await die.hover();
    await expect.poll(turn).not.toBe('none');
  });

  test('rolling a patch no longer throws on a row that links nothing', async ({ gmPage }) => {
    await openGenerator(gmPage);
    await freezeDice(gmPage, LOWEST_FACE);

    await chooseClass(gmPage, 'Teamster');

    await pickEverySkill(gmPage);

    await goTo(gmPage, 'gear');
    await gmPage.click('img[data-roll="patch"]');
    await expect(gmPage.locator('input[data-value="patch"]')).toHaveValue('0');
    await expect(gmPage.locator('[data-text="patch"]')).not.toBeEmpty();
  });
});
