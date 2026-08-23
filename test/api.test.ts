// @vitest-environment jsdom — the damage verb resolves its actor from the card's own DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearChatActions, runChatAction } from '../module/chat/actions.ts';
import { parseAction, type ChatAction } from '../module/chat/enrichers.ts';
import {
  clearFoundryStubs,
  installChat,
  installI18n,
  installNotifications,
  installRoll,
  installSettings,
  type Notifications,
} from './foundry-stubs.ts';

const prompts = vi.hoisted(() => ({
  chooseAdvantage: vi.fn(),
  chooseAttribute: vi.fn(),
  chooseSkill: vi.fn(),
  askReload: vi.fn(),
  outOfAmmo: vi.fn(),
  chooseCover: vi.fn(),
  chooseSave: vi.fn(),
  chooseStress: vi.fn(),
  chooseWound: vi.fn(),
  noCharacter: vi.fn(async () => undefined),
}));

vi.mock('../module/dialogs/prompts.ts', () => prompts);

const api = await import('../module/api/api.ts');

type Globals = Record<string, unknown>;
const globals = globalThis as unknown as Globals;

interface FakeActor {
  readonly name: string;
  readonly calls: string[];
  [method: string]: unknown;
}

const METHODS = [
  'rollStat',
  'promptCheck',
  'rollSkill',
  'rollWeapon',
  'rollPanic',
  'rollRestSave',
  'rollTable',
  'modify',
  'applyItem',
  'printDescription',
] as const;

/** An actor's items are a Foundry collection: iterable, and addressable by id. */
function collection(items: { id?: string }[]) {
  return {
    [Symbol.iterator]: () => items[Symbol.iterator](),
    get: (id: string) => items.find((item) => item.id === id),
    map: <T,>(fn: (item: object) => T) => items.map(fn),
    find: (fn: (item: object) => boolean) => items.find(fn),
  };
}

function actor(name: string, items: { id?: string }[] = []): FakeActor {
  const calls: string[] = [];
  const fake: FakeActor = { name, calls, items: collection(items) };
  for (const method of METHODS) {
    fake[method] = vi.fn(async (...args: unknown[]) => {
      calls.push(method);
      return args;
    });
  }
  return fake;
}

function assign(character: FakeActor | null): void {
  (globals.game as Globals).user = { id: 'user1', character };
}

function control(actors: FakeActor[]): void {
  globals.canvas = { tokens: { controlled: actors.map((entry) => ({ actor: entry })) } };
}

let notifications: Notifications;

beforeEach(() => {
  prompts.noCharacter.mockClear();
  installI18n({ 'Mothership.Errors.NoItemNamed': '{actor} has no item named {name}.' });
  installSettings({ macroTarget: 'character' });
  installChat();
  notifications = installNotifications();
  assign(null);
  control([]);
});

afterEach(() => {
  clearChatActions();
  clearFoundryStubs();
  delete globals.canvas;
});

describe('forTargetActors', () => {
  it('runs against the player’s assigned character', async () => {
    const sarah = actor('Sarah');
    assign(sarah);

    await expect(api.forTargetActors((target) => target.name)).resolves.toEqual(['Sarah']);
    expect(prompts.noCharacter).not.toHaveBeenCalled();
  });

  it('runs against every controlled token when macros are aimed at tokens', async () => {
    installSettings({ macroTarget: 'token' });
    control([actor('One'), actor('Two')]);

    await expect(api.forTargetActors((target) => target.name)).resolves.toEqual(['One', 'Two']);
  });

  it('ignores the assigned character in token mode, and the tokens in character mode', async () => {
    const sarah = actor('Sarah');
    assign(sarah);
    control([actor('Token')]);

    await expect(api.forTargetActors((target) => target.name)).resolves.toEqual(['Sarah']);
    installSettings({ macroTarget: 'token' });
    await expect(api.forTargetActors((target) => target.name)).resolves.toEqual(['Token']);
  });

  it('opens the prompt and does nothing when no character is assigned', async () => {
    const ran = vi.fn();

    await expect(api.forTargetActors(ran)).resolves.toEqual([]);
    expect(ran).not.toHaveBeenCalled();
    expect(prompts.noCharacter).toHaveBeenCalledWith('character');
  });

  it('names the token setting in the prompt when that is what is selected', async () => {
    installSettings({ macroTarget: 'token' });

    await expect(api.forTargetActors(vi.fn())).resolves.toEqual([]);
    expect(prompts.noCharacter).toHaveBeenCalledWith('token');
  });

  it('falls back to the character when the setting holds nothing it knows', async () => {
    installSettings({});
    expect(api.macroTarget()).toBe('character');
  });

  it('awaits each actor before starting the next', async () => {
    installSettings({ macroTarget: 'token' });
    control([actor('One'), actor('Two')]);
    const order: string[] = [];

    await api.forTargetActors(async (target) => {
      order.push(`start ${target.name}`);
      await Promise.resolve();
      order.push(`end ${target.name}`);
    });

    expect(order).toEqual(['start One', 'end One', 'start Two', 'end Two']);
  });
});

describe('the verbs', () => {
  const DELEGATIONS: readonly [keyof typeof api.NEW_API, string, readonly unknown[]][] = [
    ['rollStat', 'rollStat', ['body', {}]],
    ['promptCheck', 'promptCheck', [{}]],
    ['rollSkill', 'rollSkill', ['skill1', {}]],
    ['rollWeapon', 'rollWeapon', ['wpn1', {}]],
    ['rollPanic', 'rollPanic', [{}]],
    ['rollRestSave', 'rollRestSave', [{}]],
    ['rollTable', 'rollTable', ['gunshot', {}]],
    ['modify', 'modify', ['system.other.stress.value', { kind: 'amount', amount: 1 }]],
  ];

  it.each(DELEGATIONS)('%s hands its arguments to every target', async (verb, method, args) => {
    const sarah = actor('Sarah');
    assign(sarah);

    await (api.NEW_API[verb] as (...call: unknown[]) => Promise<unknown>)(...args);

    expect(sarah[method]).toHaveBeenCalledWith(...args);
  });

  describe('the verbs that ask first', () => {
    it('promptStress applies the amount the prompt answered with', async () => {
      const sarah = actor('Sarah');
      assign(sarah);
      prompts.chooseStress.mockResolvedValue({ kind: 'amount', amount: -2 });

      await api.promptStress('relieve');

      expect(prompts.chooseStress).toHaveBeenCalledWith('relieve');
      expect(sarah.modify).toHaveBeenCalledWith('system.other.stress.value', { kind: 'amount', amount: -2 });
    });

    it('promptSave rolls the Save the prompt answered with', async () => {
      const sarah = actor('Sarah');
      assign(sarah);
      prompts.chooseSave.mockResolvedValue({ stat: 'fear', advantage: 'advantage' });

      await api.promptSave();

      expect(sarah.rollStat).toHaveBeenCalledWith('fear', { advantage: 'advantage' });
    });

    it('promptWound rolls the table the prompt answered with', async () => {
      const sarah = actor('Sarah');
      assign(sarah);
      prompts.chooseWound.mockResolvedValue({ key: 'gunshot', advantage: 'none' });

      await api.promptWound();

      expect(sarah.rollTable).toHaveBeenCalledWith('gunshot', { advantage: 'none' });
    });

    it('does nothing at all when the prompt is dismissed', async () => {
      const sarah = actor('Sarah');
      assign(sarah);
      prompts.chooseStress.mockResolvedValue(null);
      prompts.chooseSave.mockResolvedValue(null);
      prompts.chooseWound.mockResolvedValue(null);

      await expect(api.promptStress('gain')).resolves.toEqual([]);
      await expect(api.promptSave()).resolves.toEqual([]);
      await expect(api.promptWound()).resolves.toEqual([]);
      expect(sarah.calls).toEqual([]);
    });
  });

  it('publishes exactly the surface the content and the sheets call', () => {
    expect(Object.keys(api.NEW_API).sort()).toEqual(
      [
        'MothershipActor',
        'MothershipItem',
        'applyCondition',
        'forTargetActors',
        'modify',
        'promptCheck',
        'promptSave',
        'promptStress',
        'promptWound',
        'rollItem',
        'rollPanic',
        'rollRestSave',
        'rollSkill',
        'rollStat',
        'rollTable',
        'rollWeapon',
        'targetActors',
      ].sort(),
    );
  });
});

describe('rollItem', () => {
  const item = (id: string, type: string, name: string) => ({ id, type, name });

  it('attacks with a weapon, rolls a skill, and describes anything else', async () => {
    const sarah = actor('Sarah', [
      item('w1', 'weapon', 'Revolver'),
      item('s1', 'skill', 'Rimwise'),
      item('g1', 'item', 'Rebreather'),
    ]);
    assign(sarah);

    await api.rollItem('Revolver');
    await api.rollItem('Rimwise');
    await api.rollItem('Rebreather');

    expect(sarah.calls).toEqual(['rollWeapon', 'rollSkill', 'printDescription']);
    expect(sarah.rollWeapon).toHaveBeenCalledWith('w1');
  });

  it('warns before it dereferences anything, when no such item is carried', async () => {
    const sarah = actor('Sarah');
    assign(sarah);

    await expect(api.rollItem('Nothing')).resolves.toEqual([null]);
    expect(notifications.warnings).toEqual(['Sarah has no item named Nothing.']);
  });
});

describe('applyCondition', () => {
  it('resolves the reference before it touches an actor, and says so when it cannot', async () => {
    const sarah = actor('Sarah');
    assign(sarah);

    await expect(api.applyCondition('coward', 1)).resolves.toEqual([]);
    expect(sarah.calls).toEqual([]);
    expect(notifications.errors).toHaveLength(1);
  });

  it('gives the resolved document to every target', async () => {
    const document = { name: 'Bleeding', img: 'b.png', type: 'condition', system: {}, toObject: () => ({}) };
    globals.game = { ...(globals.game as Globals), items: { get: () => document } };
    const sarah = actor('Sarah');
    assign(sarah);

    await api.applyCondition('pxtF1NfletmoFFGV', 2);

    expect(sarah.applyItem).toHaveBeenCalledWith(document, 2);
  });

  it('resolves an unmapped slug as the bare id an old macro already passes', () => {
    expect(api.conditionRef('anything')).toBe('anything');
  });
});

describe('registerActions', () => {
  const action = (text: string): ChatAction => {
    const parsed = parseAction(text);
    if (!parsed.ok) throw new Error(text);
    return parsed.action;
  };

  it('claims the apply verb the enrichers already render', async () => {
    const sarah = actor('Sarah');
    assign(sarah);
    api.registerActions();

    await runChatAction(action('@Apply[coward]'), {
      event: null as unknown as MouseEvent,
      button: null as unknown as HTMLElement,
    });

    // Nothing resolved the slug, so the miss is reported rather than swallowed.
    expect(notifications.errors).toHaveLength(1);
    expect(notifications.warnings).toEqual([]);
  });

  // Every other verb is aimed by the macro-target setting; a damage button is the card's own.
  describe('the damage verb', () => {
    const card = (attributes: Record<string, string>, messageId?: string): HTMLElement => {
      const root = document.createElement('div');
      for (const [key, value] of Object.entries(attributes)) root.setAttribute(key, value);
      const button = document.createElement('button');
      root.append(button);

      if (messageId === undefined) return button;
      // Foundry's own wrapper around every rendered message.
      const wrapper = document.createElement('li');
      wrapper.dataset.messageId = messageId;
      wrapper.append(root);
      return button;
    };

    const weapon = { id: 'wpn1', name: 'Revolver', img: 'gun.png', type: 'weapon', system: { damage: '1d10' } };

    /** A message that remembers its card, as `postCard` leaves one. */
    function posted(options: { remembers?: boolean; mayEdit?: boolean } = {}) {
      const stored = { kind: 'check', data: { msgHeader: 'Revolver', flavorText: 'offer' } };
      return {
        update: vi.fn(async () => undefined),
        canUserModify: () => options.mayEdit ?? true,
        getFlag: () => (options.remembers ?? true ? stored : undefined),
      };
    }

    function withMessage(message: object) {
      globals.game = { ...(globals.game as Globals), messages: { get: () => message } };
      globals.foundry = {
        applications: { handlebars: { renderTemplate: async () => '<div>rolled</div>' } },
      };
    }

    it('rolls the card’s own weapon, for the card’s own actor', async () => {
      const sarah = actor('Sarah');
      const selected = actor('Someone Else');
      assign(selected);
      globals.game = { ...(globals.game as Globals), actors: { get: () => sarah } };
      api.registerActions();

      await runChatAction(action('@Damage[4d10]'), {
        event: null as unknown as MouseEvent,
        button: card({ 'data-actor-id': 'actor1', 'data-item-id': 'wpn1' }),
      });

      expect(sarah.rollWeapon).toHaveBeenCalledWith('wpn1', { roll: 'damage', damage: '4d10' });
      expect(selected.calls).toEqual([]);
    });

    it('prefers the token, whose unlinked actor shares its id with every other copy', async () => {
      const base = actor('Base');
      const onScene = actor('On Scene');
      globals.game = { ...(globals.game as Globals), actors: { get: () => base } };
      globals.canvas = { tokens: { controlled: [], get: () => ({ actor: onScene }) } };
      api.registerActions();

      await runChatAction(action('@Damage[1d10]'), {
        event: null as unknown as MouseEvent,
        button: card({ 'data-actor-id': 'actor1', 'data-item-id': 'wpn1', 'data-token-id': 'tok1' }),
      });

      expect(onScene.rollWeapon).toHaveBeenCalledWith('wpn1', { roll: 'damage', damage: '1d10' });
      expect(base.calls).toEqual([]);
    });

    // PSG 29 — the card's own actor makes the save, not whoever clicks it and not the selection.
    it('rolls a Death Save for the card’s actor, not the clicker’s', async () => {
      const dying = actor('Dying');
      const selected = actor('Someone Else');
      assign(selected);
      globals.game = { ...(globals.game as Globals), actors: { get: () => dying } };
      api.registerActions();

      await runChatAction(action('@Death[+]'), {
        event: null as unknown as MouseEvent,
        button: card({ 'data-actor-id': 'actor1' }),
      });

      expect(dying.rollTable).toHaveBeenCalledWith('death', { advantage: 'advantage' });
      expect(selected.calls).toEqual([]);
    });

    it('says so rather than guessing when the card names neither', async () => {
      installI18n({ 'Mothership.Errors.NoDamageSource': 'This card names no actor and weapon.' });
      api.registerActions();

      await runChatAction(action('@Damage[1d10]'), {
        event: null as unknown as MouseEvent,
        button: card({}),
      });

      expect(notifications.warnings).toEqual(['This card names no actor and weapon.']);
    });

    it('rewrites the card it was clicked in, rather than posting a second one', async () => {
      const sarah = actor('Sarah', [weapon]);
      const message = posted();
      globals.game = { ...(globals.game as Globals), actors: { get: () => sarah } };
      withMessage(message);
      installI18n({ 'Mothership.Chat.DamageDealt': 'You inflict {damage} points of damage.' });
      const rolls = installRoll([{ faces: 10, result: 9 }]);
      api.registerActions();

      await runChatAction(action('@Damage[4d10]'), {
        event: null as unknown as MouseEvent,
        button: card({ 'data-actor-id': 'actor1', 'data-item-id': 'wpn1' }, 'msg1'),
      });

      // Wearing the GM's damage colorset, exactly as the auto-rolled line does.
      expect(rolls.formulas).toEqual(['4d10[damage]']);
      const [update] = message.update.mock.lastCall as unknown as [Record<string, unknown>];
      expect(update.content).toBe('<div>rolled</div>');
      expect(update['flags.mothershiprpg.card.data.damageTotal']).toBe(9);
      expect(update['flags.mothershiprpg.card.data.flavorText']).toContain(
        'You inflict <strong>9</strong> points of damage.',
      );
      expect(sarah.rollWeapon).not.toHaveBeenCalled();
    });

    // Posting a card of their own would just be the same roll by the back door.
    it('refuses a card this user does not own, rather than rolling it elsewhere', async () => {
      const sarah = actor('Sarah', [weapon]);
      globals.game = { ...(globals.game as Globals), actors: { get: () => sarah } };
      const message = posted({ mayEdit: false });
      withMessage(message);
      installI18n({ 'Mothership.Errors.NotYourCard': 'That roll is not yours to make.' });
      api.registerActions();

      await runChatAction(action('@Damage[4d10]'), {
        event: null as unknown as MouseEvent,
        button: card({ 'data-actor-id': 'actor1', 'data-item-id': 'wpn1' }, 'msg1'),
      });

      expect(message.update).not.toHaveBeenCalled();
      expect(sarah.rollWeapon).not.toHaveBeenCalled();
      expect(notifications.warnings).toEqual(['That roll is not yours to make.']);
    });

    // Not a permission failure — a card posted before the system kept its data cannot be rewritten.
    it('posts a damage card when the message kept no record of the card', async () => {
      const sarah = actor('Sarah', [weapon]);
      globals.game = { ...(globals.game as Globals), actors: { get: () => sarah } };
      const message = posted({ remembers: false });
      withMessage(message);
      api.registerActions();

      await runChatAction(action('@Damage[4d10]'), {
        event: null as unknown as MouseEvent,
        button: card({ 'data-actor-id': 'actor1', 'data-item-id': 'wpn1' }, 'msg1'),
      });

      expect(message.update).not.toHaveBeenCalled();
      expect(sarah.rollWeapon).toHaveBeenCalledWith('wpn1', { roll: 'damage', damage: '4d10' });
    });
  });
});
