// Installers merge into the same game/foundry globals, so a spec can install only
// the pieces its flow touches without one installer wiping another.

type Globals = Record<string, unknown>;

export interface RolledDie {
  readonly faces: number;
  readonly result: number;
}

function branch(root: Globals, key: string): Globals {
  if (typeof root[key] !== 'object' || root[key] === null) root[key] = {};
  return root[key] as Globals;
}

function gameStub(): Globals {
  return branch(globalThis as Globals, 'game');
}

function foundryStub(): Globals {
  return branch(globalThis as Globals, 'foundry');
}

/** Mimics `game.i18n.format`'s `{key}` substitution. */
function interpolate(template: string, data: Record<string, string | number>): string {
  return Object.entries(data).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

export function installI18n(entries: Record<string, string> = {}): void {
  gameStub().i18n = {
    localize: (key: string) => entries[key] ?? key,
    format: (key: string, data: Record<string, string | number>) => interpolate(entries[key] ?? key, data),
    has: (key: string) => Object.hasOwn(entries, key),
  };
  gameStub().user = { id: 'user1' };
}

export function installSettings(values: Record<string, unknown>): void {
  gameStub().settings = { get: (_namespace: string, key: string) => values[key] };
}

export interface RollLog {
  readonly formulas: string[];
  readonly messages: object[];
}

// Total must match Foundry's kh/kl arithmetic: a pool keeps one die, so summing
// them all would make `{1d100,1d100}kl` report 130 instead of the kept die.
export function installRoll(dice: readonly RolledDie[]): RollLog {
  const log: RollLog = { formulas: [], messages: [] };
  const results = dice.map((die) => die.result);

  const total = (formula: string): number => {
    if (results.length === 0) return 0;
    const keep = /\}k(h|l)/.exec(formula);
    if (keep === null) return results.reduce((sum, result) => sum + result, 0);
    return keep[1] === 'h' ? Math.max(...results) : Math.min(...results);
  };

  (globalThis as Globals).Roll = class {
    #formula: string;

    constructor(formula: string) {
      this.#formula = formula;
      log.formulas.push(formula);
    }

    async evaluate() {
      const formula = this.#formula;
      return {
        total: total(formula),
        dice: dice.map((die) => ({ faces: die.faces, results: [{ result: die.result }] })),
        toMessage: async (data: object) => {
          log.messages.push(data);
          return data;
        },
      };
    }
  };

  return log;
}

export interface PostedCard {
  readonly template: string;
  readonly data: Record<string, unknown>;
}

export interface ChatLog {
  readonly cards: PostedCard[];
  readonly created: object[];
}

export function installChat(): ChatLog {
  const log: ChatLog = { cards: [], created: [] };

  branch(foundryStub(), 'applications').handlebars = {
    renderTemplate: async (template: string, data: Record<string, unknown>) => {
      log.cards.push({ template, data });
      return `<card>${template}</card>`;
    },
  };
  branch(branch(foundryStub(), 'applications'), 'ux').TextEditor = {
    implementation: { enrichHTML: async (html: string) => `enriched:${html}` },
  };

  (globalThis as Globals).ChatMessage = {
    create: async (data: object) => {
      log.created.push(data);
      return data;
    },
    applyMode: (data: object) => data,
  };

  return log;
}

export interface DialogButtonStub {
  action: string;
  label: string;
  icon?: string;
  class?: string;
  default?: boolean;
  callback: () => unknown;
}

export interface OpenDialog {
  readonly title: string;
  readonly classes: readonly string[];
  readonly buttons: DialogButtonStub[];
  readonly element: HTMLElement;
  press(action: string): Promise<void>;
  dismiss(): void;
  render(): void;
}

interface DialogConfig {
  window: { title: string };
  classes?: readonly string[];
  content: string;
  buttons: DialogButtonStub[];
  render?: (event: unknown, dialog: { element: HTMLElement }) => void;
  close?: (event: unknown, dialog: { element: HTMLElement }) => unknown;
}

// Matches DialogV2.wait: a button's callback result is the answer, and a dismissal
// answers whatever `close` returned, or null if it returned nothing. Needs jsdom.
export function installDialogV2(): OpenDialog[] {
  const opened: OpenDialog[] = [];

  branch(foundryStub(), 'applications').api = {
    DialogV2: {
      wait: (config: DialogConfig) =>
        new Promise((resolve) => {
          const element = document.createElement('div');
          element.innerHTML = config.content;
          document.body.append(element);
          const dialog = { element, close: () => finish(undefined) };

          const finish = (result: unknown): void => {
            const closed = config.close?.({}, dialog);
            resolve(result === undefined ? (closed ?? null) : result);
          };

          opened.push({
            title: config.window.title,
            classes: config.classes ?? [],
            buttons: config.buttons,
            element,
            press: async (action: string) => {
              const button = config.buttons.find((entry) => entry.action === action);
              if (button === undefined) throw new Error(`no button ${action}`);
              finish(await button.callback());
            },
            dismiss: () => finish(undefined),
            render: () => config.render?.({}, dialog),
          });

          config.render?.({}, dialog);
          // ApplicationV2 renders more than once over a dialog's life.
          config.render?.({}, dialog);
        }),
    },
  };

  return opened;
}

/**
 * What an item sheet body needs to render outside Foundry: the enricher, the `<prose-mirror>`
 * element, and the DataModel defaults a draft opens on. `defaults` is keyed by item type.
 */
export function installItemForms(defaults: Record<string, object> = {}): void {
  const applications = branch(foundryStub(), 'applications');
  branch(applications, 'ux').TextEditor = {
    implementation: { enrichHTML: async (html: string) => html },
  };
  branch(applications, 'elements').HTMLProseMirrorElement = {
    create: ({ name, value }: { name: string; value: string }) => {
      const element = document.createElement('div');
      element.setAttribute('name', name);
      Object.defineProperty(element, 'value', { get: () => value });
      return element;
    },
  };

  branch(branch(globalThis as Globals, 'CONFIG'), 'Item').dataModels = Object.fromEntries(
    Object.entries(defaults).map(([type, system]) => [
      type,
      class {
        toObject(): object {
          return structuredClone(system);
        }
      },
    ]),
  );
}

export function installPacks(packs: Record<string, readonly object[]>): void {
  gameStub().packs = {
    get: (id: string) =>
      packs[id] === undefined ? undefined : { getDocuments: async () => [...packs[id]] },
  };
}

export interface WorldItems {
  /** What `Item.create` was called with, in order. */
  readonly created: Record<string, unknown>[];
  /** The uuid of every document whose sheet was rendered. */
  readonly rendered: string[];
}

/**
 * `game.items` as the picker reads it — an iterable collection with a `documentClass` — plus the
 * `Hooks` bus it listens on. `create` files the document and fires `createItem`, the way Foundry
 * does, so a test can assert the row arrives without reaching into the component.
 */
export function installWorldItems(initial: readonly Record<string, unknown>[] = []): WorldItems {
  const log: WorldItems = { created: [], rendered: [] };
  const docs = [...initial];
  const listeners = new Map<number, { hook: string; fn: (...args: unknown[]) => void }>();
  let nextId = 1;

  const collection = docs as unknown as Record<string, unknown> & typeof docs;
  collection.documentClass = {
    create: async (data: Record<string, unknown>) => {
      log.created.push(data);
      const doc = {
        id: `world-${docs.length}`,
        uuid: `Item.world-${docs.length}`,
        name: data.name,
        type: data.type,
        img: data.img,
        system: data.system ?? {},
        toObject: () => structuredClone(data),
        sheet: { render: () => log.rendered.push(`Item.world-${docs.length - 1}`) },
      };
      docs.push(doc as unknown as Record<string, unknown>);
      for (const { hook, fn } of listeners.values()) if (hook === 'createItem') fn(doc);
      return doc;
    },
  };

  gameStub().items = collection;
  (globalThis as Globals).Hooks = {
    on: (hook: string, fn: (...args: unknown[]) => void) => {
      listeners.set(nextId, { hook, fn });
      return nextId++;
    },
    off: (_hook: string, id: number) => listeners.delete(id),
  };

  return log;
}

export interface Notifications {
  readonly errors: string[];
  readonly warnings: string[];
}

export function installNotifications(): Notifications {
  const log: Notifications = { errors: [], warnings: [] };
  (globalThis as Globals).ui = {
    notifications: {
      error: (message: string) => log.errors.push(message),
      warn: (message: string) => log.warnings.push(message),
    },
  };
  return log;
}

export function clearFoundryStubs(): void {
  delete (globalThis as Globals).game;
  delete (globalThis as Globals).Roll;
  delete (globalThis as Globals).ui;
  delete (globalThis as Globals).ChatMessage;
  delete (globalThis as Globals).foundry;
  delete (globalThis as Globals).CONFIG;
  delete (globalThis as Globals).Hooks;
}
