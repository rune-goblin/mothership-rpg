import { afterEach, beforeEach, describe, it, expect } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseResults, drawnRow } from '../module/ui/generator/table-result.js';
import { candidates } from '../module/ui/generator/skills.js';
import {
  creationFinished,
  creationRecord,
  finishCreation,
  RECORD_VERSION,
  saveRun,
} from '../module/ui/generator/record.js';
import { classCard, collapseAdjustments, signed } from '../module/ui/generator/labels.js';
import { CharacterDraft, UNARMED } from '../module/ui/generator/draft.svelte.js';
import { STEPS, STEP_TOTAL, stepNumber } from '../module/ui/generator/steps.js';
import { CHARACTER_CREATION } from '../content/books/psg/character-creation.ts';
import { CLASSES } from '../content/books/psg/classes.ts';
import { WEAPONS } from '../content/books/psg/weapons.ts';

function lang(file: string): Map<string, string> {
  const flatten = (value: unknown, prefix: string): [string, string][] =>
    (typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
      : [[prefix, String(value)]]);
  const path = fileURLToPath(new URL(`../lang/${file}`, import.meta.url));
  return new Map(flatten(JSON.parse(readFileSync(path, 'utf8')), ''));
}

const en = lang('en.json');

const loadoutRow = {
  type: 'text',
  description:
    'Tank Top and Camo Pants (AP 1), Combat Knife (as Scalpel DMG [+]), Stimpak (x5)<br><br>' +
    '@UUID[Compendium.mothershiprpg.armor_1e.Item.FU5u4cDDPFoe1eCW]{Tank Top and Camo Pants (AP 1)}<br>' +
    '@UUID[Compendium.mothershiprpg.weapons_1e.Item.tjFU8Fbh2fcfnWGL]{Combat Knife (as Scalpel DMG [+])}<br>' +
    '@UUID[Compendium.mothershiprpg.equipment_1e.Item.E496Z3oUgdzAWxib]{Stimpak (x5)}',
  range: [0, 0],
};

describe('table results', () => {
  it('takes every linked document out of a loadout row', () => {
    const { entries } = parseResults([loadoutRow]);
    expect(entries.map((e) => e.uuid)).toEqual([
      'Compendium.mothershiprpg.armor_1e.Item.FU5u4cDDPFoe1eCW',
      'Compendium.mothershiprpg.weapons_1e.Item.tjFU8Fbh2fcfnWGL',
      'Compendium.mothershiprpg.equipment_1e.Item.E496Z3oUgdzAWxib',
    ]);
    expect(entries.map((e) => e.name)).toEqual([
      'Tank Top and Camo Pants (AP 1)',
      'Combat Knife (as Scalpel DMG [+])',
      'Stimpak (x5)',
    ]);
  });

  it('shows the printed list without the links or the breaks after it', () => {
    expect(parseResults([loadoutRow]).text).toBe(
      'Tank Top and Camo Pants (AP 1), Combat Knife (as Scalpel DMG [+]), Stimpak (x5)',
    );
  });

  it('reads a row that links nothing', () => {
    const drawn = parseResults([
      { type: 'text', description: 'Manual: PANIC: Harbinger of Catastrophe', range: [0, 0] },
    ]);
    expect(drawn).toEqual({ text: 'Manual: PANIC: Harbinger of Catastrophe', entries: [] });
  });

  it('reads a document result', () => {
    expect(
      parseResults([{ type: 'document', name: 'Scalpel', documentUuid: 'Item.abc' }]),
    ).toEqual({ text: 'Scalpel', entries: [{ uuid: 'Item.abc', name: 'Scalpel' }] });
  });

  it('reports the printed row number', () => {
    expect(drawnRow({ results: [loadoutRow], roll: { total: 7 } })).toBe(0);
    expect(drawnRow({ results: [{}], roll: { total: 7 } })).toBe(7);
  });
});

describe('skill candidates', () => {
  type Skill = { uuid: string; name: string; rank: string; prerequisites: string[] };
  const named = (list: Skill[]) => list.map((skill) => skill.uuid);
  const catalog: Skill[] = [
    { uuid: 'a', name: 'Linguistics', rank: 'Trained', prerequisites: [] },
    { uuid: 'b', name: 'Mathematics', rank: 'Trained', prerequisites: [] },
    { uuid: 'c', name: 'Xenobiology', rank: 'Expert', prerequisites: ['a'] },
    { uuid: 'd', name: 'Cybernetics', rank: 'Expert', prerequisites: ['z'] },
  ];

  it('offers a whole rank when nothing gates it', () => {
    expect(named(candidates(catalog, 'Trained', []))).toEqual(['a', 'b']);
  });

  it('lists an owned skill disabled rather than dropping it', () => {
    expect(candidates(catalog, 'Trained', ['a'])).toEqual([
      { ...catalog[0], disabled: true },
      { ...catalog[1], disabled: false },
    ]);
  });

  // A bare Expert or Master pick needs a prerequisite already owned; the *_full_set picks hand out
  // the chain themselves and so gate nothing.
  it('gates a pick on an owned prerequisite when asked', () => {
    expect(named(candidates(catalog, 'Expert', ['a'], { requirePrerequisite: true }))).toEqual(['c']);
    expect(named(candidates(catalog, 'Expert', ['a']))).toEqual(['c', 'd']);
  });
});

describe('the steps the wizard walks', () => {
  const K = 'Mothership.CharacterGenerator.Wizard';

  // Walks the same table the wizard renders, so the shell can't reword the book on the way.
  const BOOK = {
    stats: 'step-1-roll-stats',
    saves: 'step-2-roll-saves',
    class: 'step-3-choose-your-class',
    health: 'step-4-roll-health',
    skills: 'step-7-choose-skills',
    gear: 'step-8-roll-loadout-trinket-and-patch',
    finish: 'step-9-finishing',
  };

  const walked = CHARACTER_CREATION.steps.filter((step) => ![5, 6].includes(step.number));
  const fromBook = STEPS.filter((step) => step.id in BOOK);

  it("is the book's steps, in the book's order", () => {
    expect(fromBook.map((step) => BOOK[step.id as keyof typeof BOOK])).toEqual(walked.map((step) => step.id));
  });

  it("gives every step the book's own title", () => {
    expect(fromBook.map((step) => en.get(step.title as string))).toEqual(walked.map((step) => step.title));
  });

  // Steps 5 and 6 ask nothing (Stress starts at 2, Trauma Response is class-printed), so the
  // wizard shows both without stopping on them — every other skipped step must be book-stated, not rolled.
  it('stops on every step the book asks something in, and on no other', () => {
    const skipped = CHARACTER_CREATION.steps.filter(
      (step) => !Object.values(BOOK).includes(step.id),
    );
    expect(skipped.map((step) => step.number)).toEqual([5, 6]);
    expect(skipped.every((step) => step.roll === null)).toBe(true);
  });

  it('numbers what it counts, and stars the one step that asks nothing', () => {
    expect(STEPS.filter((step) => step.numbered === false).map((step) => step.id)).toEqual(['intro']);
    expect(STEP_TOTAL).toBe(STEPS.length - 1);
    expect(STEPS.map((step) => stepNumber(step))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  // The lang-keys spec cannot see these: it does not scan module/ui.
  it('names no string the lang file does not carry', () => {
    const named = [
      `${K}.Intro.Title`, `${K}.Intro.Welcome`, `${K}.Intro.Excavate`,
      `${K}.Adjustments.Title`, `${K}.Adjustments.TitleFor`, `${K}.Adjustments.Choose`,
      `${K}.Health.Wounds`, `${K}.Gear.Loadout`, `${K}.Gear.Trinket`, `${K}.Gear.Credits`,
      `${K}.Gear.Reference`, `${K}.Finish.Ready`, `${K}.Counter`, `${K}.Steps`,
      `${K}.CompleteStep`,
      ...STEPS.flatMap((step) => [step.title, step.instruction])
        .filter((key): key is string => typeof key === 'string'),
    ];

    expect(named.filter((key) => !en.has(key))).toEqual([]);
  });
});

describe('what a step counts as answered', () => {
  const drafted = () => new CharacterDraft({ name: '' });

  const answers = (draft: CharacterDraft) => STEPS.map((step) => step.done(draft));

  it('answers nothing but the front matter on an untouched draft', () => {
    expect(answers(drafted())).toEqual([true, false, false, false, false, false, false, false, false]);
  });

  it('ticks a roll card only once every roll it covers is in', () => {
    const draft = drafted();
    draft.rolled = { ...draft.rolled, strength: 30, speed: 30, intellect: 30 };
    expect(draft.statsRolled).toBe(false);

    draft.rolled = { ...draft.rolled, combat: 30 };
    expect(draft.statsRolled).toBe(true);
  });

  // Step 3 is two questions on two cards: class, then everything the class leaves to the player.
  // An unspent bonus or unchosen pick must gate the second card as hard as the first.
  it('holds step 3 open until the class is chosen and everything it hands over is settled', () => {
    const draft = drafted();
    draft.statChoices = [{ modification: -10, stats: ['strength', 'speed'], chosen: null }];
    expect(draft.classChosen).toBe(false);
    expect(draft.adjustmentsMade).toBe(false);

    draft.classUuid = 'Item.android';
    expect(draft.classChosen).toBe(true);
    expect(draft.adjustmentsMade).toBe(false);

    draft.chooseStat(0, 'strength');
    expect(draft.adjustmentsMade).toBe(true);

    draft.skillGroups = [{ chosen: null, options: [{}, {}] }];
    expect(draft.adjustmentsMade).toBe(false);
  });

  it('holds the last card open until the character has a name', () => {
    const draft = drafted();
    expect(draft.named).toBe(false);

    draft.name = '   ';
    expect(draft.named).toBe(false);

    draft.name = 'Rook Vance';
    expect(draft.named).toBe(true);
  });
});

describe('creation rules the generator applies', () => {
  // Pins the prose rule STARTING_STRESS in draft.svelte.js reads, so the two can't drift.
  it('states starting Stress in prose, and states it as 2', () => {
    const step = CHARACTER_CREATION.steps.find((s) => s.id === 'step-5-gain-stress')!;
    expect(step.roll).toBeNull();
    expect(step.text.join(' ')).toContain("Stress and Minimum Stress both start at 2");
  });
});

describe('the adjustments a class leaves to the player', () => {
  const drafted = () => {
    const draft = new CharacterDraft({ name: 'Rook Vance' });
    draft.statChoices = [{ modification: -10, stats: ['strength', 'speed'], chosen: null }];
    return draft;
  };

  it('moves the bonus with the pick rather than paying it twice', () => {
    const draft = drafted();

    draft.chooseStat(0, 'strength');
    expect(draft.bonus.strength).toBe(-10);

    draft.chooseStat(0, 'speed');
    expect(draft.bonus.strength).toBe(0);
    expect(draft.bonus.speed).toBe(-10);
    expect(draft.statChoicesSpent).toBe(true);
  });

  it('takes a pick back when it is named again', () => {
    const draft = drafted();

    draft.chooseStat(0, 'speed');
    draft.chooseStat(0, 'speed');

    expect(draft.bonus.speed).toBe(0);
    expect(draft.statChoicesSpent).toBe(false);
  });

  it('spends nothing on a stat the class did not offer', () => {
    const draft = drafted();

    draft.chooseStat(0, 'combat');

    expect(draft.bonus.combat).toBe(0);
    expect(draft.statChoicesSpent).toBe(false);
  });
});

describe('the class card the pane prints', () => {
  const teamster = [
    { key: 'strength', value: 5 },
    { key: 'speed', value: 5 },
    { key: 'intellect', value: 5 },
    { key: 'combat', value: 5 },
    { key: 'sanity', value: 10 },
    { key: 'fear', value: 10 },
    { key: 'body', value: 10 },
  ];

  it('prints the Teamster the way the book does', () => {
    expect(collapseAdjustments(teamster)).toEqual([
      { key: 'all_stats', label: 'Mothership.CharacterGenerator.AllStats', value: 5 },
      { key: 'all_saves', label: 'Mothership.CharacterGenerator.AllSaves', value: 10 },
    ]);
  });

  it('leaves an uneven set of adjustments alone', () => {
    const marine = [
      { key: 'combat', value: 10 },
      { key: 'body', value: 10 },
      { key: 'fear', value: 20 },
      { key: 'max_wounds', value: 1 },
    ];

    expect(collapseAdjustments(marine).map((row) => row.key)).toEqual([
      'combat',
      'body',
      'fear',
      'max_wounds',
    ]);
  });

  it('collapses one group without touching the other', () => {
    const rows = collapseAdjustments([...teamster.slice(0, 4), { key: 'sanity', value: 30 }]);

    expect(rows).toEqual([
      { key: 'all_stats', label: 'Mothership.CharacterGenerator.AllStats', value: 5 },
      { key: 'sanity', label: 'Mothership.SanitySave', value: 30 },
    ]);
  });

  // The card is the book's step 3, printed word for word: the same lines, in the same order,
  // with the picked adjustment standing where the book stands it. The classes are read out of
  // the pack sources so what the pane receives is what ships.
  it.each(CLASSES.map((klass) => [klass.name, klass.adjustments.map((row) => row.raw)]))(
    'prints the %s exactly as the character sheet does',
    (name, printed) => {
      const { base_adjustment, selected_adjustment } = JSON.parse(
        readFileSync(fileURLToPath(new URL(`../packs/_source/classes/${name}.json`, import.meta.url)), 'utf8'),
      ).system;
      const rows = classCard(
        Object.entries(base_adjustment)
          .filter(([key, value]) => key !== 'skills_granted' && value !== 0)
          .map(([key, value]) => ({ key, value: value as number })),
        selected_adjustment.choose_stat,
      );

      expect(rows.map((row) => `${signed(row.value)} ${en.get(row.label)}`.toUpperCase())).toEqual(printed);
    },
  );
});

describe('the creation record an actor keeps', () => {
  type Update = { data: Record<string, unknown>; options: Record<string, unknown> };

  const actorWith = (flag: unknown, log: Update[] = []) => ({
    getFlag: (scope: string, key: string) =>
      (scope === 'mothershiprpg' && key === 'creation' ? flag : undefined),
    update: (data: Record<string, unknown>, options: Record<string, unknown>) => {
      log.push({ data, options });
      return Promise.resolve();
    },
  });

  const written = (log: Update[]) =>
    log.at(-1)?.data['flags.mothershiprpg.creation'] as Record<string, unknown>;

  beforeEach(() => {
    const globals = globalThis as Record<string, unknown>;
    globals.foundry = {
      data: { operators: { ForcedReplacement: { create: (value: unknown) => value } } },
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).foundry;
  });

  it('reads back the run it stored, and where the run had got to', async () => {
    const log: Update[] = [];
    const draft = new CharacterDraft({ name: 'Rook Vance' });
    draft.rolled.strength = 35;

    await saveRun(actorWith(null, log), draft, 2);

    expect(written(log)).toMatchObject({ version: RECORD_VERSION, done: false, step: 2 });
    expect((written(log).rolled as Record<string, number>).strength).toBe(35);
    expect(creationRecord(actorWith(written(log)))).toMatchObject({ step: 2 });
  });

  // The sheet is open behind the wizard and shows nothing the record holds.
  it('writes without re-rendering the sheet', async () => {
    const log: Update[] = [];

    await saveRun(actorWith(null, log), new CharacterDraft({ name: 'Rook Vance' }), 0);

    expect(log.at(-1)?.options).toMatchObject({ render: false });
  });

  it('keeps no answers once creation is finished', async () => {
    const log: Update[] = [];

    await finishCreation(actorWith({ version: RECORD_VERSION, done: false, step: 5 }, log));

    expect(written(log)).toEqual({ version: RECORD_VERSION, done: true });
    expect(creationFinished(actorWith(written(log)))).toBe(true);
  });

  // Absence is not an answer: a character made before the wizard kept a record keeps its control.
  it('calls an actor with no record unfinished', () => {
    expect(creationRecord(actorWith(undefined))).toBe(null);
    expect(creationFinished(actorWith(undefined))).toBe(false);
    expect(creationFinished(actorWith({ version: RECORD_VERSION + 1, done: true }))).toBe(false);
  });
});

describe('the portrait and the two longform fields', () => {
  const marine = (draft: CharacterDraft) => {
    draft.classOptions = [{ uuid: 'Item.marine', name: 'Marine', img: 'icons/svg/target.svg' }];
    draft.classUuid = 'Item.marine';
    draft.className = 'Marine';
  };

  it('frames the class art until the player picks something else', () => {
    const draft = new CharacterDraft({ name: 'Rook Vance' });
    marine(draft);
    expect(draft.portraitSrc).toBe('/systems/mothershiprpg/images/class_icons/marine.png');

    draft.portrait = 'worlds/crew/rook.webp';
    expect(draft.portraitSrc).toBe('worlds/crew/rook.webp');
  });

  it("falls back to a homebrew class's own image", () => {
    const draft = new CharacterDraft({ name: 'Rook Vance' });
    draft.classOptions = [{ uuid: 'Item.pilot', name: 'Pilot', img: 'icons/svg/wing.svg' }];
    draft.classUuid = 'Item.pilot';
    draft.className = 'Pilot';
    expect(draft.portraitSrc).toBe('icons/svg/wing.svg');
  });

  it('keeps art the player chose and drops art the last run gave them', () => {
    expect(new CharacterDraft({ name: 'Rook', img: 'worlds/crew/rook.webp' }).portrait)
      .toBe('worlds/crew/rook.webp');
    expect(new CharacterDraft({ name: 'Rook', img: 'icons/svg/mystery-man.svg' }).portrait).toBe('');
    expect(new CharacterDraft({ name: 'Rook', img: '/systems/mothershiprpg/images/class_icons/marine.png' }).portrait)
      .toBe('');
  });

  const applied = async (fill: (draft: CharacterDraft) => void) => {
    let written: Record<string, unknown> = {};
    const granted: [string, number][] = [];
    const draft = new CharacterDraft({
      name: 'Rook Vance',
      items: [],
      update: async (update: Record<string, unknown>) => {
        written = update;
      },
      applyItemRef: async (ref: string, count: number) => {
        granted.push([ref, count]);
      },
    });
    fill(draft);
    await draft.apply();
    return { written, granted };
  };

  it('writes the framed portrait, and the two fields as the HTML the sheet reads', async () => {
    const { written } = await applied((draft) => {
      draft.portrait = 'worlds/crew/rook.webp';
      draft.biography = 'Signed on at Prospero.\nOwed money.\n\nNever says why.';
      draft.notes = 'Owes <Nostromo> money & says nothing.';
    });

    expect(written.img).toBe('worlds/crew/rook.webp');
    expect(written['system.biography'])
      .toBe('<p>Signed on at Prospero.<br>Owed money.</p><p>Never says why.</p>');
    // Typed markup is escaped rather than stored: the sheet prints these two fields back enriched.
    expect(written['system.notes']).toBe('<p>Owes &lt;Nostromo&gt; money &amp; says nothing.</p>');
  });

  it('leaves a blank field alone rather than erasing what the actor carries', async () => {
    const { written } = await applied((draft) => {
      draft.biography = '   \n\n  ';
    });

    expect(written).not.toHaveProperty('system.biography');
    expect(written).not.toHaveProperty('system.notes');
    expect(written).not.toHaveProperty('img');
  });

  it('hands out the loadout the draw brought, and the Unarmed no row names', async () => {
    const { granted } = await applied((draft) => {
      (draft as unknown as { loadout: unknown }).loadout = {
        roll: 0,
        text: 'Scalpel',
        entries: [{ uuid: 'Compendium.mothershiprpg.weapons_1e.Item.scalpel', name: 'Scalpel' }],
      };
    });

    expect(granted).toEqual([
      ['Compendium.mothershiprpg.weapons_1e.Item.scalpel', 1],
      [UNARMED.uuid, 1],
    ]);
  });

  // Neither table links a document, so a run that dropped the text kept nothing of either roll.
  it('keeps the patch and the trinket as the text the table printed', async () => {
    const { written } = await applied((draft) => {
      const rolls = draft as unknown as { patch: unknown; trinket: unknown };
      rolls.patch = { roll: 21, text: '"Front Towards Enemy" (Claymore Mine)', entries: [] };
      rolls.trinket = { roll: 5, text: 'Necklace of Shell Casings', entries: [] };
    });

    expect(written['system.patch.value']).toBe('"Front Towards Enemy" (Claymore Mine)');
    expect(written['system.trinket.value']).toBe('Necklace of Shell Casings');
  });

  it('leaves an unrolled patch alone rather than blanking it', async () => {
    const { written } = await applied(() => {});

    expect(written).not.toHaveProperty('system.patch.value');
    expect(written).not.toHaveProperty('system.trinket.value');
  });

  // A loadout that does name it takes the row's own count rather than one more on top.
  it('grants one Unarmed, whatever the row says', async () => {
    const { granted } = await applied((draft) => {
      (draft as unknown as { loadout: unknown }).loadout = { roll: 0, text: 'Unarmed', entries: [UNARMED] };
    });

    expect(granted).toEqual([[UNARMED.uuid, 1]]);
  });

  // The wizard names the document rather than scanning the compendium for it, so both halves have
  // to be what the content build emits.
  it('names the Unarmed the content build emits', () => {
    const registry = JSON.parse(
      readFileSync(fileURLToPath(new URL('../content/ids.json', import.meta.url)), 'utf8'),
    ) as {
      packs: Record<
        string,
        { compendium: string; documentType: string; documents: Record<string, { id: string }> }
      >;
    };
    const weapons = registry.packs.weapons;

    expect(UNARMED.name).toBe(WEAPONS.find((weapon) => weapon.id === 'unarmed')?.name);
    expect(UNARMED.uuid).toBe(
      `Compendium.mothershiprpg.${weapons.compendium}.${weapons.documentType}.${weapons.documents.unarmed.id}`,
    );
  });
});

describe('the gear the loadout draw brings', () => {
  const SCALPEL = 'Compendium.mothershiprpg.weapons_1e.Item.scalpel';

  beforeEach(() => {
    const globals = globalThis as Record<string, unknown>;
    globals.fromUuid = async () => ({
      draw: async () => ({
        results: [
          { type: 'text', description: `Scalpel<br><br>@UUID[${SCALPEL}]{Scalpel}`, range: [0, 0] },
        ],
      }),
    });
    globals.ui = { notifications: { warn: () => {}, error: () => {} } };
  });

  afterEach(() => {
    const globals = globalThis as Record<string, unknown>;
    delete globals.fromUuid;
    delete globals.ui;
  });

  const drawn = async (kind: 'loadout' | 'trinket') => {
    const draft = new CharacterDraft({ name: 'Rook Vance' });
    draft.classUuid = 'Item.marine';
    await draft.rollTable(kind);
    return (draft[kind] as unknown as { entries: { name: string }[] }).entries.map((entry) => entry.name);
  };

  // Unarmed is granted at the end rather than drawn: the pane lists what the table rolled, and no
  // loadout row names a fist.
  it('leaves the loadout draw as the table wrote it', async () => {
    expect(await drawn('loadout')).toEqual(['Scalpel']);
  });

  it('leaves the other draws as the table wrote them', async () => {
    expect(await drawn('trinket')).toEqual(['Scalpel']);
  });
});

describe('the skills a class hands out', () => {
  const skill = (uuid: string, name: string, rank: string, prerequisite_ids: string[] = []) => ({
    uuid,
    name,
    type: 'skill',
    system: {
      rank,
      prerequisite_ids,
      bonus: rank === 'Trained' ? 10 : 15,
      description: `<p>What ${name} is  for.</p>`,
    },
  });

  const CATALOG = [
    skill('sk-linguistics', 'Linguistics', 'Trained'),
    skill('sk-mathematics', 'Mathematics', 'Trained'),
    skill('sk-rimwise', 'Rimwise', 'Trained'),
    skill('sk-zero-g', 'Zero-G', 'Trained'),
    skill('sk-xenobiology', 'Xenobiology', 'Expert', ['sk-linguistics']),
    skill('sk-cybernetics', 'Cybernetics', 'Expert', ['sk-mathematics']),
    skill('sk-hyperspace', 'Hyperspace', 'Master', ['sk-cybernetics']),
  ];

  const picks = (over: Record<string, number> = {}) => ({
    trained: 0, expert: 0, master: 0, expert_full_set: 0, master_full_set: 0, ...over,
  });

  const ANDROID = {
    uuid: 'Item.android',
    name: 'Android',
    img: 'icons/svg/clockwork.svg',
    type: 'class',
    system: {
      description: '<p>Androids are a terrifying and exciting addition to any crew.</p>',
      trauma_response: 'Fear Save',
      roll_tables: { loadout: '', trinket: '', patch: '' },
      base_adjustment: {
        strength: 0, speed: 0, intellect: 20, combat: 0,
        sanity: 0, fear: 60, body: 0, max_wounds: 0,
        skills_granted: ['sk-linguistics'],
      },
      selected_adjustment: {
        choose_stat: [{ modification: -10, stats: ['strength', 'speed', 'intellect', 'combat'] }],
        choose_skill_and: picks({ expert: 1 }),
        choose_skill_or: [[
          { name: 'Two Trained', ...picks({ trained: 2 }), from_list: [] },
          { name: 'One Expert Set', ...picks({ expert_full_set: 1 }), from_list: ['sk-rimwise'] },
        ]],
      },
    },
  };

  // The book's own wording: "1 Master Skill, and an Expert and Trained Skill prerequisite".
  const SCIENTIST = {
    uuid: 'Item.scientist',
    name: 'Scientist',
    img: 'icons/svg/lab.svg',
    type: 'class',
    system: {
      description: '<p>Scientists slice things open.</p>',
      trauma_response: 'Sanity Save',
      roll_tables: { loadout: '', trinket: '', patch: '' },
      base_adjustment: {
        strength: 0, speed: 0, intellect: 10, combat: 0,
        sanity: 30, fear: 0, body: 0, max_wounds: 0,
        skills_granted: [],
      },
      selected_adjustment: {
        choose_stat: [],
        choose_skill_and: picks({ master_full_set: 1, trained: 1 }),
        choose_skill_or: [],
      },
    },
  };

  const WORLD = [...CATALOG, ANDROID, SCIENTIST];

  beforeEach(() => {
    const globals = globalThis as Record<string, unknown>;
    globals.game = { items: [...WORLD], packs: [] };
    // Read through `game` rather than closing over WORLD, so a test can add a class of its own.
    globals.fromUuid = async (uuid: string) =>
      (globals.game as { items: { uuid: string }[] }).items.find((doc) => doc.uuid === uuid) ?? null;
    globals.ui = { notifications: { warn: () => {}, error: () => {} } };
  });

  afterEach(() => {
    const globals = globalThis as Record<string, unknown>;
    delete globals.game;
    delete globals.fromUuid;
    delete globals.ui;
  });

  const drafted = async () => {
    const draft = new CharacterDraft({ name: 'Rook Vance' });
    await draft.load();
    await draft.chooseClass('Item.android');
    return draft;
  };

  const keys = (draft: CharacterDraft) => draft.skillSlots.map((slot: { key: string }) => slot.key);
  const named = (draft: CharacterDraft) => draft.skills.map((entry: { name: string }) => entry.name);

  it('offers the class\u2019s packages unanswered, and its own picks as slots', async () => {
    const draft = await drafted();

    expect(draft.skillGroups.map((group: { chosen: number | null }) => group.chosen)).toEqual([null]);
    expect(keys(draft)).toEqual(['class:expert:0:Expert']);
    expect(named(draft)).toEqual(['Linguistics']);
    expect(draft.skillsPicked).toBe(false);
  });

  // The either/or is answered on the adjustments pane, apart from the picks it funds.
  it('holds the class\u2019s either/or bonus open until a package is taken', async () => {
    const draft = await drafted();
    expect(draft.skillGroupsChosen).toBe(false);

    draft.chooseSkillOption(0, 0);
    expect(draft.skillGroupsChosen).toBe(true);
  });

  it('replaces one package\u2019s slots with the next when the package changes', async () => {
    const draft = await drafted();

    draft.chooseSkillOption(0, 0);
    expect(keys(draft)).toEqual([
      'class:expert:0:Expert',
      'group-0:trained:0:Trained',
      'group-0:trained:1:Trained',
    ]);

    draft.chooseSkillOption(0, 1);
    // A set's slots run bottom up: its Expert is gated until its Trained slot is answered.
    expect(keys(draft)).toEqual([
      'class:expert:0:Expert',
      'group-0:expert_full_set:0:Trained',
      'group-0:expert_full_set:0:Expert',
    ]);
    expect(named(draft)).toEqual(['Linguistics', 'Rimwise']);
  });

  // A bare Expert pick needs an owned prerequisite; a set hands out the chain itself, so its
  // Expert slot is not gated.
  it('offers a gated pick only what a skill already held unlocks', async () => {
    const draft = await drafted();
    draft.chooseSkillOption(0, 0);

    const experts = () => Object.fromEntries(
      draft.skillTree.filter((skill: { rank: string }) => skill.rank === 'Expert')
        .map((skill: { name: string; state: string }) => [skill.name, skill.state]),
    );
    expect(experts()).toEqual({ Xenobiology: 'available', Cybernetics: 'unavailable' });

    draft.toggleSkill('sk-mathematics');
    expect(experts()).toEqual({ Xenobiology: 'available', Cybernetics: 'available' });
  });

  it('marks the full tree as granted, picked, available, or unavailable', async () => {
    const draft = await drafted();
    draft.chooseSkillOption(0, 0);

    const states = () => Object.fromEntries(
      draft.skillTree.map((skill: { name: string; state: string }) => [skill.name, skill.state]),
    );
    expect(states()).toMatchObject({
      Linguistics: 'granted',
      Mathematics: 'available',
      Rimwise: 'available',
      Xenobiology: 'available',
      Cybernetics: 'unavailable',
    });

    draft.toggleSkill('sk-mathematics');
    expect(states()).toMatchObject({ Mathematics: 'picked', Cybernetics: 'available' });
  });

  // A spent rank is answered by taking a pick back, a gate by taking its prerequisite — the
  // picker distinguishes the two even though they render as the same grey row.
  it('says whether an unavailable skill wants a prerequisite or a free pick', async () => {
    const draft = await drafted();
    draft.chooseSkillOption(0, 0);

    const reason = (uuid: string) =>
      draft.skillTree.find((skill: { uuid: string }) => skill.uuid === uuid)?.reason;

    expect(reason('sk-cybernetics')).toBe('gated');
    expect(reason('sk-zero-g')).toBe(null);

    draft.toggleSkill('sk-mathematics');
    draft.toggleSkill('sk-rimwise');

    expect(draft.skillBudget.Trained).toBe(0);
    expect(reason('sk-zero-g')).toBe('spent');
  });

  it('empties a gated pick when the pick it stood on changes', async () => {
    const draft = await drafted();
    draft.chooseSkillOption(0, 0);
    draft.toggleSkill('sk-mathematics');
    draft.toggleSkill('sk-cybernetics');
    draft.toggleSkill('sk-rimwise');
    // Granted first, then slots in pane order: the class's own pick, then the package's.
    expect(named(draft)).toEqual(['Linguistics', 'Cybernetics', 'Mathematics', 'Rimwise']);
    expect(draft.skillsPicked).toBe(true);

    draft.toggleSkill('sk-mathematics');

    expect(named(draft)).toEqual(['Linguistics', 'Rimwise']);
    expect(draft.skillsPicked).toBe(false);
  });

  // Descriptions are stored as HTML and printed as text, for the sentence under each skill.
  it('carries the sentence and the bonus the book prints with each skill', async () => {
    const draft = await drafted();
    draft.chooseSkillOption(0, 0);

    expect(draft.skillTree.find((skill: { name: string }) => skill.name === 'Linguistics')).toMatchObject({
      bonus: 10,
      summary: 'What Linguistics is for.',
    });
  });

  // Carries both fixed adjustments and the set a flexible choice may spend, so the pane never
  // promises a choice it can't offer.
  it('loads the details the class pane shows after a class is chosen', async () => {
    const draft = new CharacterDraft({ name: 'Rook Vance' });
    await draft.load();

    expect(draft.classOptions).toEqual([
      {
        uuid: 'Item.android',
        name: 'Android',
        img: 'icons/svg/clockwork.svg',
        source: 'world.Item',
        description: 'Androids are a terrifying and exciting addition to any crew.',
        adjustments: [{ key: 'intellect', value: 20 }, { key: 'fear', value: 60 }],
        choices: [{ modification: -10, stats: ['strength', 'speed', 'intellect', 'combat'] }],
        skills: {
          granted: ['Linguistics'],
          picks: [{ label: 'Mothership.CharacterGenerator.Pick.Expert', count: 1 }],
          groups: [[
            { name: 'Two Trained', picks: [{ label: 'Mothership.CharacterGenerator.Pick.TrainedPlural', count: 2 }] },
            { name: 'One Expert Set', picks: [{ label: 'Mothership.CharacterGenerator.Pick.ExpertSet', count: 1 }] },
          ]],
        },
      },
      {
        uuid: 'Item.scientist',
        name: 'Scientist',
        img: 'icons/svg/lab.svg',
        source: 'world.Item',
        description: 'Scientists slice things open.',
        adjustments: [{ key: 'intellect', value: 10 }, { key: 'sanity', value: 30 }],
        choices: [],
        skills: {
          granted: [],
          // Book order, widest promise first: Master set headline, Trained skill footnote.
          picks: [
            { label: 'Mothership.CharacterGenerator.Pick.MasterSet', count: 1 },
            { label: 'Mothership.CharacterGenerator.Pick.Trained', count: 1 },
          ],
          groups: [],
        },
      },
    ]);
  });

  describe('the run a reopened wizard replays', () => {
    const answered = async () => {
      const draft = await drafted();
      draft.rolled.strength = 35;
      draft.rolled.sanity = 22;
      draft.chooseStat(0, 'speed');
      draft.chooseSkillOption(0, 0);
      draft.toggleSkill('sk-mathematics');
      draft.toggleSkill('sk-cybernetics');
      draft.toggleSkill('sk-rimwise');
      draft.name = 'Rook Vance';
      return draft;
    };

    const resumed = async (record: unknown) => {
      const draft = new CharacterDraft({ name: 'Rook Vance' });
      await draft.load();
      await draft.restore(record);
      return draft;
    };

    it('comes back with the same answers, bonuses and picks', async () => {
      const before = await answered();

      const after = await resumed(before.answers());

      expect(after.rolled).toEqual(before.rolled);
      expect(after.bonus).toEqual(before.bonus);
      expect(after.className).toBe('Android');
      expect(named(after)).toEqual(named(before));
      expect(keys(after)).toEqual(keys(before));
      expect(after.skillsPicked).toBe(true);
    });

    // The bonus a choice moves is applied by `chooseStat`, so a replay that assigned the answer
    // instead would restore the pick and lose the number under it.
    it('restores the stat choice with its bonus, not just its answer', async () => {
      const after = await resumed((await answered()).answers());

      expect(after.statChoices[0].chosen).toBe('speed');
      expect(after.bonus.speed).toBe(-10);
      expect(after.statChoicesSpent).toBe(true);
    });

    it('drops a class the world has lost, and the answers that stood on it', async () => {
      const record = (await answered()).answers();
      const world = (globalThis as Record<string, unknown>).game as { items: { uuid: string }[] };
      world.items = world.items.filter((doc) => doc.uuid !== 'Item.android');

      const after = await resumed(record);

      expect(after.classChosen).toBe(false);
      expect(after.skillSlots).toEqual([]);
      // The rolls were the player's, not the class's — those survive.
      expect(after.rolled.strength).toBe(35);
    });

    // Opening the window to read a class card is not a run worth remembering.
    it('counts a draft as started only once something is answered', async () => {
      const draft = new CharacterDraft({ name: 'Rook Vance' });
      await draft.load();
      expect(draft.started).toBe(false);

      draft.rolled.combat = 30;
      expect(draft.started).toBe(true);
    });
  });

  // The Master pick is not three free picks: gating the set's upper slots is the whole rule,
  // otherwise a Scientist could finish with an unrelated Expert and Trained skill instead of the chain.
  describe('a full set', () => {
    const scientist = async () => {
      const draft = new CharacterDraft({ name: 'Rook Vance' });
      await draft.load();
      await draft.chooseClass('Item.scientist');
      return draft;
    };

    const stateOf = (draft: CharacterDraft, uuid: string) =>
      draft.skillTree.find((skill: { uuid: string }) => skill.uuid === uuid)?.state;

    it('opens only its base until something stands under the rest', async () => {
      const draft = await scientist();

      expect(keys(draft)).toEqual([
        'class:master_full_set:0:Trained',
        'class:master_full_set:0:Expert',
        'class:master_full_set:0:Master',
        'class:trained:0:Trained',
      ]);
      expect(draft.skillBudget).toEqual({ Trained: 2, Expert: 1, Master: 1 });
      expect(stateOf(draft, 'sk-mathematics')).toBe('available');
      expect(stateOf(draft, 'sk-cybernetics')).toBe('unavailable');
      expect(stateOf(draft, 'sk-hyperspace')).toBe('unavailable');
    });

    it('lets each rank up only what the rank beneath it bought', async () => {
      const draft = await scientist();

      draft.toggleSkill('sk-mathematics');
      expect(stateOf(draft, 'sk-cybernetics')).toBe('available');
      // Xenobiology stands on Linguistics, which nothing holds — the Expert slot is not a free pick.
      expect(stateOf(draft, 'sk-xenobiology')).toBe('unavailable');
      expect(stateOf(draft, 'sk-hyperspace')).toBe('unavailable');

      draft.toggleSkill('sk-cybernetics');
      expect(stateOf(draft, 'sk-hyperspace')).toBe('available');

      draft.toggleSkill('sk-hyperspace');
      draft.toggleSkill('sk-rimwise');
      expect(named(draft)).toEqual(['Mathematics', 'Cybernetics', 'Hyperspace', 'Rimwise']);
      expect(draft.skillsPicked).toBe(true);
    });

    // Xenobiology is a terminal Expert: taking it would spend the set's one Expert pick and leave
    // the Master slot above it unfillable, so the picker refuses it rather than stranding the player.
    it('refuses an Expert that would leave the Master pick standing on nothing', async () => {
      const draft = await scientist();
      draft.toggleSkill('sk-linguistics');

      expect(stateOf(draft, 'sk-xenobiology')).toBe('unavailable');
      expect(draft.skillTree.find((skill: { uuid: string }) => skill.uuid === 'sk-xenobiology')?.reason)
        .toBe('strands');

      draft.toggleSkill('sk-xenobiology');
      expect(named(draft)).toEqual(['Linguistics']);
    });

    // The rule reads the slots, not the class: a second Expert pick can still buy the Master's
    // prerequisite, so the first Expert pick must not be refused. Homebrew classes write this shape.
    it('allows a terminal Expert while another Expert pick can still feed the Master', async () => {
      const globals = globalThis as unknown as { game: { items: unknown[] } };
      globals.game.items = [...WORLD, {
        ...SCIENTIST,
        uuid: 'Item.homebrew',
        name: 'Wildcat',
        system: {
          ...SCIENTIST.system,
          selected_adjustment: {
            ...SCIENTIST.system.selected_adjustment,
            choose_skill_and: picks({ trained: 2, expert: 2, master: 1 }),
          },
        },
      }];
      const draft = new CharacterDraft({ name: 'Rook Vance' });
      await draft.load();
      await draft.chooseClass('Item.homebrew');

      draft.toggleSkill('sk-linguistics');
      draft.toggleSkill('sk-mathematics');
      expect(stateOf(draft, 'sk-xenobiology')).toBe('available');

      // Spending the second Expert pick on the Master's prerequisite settles it either way round.
      draft.toggleSkill('sk-cybernetics');
      expect(stateOf(draft, 'sk-xenobiology')).toBe('available');
    });

    it('drops the whole chain when what it stands on is taken back', async () => {
      const draft = await scientist();
      draft.toggleSkill('sk-mathematics');
      draft.toggleSkill('sk-cybernetics');
      draft.toggleSkill('sk-hyperspace');
      draft.toggleSkill('sk-rimwise');

      draft.toggleSkill('sk-mathematics');

      // Rimwise was nobody's prerequisite, so the free pick stands while the set empties.
      expect(named(draft)).toEqual(['Rimwise']);
      expect(draft.skillsPicked).toBe(false);
    });
  });

  it('cannot be given the same skill twice', async () => {
    const draft = await drafted();
    draft.chooseSkillOption(0, 0);

    const linguistics = draft.skillTree.find((skill: { uuid: string }) => skill.uuid === 'sk-linguistics');
    expect(linguistics?.state).toBe('granted');
  });
});
