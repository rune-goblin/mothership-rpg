// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { promptAddItem, promptNewItem } from '../module/ui/actor/items.js';
import { promptStatOption } from '../module/ui/class/stat-option.js';
import {
  clearFoundryStubs,
  installDialogV2,
  installI18n,
  installItemForms,
  installNotifications,
  installPacks,
  installWorldItems,
  type Notifications,
  type OpenDialog,
} from './foundry-stubs.ts';

let opened: OpenDialog[] = [];
let notifications: Notifications;

beforeEach(() => {
  installI18n({
    'Mothership.Speed': 'Speed',
    'Mothership.Strength': 'Strength',
    'Mothership.SkillRankTrained': 'Trained',
    'Mothership.SkillRankExpert': 'Expert',
    'Mothership.classNewStatOptionEmptyError': 'You must select at least two stat or saves',
    'Mothership.NewSkill': 'New Skill',
    'Mothership.NewArmor': 'New Armor',
  });
  notifications = installNotifications();
  opened = installDialogV2();
});

afterEach(() => {
  document.body.replaceChildren();
  clearFoundryStubs();
});

const only = (): OpenDialog => {
  expect(opened).toHaveLength(1);
  return opened[0];
};

/** The new-item form opens over the picker, so the frontmost dialog is the one under test. */
const front = (): OpenDialog => opened[opened.length - 1];

// The picker opens a microtask after the pack answers, and a form's change listener is an
// attachment — an effect later than the mount that put its fields on screen.
const settle = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve));

const select = (selector: string, value: string): void => {
  const node = only().element.querySelector<HTMLSelectElement>(selector)!;
  node.value = value;
  node.dispatchEvent(new Event('change', { bubbles: true }));
};

const type = (selector: string, value: string): void => {
  const node = only().element.querySelector<HTMLInputElement>(selector)!;
  node.value = value;
  node.dispatchEvent(new Event('input', { bubbles: true }));
};

const check = (selector: string): void => {
  only().element.querySelector<HTMLElement>(selector)!.click();
};

/** The form has no submit of its own: a field lands on the draft when it fires `change`. */
const fill = (name: string, value: string): void => {
  const node = front().element.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  node.value = value;
  node.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('promptNewItem', () => {
  interface Created {
    readonly created: object[][];
    readonly actor: { createEmbeddedDocuments(type: string, data: object[]): Promise<unknown> };
  }

  const actorOf = (): Created => {
    const created: object[][] = [];
    return {
      created,
      actor: {
        createEmbeddedDocuments: async (_type: string, data: object[]) => {
          created.push(data);
          return data;
        },
      },
    };
  };

  beforeEach(() => {
    installItemForms({ skill: { description: '', rank: 'Trained', bonus: 10, prerequisite_ids: [] } });
  });

  it('opens the type’s own sheet form on the DataModel’s defaults', async () => {
    const world = installWorldItems();
    const done = promptNewItem(actorOf().actor, 'skill');
    await settle();

    expect(only().title).toBe('New Skill');
    expect(only().buttons.map((button) => button.action)).toEqual(['add', 'world', 'cancel']);
    expect(only().element.querySelector<HTMLInputElement>('[name="name"]')!.value).toBe('New Skill');
    expect(only().element.querySelector<HTMLInputElement>('[name="system.bonus"]')!.value).toBe('10');

    await only().press('cancel');
    await done;
    expect(world.created).toEqual([]);
  });

  it('files what was typed in the world, and leaves the character alone', async () => {
    const world = installWorldItems();
    const { actor, created } = actorOf();
    const done = promptNewItem(actor, 'skill');
    await settle();

    fill('name', 'Zero-G');
    fill('system.rank', 'Expert');
    fill('system.bonus', '15');
    await only().press('world');
    await done;

    expect(world.created).toEqual([
      {
        name: 'Zero-G',
        type: 'skill',
        img: undefined,
        system: { description: '', rank: 'Expert', bonus: 15, prerequisite_ids: [] },
      },
    ]);
    expect(created).toEqual([]);
  });

  it('files it in the world and hands the character a copy', async () => {
    const world = installWorldItems();
    const { actor, created } = actorOf();
    const done = promptNewItem(actor, 'skill');
    await settle();

    fill('name', 'Zero-G');
    await only().press('add');
    await done;

    expect(world.created).toHaveLength(1);
    expect(created).toEqual([[world.created[0]]]);
  });

  // Nothing is written until a button is pressed, which is what makes Cancel mean anything.
  it('writes nothing on cancel, and nothing on a dismissal', async () => {
    const world = installWorldItems();
    const { actor, created } = actorOf();

    const cancelled = promptNewItem(actor, 'skill');
    await settle();
    fill('name', 'Zero-G');
    await only().press('cancel');
    await expect(cancelled).resolves.toBeNull();

    opened.length = 0;
    const dismissed = promptNewItem(actor, 'skill');
    only().dismiss();
    await expect(dismissed).resolves.toBeNull();

    expect(world.created).toEqual([]);
    expect(created).toEqual([]);
  });
});

describe('promptAddItem', () => {
  interface Created {
    readonly created: object[][];
    readonly actor: {
      items: object[];
      createEmbeddedDocuments(type: string, data: object[]): Promise<unknown>;
    };
  }

  const actorOf = (items: object[] = []): Created => {
    const created: object[][] = [];
    return {
      created,
      actor: {
        items,
        createEmbeddedDocuments: async (_type: string, data: object[]) => {
          created.push(data);
          return data;
        },
      },
    };
  };

  const packDoc = (id: string, name: string, type: string, system: object) => ({
    id,
    name,
    img: `icons/${id}.png`,
    uuid: `Compendium.mothershiprpg.test.Item.${id}`,
    system,
    toObject: () => ({ name, type, img: `icons/${id}.png`, system }),
  });

  // Deliberately out of order: Expert first, Trained names reversed. The Expert skill lists two
  // prerequisites because that is how the PSG tree reads — converging arrows are alternatives.
  const skillDocs = [
    packDoc('sk-x', 'Xenobotany', 'skill', {
      rank: 'Expert',
      bonus: 15,
      prerequisite_ids: [
        'Compendium.mothershiprpg.test.Item.sk-b',
        'Compendium.mothershiprpg.test.Item.sk-a',
      ],
    }),
    packDoc('sk-b', 'Botany', 'skill', { rank: 'Trained', bonus: 10 }),
    packDoc('sk-a', 'Archaeology', 'skill', { rank: 'Trained', bonus: 10 }),
  ];

  const weaponDocs = [
    packDoc('wp-r', 'Revolver', 'weapon', { damage: '1d10', range: 'close' }),
    packDoc('wp-l', 'Laser Cutter', 'weapon', { damage: '1d100', range: 'long' }),
  ];

  // Rows are keyed by uuid; the fixtures' ids are its last segment.
  const uuidOf = (id: string) => `Compendium.mothershiprpg.test.Item.${id}`;
  const at = (id: string) => `[data-choice="${uuidOf(id)}"]`;

  // The picker is always the first dialog opened here; the new-item form can be standing over it.
  const radios = (): string[] =>
    [...opened[0].element.querySelectorAll<HTMLElement>('[data-choice]')].map(
      (node) => node.dataset.choice!.split('.').pop()!,
    );

  it('orders skills weakest rank first, alphabetically inside a rank', async () => {
    installPacks({ 'mothershiprpg.skills_1e': skillDocs });
    const done = promptAddItem(actorOf().actor, 'skill');
    await settle();

    expect(radios()).toEqual(['sk-a', 'sk-b', 'sk-x']);

    only().dismiss();
    await done;
  });

  it('bars a skill whose prerequisite the actor lacks, until the toggle lifts enforcement', async () => {
    installPacks({ 'mothershiprpg.skills_1e': skillDocs });
    const { actor, created } = actorOf();
    const done = promptAddItem(actor, 'skill');
    await settle();

    const radio = (id: string) =>
      only().element.querySelector<HTMLInputElement>(`${at(id)} .choice-input`)!;
    expect(radio('sk-x').disabled).toBe(true);
    expect(radio('sk-b').disabled).toBe(false);

    check('#pick-enforce');
    await settle();
    expect(radio('sk-x').disabled).toBe(false);

    check(at('sk-x'));
    await only().press('add');
    await done;

    expect(created).toEqual([[skillDocs[0].toObject()]]);
  });

  // PSG 22 — 13 of the tree's skills list several prerequisites, and every one is any-of:
  // owning a single skill on the list unlocks it. The book has no all-of case.
  it.each(['Botany', 'Archaeology'])(
    'offers a skill with enforcement on when the actor owns any one prerequisite (%s)',
    async (owned) => {
      installPacks({ 'mothershiprpg.skills_1e': skillDocs });
      const { actor } = actorOf([{ type: 'skill', name: owned }]);
      const done = promptAddItem(actor, 'skill');
      await settle();

      expect(only().element.querySelector<HTMLInputElement>(`${at('sk-x')} .choice-input`)!.disabled).toBe(
        false,
      );

      only().dismiss();
      await done;
    },
  );

  it('drops a barred pick when enforcement is turned back on', async () => {
    installPacks({ 'mothershiprpg.skills_1e': skillDocs });
    const { actor, created } = actorOf();
    const done = promptAddItem(actor, 'skill');
    await settle();

    check('#pick-enforce');
    await settle();
    check(at('sk-x'));
    check('#pick-enforce');
    await settle();

    await only().press('add');
    await expect(done).resolves.toBeNull();
    expect(created).toEqual([]);
  });

  it('narrows the table as the filter is typed, case-insensitively', async () => {
    installPacks({ 'mothershiprpg.weapons_1e': weaponDocs });
    const done = promptAddItem(actorOf().actor, 'weapon');
    await settle();

    type('#choice-filter', 'laser');
    await settle();
    expect(radios()).toEqual(['wp-l']);

    type('#choice-filter', '');
    await settle();
    expect(radios()).toEqual(['wp-l', 'wp-r']);

    only().dismiss();
    await done;
  });

  it('adds a copy of the picked document on Add', async () => {
    installPacks({ 'mothershiprpg.weapons_1e': weaponDocs });
    const { actor, created } = actorOf();
    const done = promptAddItem(actor, 'weapon');
    await settle();

    check(at('wp-r'));
    await only().press('add');
    await done;

    expect(created).toEqual([
      [
        {
          name: 'Revolver',
          type: 'weapon',
          img: 'icons/wp-r.png',
          system: { damage: '1d10', range: 'close' },
        },
      ],
    ]);
  });

  it('adds nothing on Add with no pick, on cancel, and on a dismissal', async () => {
    installPacks({ 'mothershiprpg.skills_1e': skillDocs });
    const { actor, created } = actorOf();

    const unpicked = promptAddItem(actor, 'skill');
    await settle();
    await only().press('add');
    await expect(unpicked).resolves.toBeNull();

    opened.length = 0;
    const cancelled = promptAddItem(actor, 'skill');
    await settle();
    await only().press('cancel');
    await expect(cancelled).resolves.toBeNull();

    opened.length = 0;
    const dismissed = promptAddItem(actor, 'skill');
    await settle();
    only().dismiss();
    await expect(dismissed).resolves.toBeNull();

    expect(created).toEqual([]);
  });

  it('lists a name-only table for conditions, and answers from the footer alone', async () => {
    installPacks({
      'mothershiprpg.conditions_1e': [
        packDoc('cn-b', 'Bleeding', 'condition', {}),
        packDoc('cn-a', 'Anxious', 'condition', {}),
      ],
    });
    const { actor, created } = actorOf();
    const done = promptAddItem(actor, 'condition');
    await settle();

    expect(radios()).toEqual(['cn-a', 'cn-b']);
    expect(only().buttons.map((button) => button.action)).toEqual(['add', 'cancel']);

    check(at('cn-b'));
    await only().press('add');
    await done;

    expect(created).toEqual([[packDoc('cn-b', 'Bleeding', 'condition', {}).toObject()]]);
  });

  it('lists the world’s own documents under a heading of their own, beneath the pack’s', async () => {
    installPacks({ 'mothershiprpg.weapons_1e': weaponDocs });
    installWorldItems([
      {
        id: 'w1',
        uuid: 'Item.w1',
        name: 'Bolt Thrower',
        type: 'weapon',
        system: { damage: '2d10', range: 'long' },
        toObject: () => ({ name: 'Bolt Thrower', type: 'weapon', system: {} }),
      },
    ]);
    const done = promptAddItem(actorOf().actor, 'weapon');
    await settle();

    expect(radios()).toEqual(['wp-l', 'wp-r', 'w1']);
    expect(
      [...only().element.querySelectorAll('.choice-group')].map((row) => row.textContent?.trim()),
    ).toEqual(['Mothership.FromThisWorld']);

    only().dismiss();
    await done;
  });

  it('adds a copy of a world document, not the pack document beside it', async () => {
    installPacks({ 'mothershiprpg.weapons_1e': weaponDocs });
    installWorldItems([
      {
        id: 'w1',
        uuid: 'Item.w1',
        name: 'Bolt Thrower',
        type: 'weapon',
        system: { damage: '2d10', range: 'long' },
        toObject: () => ({ name: 'Bolt Thrower', type: 'weapon', system: { damage: '2d10' } }),
      },
    ]);
    const { actor, created } = actorOf();
    const done = promptAddItem(actor, 'weapon');
    await settle();

    check('[data-choice="Item.w1"]');
    await only().press('add');
    await done;

    expect(created).toEqual([[{ name: 'Bolt Thrower', type: 'weapon', system: { damage: '2d10' } }]]);
  });

  // Create is a body control, not a footer button: a footer button would answer the picker, and
  // the form has to open over a picker that is still standing.
  it('opens the new-item form over the picker, and takes the picker down once one is written', async () => {
    installItemForms({
      armor: {
        description: '',
        armorPoints: 1,
        damageReduction: 0,
        speed: '',
        oxygenMax: 0,
        oxygenCurrent: 0,
        equipped: false,
        features: '',
      },
    });
    installPacks({ 'mothershiprpg.armor_1e': [packDoc('ar-v', 'Vaccsuit', 'armor', {})] });
    const world = installWorldItems();
    const done = promptAddItem(actorOf().actor, 'armor');
    await settle();

    check('#pick-create');
    await settle();

    expect(opened).toHaveLength(2);
    expect(front().title).toBe('New Armor');

    fill('name', 'Standard Battle Dress');
    await front().press('world');
    await done;

    expect(world.created).toEqual([
      {
        name: 'Standard Battle Dress',
        type: 'armor',
        img: undefined,
        system: {
          description: '',
          armorPoints: 1,
          damageReduction: 0,
          speed: '',
          oxygenMax: 0,
          oxygenCurrent: 0,
          equipped: false,
          features: '',
        },
      },
    ]);
    expect(world.rendered).toEqual([]);
  });

  it('leaves the picker standing when the form is cancelled', async () => {
    installItemForms({ armor: { description: '' } });
    installPacks({ 'mothershiprpg.armor_1e': [packDoc('ar-v', 'Vaccsuit', 'armor', {})] });
    const world = installWorldItems();
    const done = promptAddItem(actorOf().actor, 'armor');
    await settle();

    check('#pick-create');
    await settle();
    await front().press('cancel');
    await settle();

    expect(world.created).toEqual([]);
    expect(radios()).toEqual(['ar-v']);

    opened[0].dismiss();
    await done;
  });

  it('opens the picker on the world alone when the pack ships nothing', async () => {
    installPacks({});
    installWorldItems([
      {
        id: 'w1',
        uuid: 'Item.w1',
        name: 'Bolt Thrower',
        type: 'weapon',
        system: { damage: '2d10', range: 'long' },
        toObject: () => ({ name: 'Bolt Thrower', type: 'weapon', system: {} }),
      },
    ]);
    const done = promptAddItem(actorOf().actor, 'weapon');
    await settle();

    expect(radios()).toEqual(['w1']);

    only().dismiss();
    await done;
  });

  it('falls straight back to the new-item form when the pack is missing', async () => {
    installItemForms({ skill: { description: '', rank: 'Trained', bonus: 10, prerequisite_ids: [] } });
    installPacks({});
    const { actor } = actorOf();
    const pending = promptAddItem(actor, 'skill');
    await settle();

    expect(only().title).toBe('New Skill');
    only().dismiss();
    await expect(pending).resolves.toBeNull();
  });
});

describe('promptStatOption', () => {
  // Ticked in the other order, because the entry lists them the way the class sheet does.
  it('answers with the value and the stats it may be spent on', async () => {
    const answer = promptStatOption();

    type('#modification', '-10');
    check('#speed');
    check('#strength');
    await only().press('create');

    await expect(answer).resolves.toEqual({ modification: -10, stats: ['strength', 'speed'] });
  });

  // The class schema stores the modification as a number; an input's value is a string.
  it('answers with a number, and with zero for a blank', async () => {
    const answer = promptStatOption();

    check('#strength');
    check('#fear');
    await only().press('create');

    await expect(answer).resolves.toEqual({ modification: 0, stats: ['strength', 'fear'] });
  });

  it('refuses an entry naming fewer than two stats, and says why', async () => {
    const answer = promptStatOption();

    check('#strength');
    await only().press('create');

    await expect(answer).resolves.toBeNull();
    expect(notifications.errors).toEqual(['You must select at least two stat or saves']);
  });

  it('answers null on cancel and on a dismissal', async () => {
    const cancelled = promptStatOption();
    await only().press('cancel');
    await expect(cancelled).resolves.toBeNull();

    opened.length = 0;
    const dismissed = promptStatOption();
    only().dismiss();
    await expect(dismissed).resolves.toBeNull();
    expect(notifications.errors).toEqual([]);
  });
});
