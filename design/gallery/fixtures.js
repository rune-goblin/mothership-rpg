// The default shape of every `system` object comes out of template.json, not transcribed — so a
// schema change reaches these specimens automatically. Only the interesting values are written
// here, over those defaults.
import template from '../../template.json';
import { createDocumentStore } from '../../module/ui/document-store.svelte.js';

/** template.json's own inheritance: a type lists the templates whose fields it folds in. */
function defaults(collection, type) {
  const { templates = [], ...own } = template[collection][type];
  const inherited = templates.map((name) => template[collection].templates[name]);
  return structuredClone(Object.assign({}, ...inherited, own));
}

const merge = (base, over) => {
  for (const [key, value] of Object.entries(over)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key]) merge(base[key], value);
    else base[key] = value;
  }
  return base;
};

export const actorSystem = (type, over = {}) => merge(defaults('Actor', type), over);
export const itemSystem = (type, over = {}) => merge(defaults('Item', type), over);

let sequence = 0;
const nextId = () => `design${String(++sequence).padStart(11, '0')}`;

/** A document as the components see one. `update`/`delete` never persist — a gallery that wrote
 *  would be writing to itself — they just report what they'd have done. */
export function document({ type, name, img = 'icons/svg/item-bag.svg', system, items = [] }) {
  const id = nextId();
  return {
    id,
    uuid: `Design.${id}`,
    type,
    name,
    img,
    system,
    items,
    update: async (changes) => console.info('[design] update', name, changes),
    delete: async () => console.info('[design] delete', name),
    sheet: { render: () => console.info('[design] open sheet', name) },
  };
}

/** An embedded item as a sheet's row snippets read one. */
export const embedded = (type, name, system, img = 'icons/svg/item-bag.svg') => ({
  ...document({ type, name, img, system }),
  // The enriched HTML the sheet shell hands a row, not the raw field: a row's disclosure prints
  // this, and an item with nothing to say offers no chevron.
  description: system.description ? enriched(system.description) : '',
  getFlag: () => undefined,
});

export const store = (doc, extra = {}) => createDocumentStore(doc, { items: doc.items, ...extra });

const enriched = (text) => `<p>${text}</p>`;

export const skills = [
  embedded('skill', 'Zero-G', itemSystem('skill', { rank: 'Trained', bonus: 10, description: 'Moving and working in free fall without losing your lunch.' })),
  embedded('skill', 'Piloting', itemSystem('skill', { rank: 'Expert', bonus: 15 })),
  embedded('skill', 'Hacking', itemSystem('skill', { rank: 'Master', bonus: 20 })),
];

export const weapons = [
  embedded(
    'weapon',
    'Pulse Rifle',
    itemSystem('weapon', {
      damage: '3d10',
      // Borrows the Combat Shotgun's shape: a second damage the range decides.
      damageModes: [{ label: 'Adjacent', formula: '1d10' }],
      range: 'long',
      ammo: 30,
      shots: 6,
      curShots: 4,
      shotsPerFire: 1,
      useAmmo: true,
      ammoType: 'rifle',
      critDmg: '1d10',
      woundEffect: 'Gunshot',
      bonus: 5,
      weight: 2,
      cost: 3000,
    }),
  ),
  embedded(
    'weapon',
    'Boarding Axe',
    itemSystem('weapon', { damage: '2d10', range: 'adjacent', shots: 1, curShots: 1, woundEffect: 'Gore & Massive', weight: 1, cost: 400 }),
  ),
];

export const armors = [
  embedded(
    'armor',
    'Standard Battle Dress',
    itemSystem('armor', {
      armorPoints: 7,
      damageReduction: 0,
      speed: '',
      oxygenMax: 0,
      oxygenCurrent: 0,
      equipped: true,
      weight: 2,
      cost: 4000,
      features: 'Sealed environment.',
    }),
  ),
  embedded(
    'armor',
    'Vaccsuit',
    itemSystem('armor', { armorPoints: 3, oxygenMax: 12, oxygenCurrent: 9, equipped: false, weight: 1, cost: 10000, description: 'Sealed against vacuum. Twelve hours of oxygen, and no protection worth the name.' }),
  ),
];

export const gear = [
  embedded('item', 'Rebreather', itemSystem('item', { quantity: 1, weight: 1, cost: 500, description: 'Six hours of filtered air per canister.' })),
  embedded('item', 'Cybernetic Diagnostic Scanner', itemSystem('item', { quantity: 1, weight: 1, cost: 5000 })),
];

export const conditions = [
  embedded(
    'condition',
    'Phobia',
    itemSystem('condition', {
      severity: 2,
      treatment: { value: 1 },
      description: 'A Fear Save at Disadvantage whenever the phobia is in the room.',
      modifiers: [
        { scope: 'fear', modifier: 'disadvantage' },
        { scope: 'sanity', modifier: 'advantage' },
      ],
    }),
  ),
];

export const abilities = [
  embedded(
    'ability',
    'Acid Blood',
    itemSystem('ability', {
      roll: '1d10',
      description: 'Anything that wounds it is splashed for 1d10 DMG, armour first.',
    })
  ),
  embedded(
    'ability',
    'Tail Poison',
    itemSystem('ability', { description: 'Body Save [-] or fall unconscious.' })
  ),
];

/** A horror's attacks are the book's Attack line: a name and a damage, nothing else. */
export const creatureAttacks = [
  embedded('weapon', 'Talons', itemSystem('weapon', { damage: '4d10', range: 'adjacent' })),
  embedded('weapon', 'Tail', itemSystem('weapon', { damage: '2d10', range: 'adjacent', antiArmor: true })),
];

export const character = document({
  type: 'character',
  name: 'Rook Vance',
  img: 'icons/svg/mystery-man.svg',
  items: [...skills, ...weapons, ...armors, ...gear, ...conditions],
  system: actorSystem('character', {
    class: { value: 'Teamster' },
    pronouns: { value: 'they/them' },
    credits: { value: '2,450' },
    patch: { value: '"Front Towards Enemy" (Claymore Mine)' },
    trinket: { value: 'Necklace of Shell Casings' },
    health: { value: 14, max: 20 },
    hits: { value: 1, max: 3 },
    netHP: { value: 34, max: 40 },
    stats: {
      strength: { value: 42, mod: 0 },
      speed: { value: 35, mod: 0 },
      intellect: { value: 48, mod: 5 },
      combat: { value: 30, mod: 0 },
      sanity: { value: 25, mod: 0 },
      fear: { value: 30, mod: 0 },
      body: { value: 40, mod: 0 },
      armor: { value: 7, mod: 7, damageReduction: 0, cover: 'light' },
    },
    other: { stress: { value: 5, min: 2 }, stressdesc: { value: 'Sleepless since the Kestrel.' } },
    weight: { current: 6, capacity: 11 },
  }),
});

export const creature = document({
  type: 'creature',
  name: 'Xenomorph Drone',
  img: 'icons/svg/mystery-man.svg',
  items: [...abilities, ...creatureAttacks],
  system: actorSystem('creature', {
    description: 'A hunched silhouette in the coolant fog.',
    health: { value: 25, max: 25 },
    hits: { value: 0, max: 4 },
    netHP: { value: 45, max: 45 },
    contractor: true,
    stats: {
      combat: { value: 65 },
      instinct: { value: 55 },
      loyalty: { value: 40 },
      armor: { value: 5, mod: 5, damageReduction: 0, cover: 'none' },
    },
  }),
});

export const characterStore = store(character, {
  hideWeight: false,
  enriched: {
    biography: enriched('Hauled cargo on the Kestrel run for nine years. Still counts the trips.'),
    notes: enriched('Owes the company 14,000cr.'),
  },
});

export const creatureStore = store(creature, {
  enriched: { description: enriched('A hunched silhouette in the coolant fog. It hunts by sound.') },
});

export const itemStore = (type, name, system, extra = '') =>
  store(document({ type, name, system }), {
    enriched: { description: enriched(extra || 'Sample description for the gallery.') },
  });

export const classDocument = document({
  type: 'class',
  name: 'Teamster',
  system: itemSystem('class', {
    description: 'The backbone of every haul.',
    trauma_response: 'Whenever you Panic, every close friendly character gains 1 Stress.',
    robotic: false,
    base_adjustment: {
      strength: 5,
      speed: 0,
      intellect: 0,
      combat: 0,
      sanity: 0,
      fear: 0,
      body: 0,
      max_wounds: 0,
    },
    selected_adjustment: {
      choose_stat: [{ modification: 10, stats: ['strength', 'combat'] }],
    },
  }),
});

export const skillDocument = document({
  type: 'skill',
  name: 'Zero-G',
  system: itemSystem('skill', { rank: 'trained', bonus: 10, description: 'Moving in free fall.' }),
});

/** The gallery never persists, so every handler says what it would have done and stops. */
export const say = (what) => (...args) => console.info(`[design] ${what}`, ...args);
