// The documents these specs render against, and the two openers that put a sheet on screen.
// Shared so the visual baselines and the fall-through audit photograph the same furniture: a
// sheet whose fields are empty draws fewer elements, and an audit of those is an audit of less.
import { expect, type Page } from '@playwright/test';

export const CHARACTER = {
  class: { value: 'Marine' },
  rank: { value: 'Corporal' },
  pronouns: { value: 'they/them' },
  credits: { value: '250' },
  attributes: { level: { value: 3 } },
  stats: {
    strength: { value: 45, mod: 5 },
    speed: { value: 30, mod: 0 },
    intellect: { value: 25, mod: 0 },
    combat: { value: 55, mod: 10 },
    sanity: { value: 30, mod: 0 },
    fear: { value: 40, mod: 5 },
    body: { value: 35, mod: 0 },
  },
  health: { value: 8, max: 10 },
  hits: { value: 1, max: 2 },
  other: { stress: { value: 3, min: 2 }, stressdesc: { value: 'Adrenaline surge' } },
  notes: '<p>owes the company money</p>',
  biography: '<p>born on Prospero</p>',
};

export const CREATURE = {
  contractor: true,
  stats: {
    combat: { value: 35 },
    instinct: { value: 40 },
    loyalty: { value: 20 },
    armor: { value: 5, mod: 5, damageReduction: 1, cover: 'light' },
  },
  health: { value: 12, max: 15 },
  hits: { value: 1, max: 3 },
  description: '<p>Something in the ducting, and it has learned the door codes.</p>',
  notes: '<p>ate the away team</p>',
};

/** One of each embedded type, so every item panel on the character sheet draws a row. */
export const LOADOUT = [
  { name: '__e2e_Zero-G', type: 'skill', system: { rank: 'Trained', bonus: 10 } },
  {
    name: '__e2e_SMG',
    type: 'weapon',
    system: { damage: '2d10', range: 'close', useAmmo: true, ammo: 4, shots: 6, curShots: 2, weight: 1 },
  },
  {
    name: '__e2e_Vacsuit',
    type: 'armor',
    system: { armorPoints: 3, damageReduction: 1, equipped: true, weight: 2 },
  },
  { name: '__e2e_Rations', type: 'item', system: { quantity: 3, weight: 1, cost: 15 } },
  { name: '__e2e_Bleeding', type: 'condition', system: { severity: 2, treatment: { value: 1 } } },
];

/** What a horror carries: the book's Attack line, and the special abilities under it. */
export const HORROR = [
  { name: '__e2e_Talons', type: 'weapon', system: { damage: '4d10', range: 'adjacent' } },
  {
    name: '__e2e_Tail',
    type: 'weapon',
    system: { damage: '2d10', range: 'adjacent', antiArmor: true },
  },
  {
    name: '__e2e_Acid_Blood',
    type: 'ability',
    system: { description: 'Anything that wounds it is splashed for 1d10 DMG, armour first.' },
  },
  {
    name: '__e2e_Tail_Poison',
    type: 'ability',
    system: { description: 'Body Save [-] or fall unconscious.' },
  },
];

export const ITEM_SHEETS = [
  {
    name: 'item-sheet-gear',
    type: 'item',
    system: { quantity: 2, weight: 1, cost: 25, description: '<p>A patch kit, half used.</p>' },
  },
  {
    name: 'item-sheet-weapon',
    type: 'weapon',
    system: {
      damage: '2d10',
      range: 'close',
      useAmmo: true,
      ammo: 4,
      shots: 6,
      curShots: 2,
      shotsPerFire: 1,
      bonus: 5,
      weight: 1,
      cost: 400,
      description: '<p>Standard issue, and it jams.</p>',
    },
  },
  {
    name: 'item-sheet-armor',
    type: 'armor',
    system: {
      armorPoints: 3,
      damageReduction: 1,
      equipped: true,
      weight: 2,
      cost: 300,
      description: '<p>Scuffed, resealed twice.</p>',
    },
  },
  {
    name: 'item-sheet-ability',
    type: 'ability',
    system: { roll: '1d10', description: '<p>Hold your breath and count.</p>' },
  },
  {
    name: 'item-sheet-condition',
    type: 'condition',
    system: {
      severity: 2,
      treatment: { value: 1 },
      modifiers: [
        { scope: 'strength', modifier: 'disadvantage' },
        { scope: 'fear', modifier: 'disadvantage' },
      ],
      description: '<p>Bleeding through the bandage, and getting worse.</p>',
    },
  },
] as const;
export type Opened = { appId: string; uuid: string };

export const openActor = async (
  page: Page,
  type: string,
  name: string,
  system: object,
  items: object[] = [],
): Promise<Opened> => {
  const opened = await page.evaluate(
    async ({ t, n, s, i }: { t: string; n: string; s: object; i: object[] }) => {
      const doc = await (window as any).Actor.create({ name: n, type: t, system: s, items: i });
      await doc.sheet.render({ force: true });
      return { appId: doc.sheet.id as string, uuid: doc.uuid as string };
    },
    { t: type, n: name, s: system, i: items },
  );
  await expect(page.locator(`#${opened.appId}`)).toBeVisible();
  return opened;
};

export const openItem = async (page: Page, type: string, name: string, system: object): Promise<Opened> => {
  const opened = await page.evaluate(
    async ({ t, n, s }: { t: string; n: string; s: object }) => {
      const doc = await (window as any).Item.create({ name: n, type: t, system: s });
      await doc.sheet.render({ force: true });
      return { appId: doc.sheet.id as string, uuid: doc.uuid as string };
    },
    { t: type, n: name, s: system },
  );
  await expect(page.locator(`#${opened.appId}`)).toBeVisible();
  return opened;
};

