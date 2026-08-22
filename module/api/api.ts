/** `game.mothershiprpg` — what a macro, a hotbar button or another module may call. `init.ts` puts it on `game`. */

import { registerChatAction } from '../chat/actions.ts';
import { registerCheckActions } from '../checks/actions.ts';
import { rollDamageInCard } from '../checks/damage.ts';
import { harmActor, harmFromCard, harmTargets, isHarmRequest, retargetCard, type HarmOutcome } from '../checks/harm.ts';
import { isWoundRequest, woundFromCard, type WoundOutcome } from '../checks/wound.ts';
import { dispatch, initDispatch, registerDispatch } from '../dispatch/dispatch.ts';
import { currentTargets } from '../checks/targets.ts';
import { harmAmount } from '../chat/enrichers.ts';
import { type CheckOptions, type CheckOutcome } from '../checks/checks.ts';
import { type TableOptions, type TableResult } from '../checks/tables.ts';
import { SYSTEM_ID, type CardMessage } from '../chat/cards.ts';
import { CONDITION_IDS } from '../conditions.ts';
import { debug } from '../debug.ts';
import {
  chooseSave,
  chooseStress,
  chooseWound,
  noCharacter,
  type StressDirection,
} from '../dialogs/prompts.ts';
import { format, localize } from '../i18n.ts';
import { lookup, notifyMiss } from '../lookup.ts';
import { addressOf } from '../mutation/fields.ts';
import type { GrantDocument, GrantResult } from '../mutation/items.ts';
import type { Amount, MutationResult } from '../mutation/mutate.ts';
import type { StatKey } from '../rolls/spec.ts';
import type { TableKey } from '../tables/tables.ts';
import { MothershipActor, type WeaponOptions } from '../documents/actor.ts';
import { MothershipItem } from '../documents/item.ts';

declare const game:
  | {
      readonly settings?: { get(namespace: string, key: string): unknown };
      readonly user?: { readonly character?: unknown };
      readonly users?: { get(id: string): unknown };
      readonly actors?: { get(id: string): unknown };
      readonly messages?: { get(id: string): CardMessage | undefined };
    }
  | undefined;

declare const canvas:
  | {
      readonly tokens?: {
        readonly controlled?: readonly { readonly actor?: unknown }[];
        get?(id: string): { readonly actor?: unknown } | undefined;
      };
    }
  | undefined;

declare const ui: { readonly notifications?: { warn(message: string): unknown } } | undefined;

/** Whose sheet a macro acts on: the user's assigned character, or whatever tokens are selected. */
export type MacroTarget = 'character' | 'token';

export const MACRO_TARGET_KEY = 'macroTarget';
export const MACRO_TARGET_CHOICES: readonly MacroTarget[] = ['character', 'token'];
export const MACRO_TARGET_DEFAULT: MacroTarget = 'character';

export function macroTarget(): MacroTarget {
  const stored = typeof game === 'undefined' ? undefined : game?.settings?.get(SYSTEM_ID, MACRO_TARGET_KEY);
  return MACRO_TARGET_CHOICES.includes(stored as MacroTarget)
    ? (stored as MacroTarget)
    : MACRO_TARGET_DEFAULT;
}

function assignedCharacter(): MothershipActor[] {
  const character = typeof game === 'undefined' ? null : (game?.user?.character ?? null);
  return character === null ? [] : [character as MothershipActor];
}

function controlledActors(): MothershipActor[] {
  const controlled = typeof canvas === 'undefined' ? [] : (canvas?.tokens?.controlled ?? []);
  return controlled
    .map((token) => token.actor)
    .filter((actor): actor is MothershipActor => actor !== null && actor !== undefined);
}

/** Nothing selected is not an error — it opens a dialog naming the setting that decides targeting. */
export async function targetActors(): Promise<readonly MothershipActor[]> {
  const target = macroTarget();
  const actors = target === 'token' ? controlledActors() : assignedCharacter();

  if (actors.length === 0) {
    await noCharacter(target);
    return [];
  }
  return actors;
}

/** Each actor is awaited before the next call starts, so a rejected call surfaces instead of becoming an unhandled rejection. */
export async function forTargetActors<T>(
  fn: (actor: MothershipActor) => Promise<T> | T,
): Promise<T[]> {
  const results: T[] = [];
  for (const actor of await targetActors()) results.push(await fn(actor));
  return results;
}

export async function rollStat(stat: StatKey, options: CheckOptions = {}): Promise<(CheckOutcome | null)[]> {
  return await forTargetActors((actor) => actor.rollStat(stat, options));
}

export async function promptCheck(options: CheckOptions = {}): Promise<(CheckOutcome | null)[]> {
  return await forTargetActors((actor) => actor.promptCheck(options));
}

export async function rollSkill(skillId: string, options: CheckOptions = {}): Promise<(CheckOutcome | null)[]> {
  return await forTargetActors((actor) => actor.rollSkill(skillId, options));
}

export async function rollWeapon(itemId: string, options: WeaponOptions = {}): Promise<(CheckOutcome | null)[]> {
  return await forTargetActors((actor) => actor.rollWeapon(itemId, options));
}

export async function rollPanic(options: CheckOptions = {}): Promise<(CheckOutcome | null)[]> {
  return await forTargetActors((actor) => actor.rollPanic(options));
}

export async function rollRestSave(options: CheckOptions = {}): Promise<(CheckOutcome | null)[]> {
  return await forTargetActors((actor) => actor.rollRestSave(options));
}

export async function rollTable(key: TableKey, options: TableOptions = {}): Promise<(TableResult | null)[]> {
  return await forTargetActors((actor) => actor.rollTable(key, options));
}

export async function modify(address: string, amount: Amount): Promise<MutationResult[]> {
  return await forTargetActors((actor) => actor.modify(address, amount));
}

/** The player supplies the argument via a `dialogs/` prompt, not the caller. */
export async function promptStress(direction: StressDirection): Promise<MutationResult[]> {
  const amount = await chooseStress(direction);
  return amount === null ? [] : await modify(addressOf('stress'), amount);
}

export async function promptSave(): Promise<(CheckOutcome | null)[]> {
  const chosen = await chooseSave();
  return chosen === null ? [] : await rollStat(chosen.stat, { advantage: chosen.advantage });
}

export async function promptWound(): Promise<(TableResult | null)[]> {
  const chosen = await chooseWound();
  return chosen === null ? [] : await rollTable(chosen.key, { advantage: chosen.advantage });
}

/** The warning fires before `item.id` is dereferenced, not after — a missing item must not throw. */
export async function rollItem(itemName: string): Promise<unknown[]> {
  return await forTargetActors(async (actor) => {
    const item = itemNamed(actor, itemName);
    if (item === null) {
      if (typeof ui !== 'undefined') {
        ui?.notifications?.warn(format('Mothership.Errors.NoItemNamed', { actor: actor.name, name: itemName }));
      }
      return null;
    }
    if (item.id === null) return null;

    if (item.type === 'weapon') return await actor.rollWeapon(item.id);
    if (item.type === 'skill') return await actor.rollSkill(item.id);
    return await actor.printDescription(item.id);
  });
}

export function itemNamed(actor: MothershipActor, name: string): MothershipItem | null {
  const wanted = String(name ?? '').trim().toLowerCase();
  for (const item of actor.items) {
    if (item.name.trim().toLowerCase() === wanted) return item;
  }
  return null;
}

/** `../conditions.ts` is the one leaf both this module and `checks/actions.ts` read, avoiding a two-file import cycle. */
export function conditionRef(condition: string): string {
  return CONDITION_IDS[condition]?.id ?? condition;
}

/** Give every targeted actor a condition — or another N of it, if they already have it. */
export async function applyCondition(condition: string, count = 1): Promise<GrantResult[]> {
  const ref = conditionRef(condition);
  const found = await lookup<GrantDocument>(ref, 'Item');
  if (!found.found) {
    notifyMiss(found.request);
    return [];
  }
  return await forTargetActors((actor) => actor.applyItem(found.document, count));
}

export interface CardOrigin {
  readonly actor: MothershipActor | null;
  readonly itemId: string | null;
  /** The message the card is in, so a button can rewrite the card it sits in. */
  readonly messageId: string | null;
}

/** The token is checked first — an unlinked token shares its base actor's id with every other copy on the scene. */
export function cardOrigin(button: Element | null): CardOrigin {
  // data-message-id is Foundry's own attribute, not this system's.
  const messageId = button?.closest<HTMLElement>('[data-message-id]')?.dataset.messageId ?? null;
  const card = button?.closest<HTMLElement>('[data-actor-id]') ?? null;
  if (card === null) return { actor: null, itemId: null, messageId };

  const { actorId = '', itemId = '', tokenId = '' } = card.dataset;
  const token = tokenId === '' ? undefined : canvas?.tokens?.get?.(tokenId);
  const actor = token?.actor ?? (actorId === '' ? null : (game?.actors?.get(actorId) ?? null));

  return {
    actor: (actor as MothershipActor | null) ?? null,
    itemId: itemId === '' ? null : itemId,
    messageId,
  };
}

/** The row a card button sits in, when it sits in one — a hand-typed `@Harm` has no row. */
function rowTarget(button: Element | null): string | null {
  return button?.closest<HTMLElement>('[data-target-uuid]')?.dataset.targetUuid ?? null;
}

function warn(key: string): void {
  if (typeof ui !== 'undefined') ui?.notifications?.warn(localize(key));
}

function cardMessage(button: Element | null): CardMessage | undefined {
  const { messageId } = cardOrigin(button);
  return messageId === null ? undefined : game?.messages?.get(messageId);
}

/** This client's own hands: whatever it may write to, it writes to directly. */
async function harmHere(amount: number, uuid: string | null): Promise<void> {
  const targets = await harmTargets(uuid, currentTargets());
  if (targets.length === 0) return warn('Mothership.Errors.NoHarmTarget');

  for (const target of targets) {
    const outcome = await harmActor(target.actor, amount, null, target.uuid);
    if (outcome.kind === 'forbidden') warn('Mothership.Errors.NotYourTarget');
  }
}

/** `rolled` says nothing; the table card it posted is the answer. */
function woundWarning(outcome: WoundOutcome | undefined): void {
  if (outcome?.kind === 'forbidden') warn('Mothership.Errors.NotYourWound');
  if (outcome?.kind === 'unaimed') warn('Mothership.Errors.NoWoundTarget');
}

export function registerActions(): void {
  initDispatch();
  registerCheckActions(targetActors);

  // Runs on the Warden's client, for a player who may not write to what they hit.
  registerDispatch('harm', async (data, senderId) => {
    if (!isHarmRequest(data)) throw new Error('not a harm request');
    const message = game?.messages?.get(data.messageId);
    if (message === undefined) throw new Error('no such card');
    return await harmFromCard({ message, sender: game?.users?.get(senderId) }, data);
  });

  // The Wound a card led to, rolled by the Warden: charging one is a write to whoever was hit, and
  // the player who landed the hit does not own them.
  registerDispatch('wound', async (data, senderId) => {
    if (!isWoundRequest(data)) throw new Error('not a wound request');
    const message = game?.messages?.get(data.messageId);
    if (message === undefined) throw new Error('no such card');
    return await woundFromCard({ message, sender: game?.users?.get(senderId) }, data);
  });

  registerChatAction('harm', async (action, context) => {
    debug('action', `harm ${harmAmount(action)}`);

    const uuid = rowTarget(context.button);
    const messageId = cardOrigin(context.button).messageId;

    // Only card-backed damage goes to the Warden: there the amount can be re-read from the card
    // rather than believed. A hand-typed `@Harm` names its own number, so it stays this client's
    // to apply, under this client's permissions.
    if (uuid === null || messageId === null) return await harmHere(harmAmount(action), uuid);

    const request = { messageId, uuid, half: action.half };
    const sent = await dispatch<HarmOutcome>('harm', request);

    // Nobody to ask: run the same verified path here, which succeeds only if this client owns
    // both the card and what it was aimed at.
    if (sent.kind === 'no-gm') {
      const message = cardMessage(context.button);
      if (message === undefined) return warn('Mothership.Errors.NoDamageSource');
      const outcome = await harmFromCard({ message, sender: game?.user }, request);
      if (outcome.kind === 'forbidden') warn('Mothership.Errors.NotYourTarget');
      return;
    }

    if (sent.kind === 'timeout') return warn('Mothership.Errors.WardenDidNotAnswer');
    if (sent.kind === 'failed' || sent.result?.kind === 'forbidden') {
      return warn('Mothership.Errors.NotYourTarget');
    }
  });

  registerChatAction('retarget', async (_action, context) => {
    const message = cardMessage(context.button);
    if (message === undefined) return warn('Mothership.Errors.NoDamageSource');

    const outcome = await retargetCard(message, game?.user, currentTargets());
    if (outcome === 'unaimed') warn('Mothership.Errors.NoHarmTarget');
    if (outcome === 'forbidden') warn('Mothership.Errors.NotYourCard');
  });

  /**
   * Not a `@Table`: this rolls against whoever the card was aimed at, rather than whoever clicks it.
   * That is the whole point of the verb — a `@Table` would find the clicker's own character, roll
   * the wrong actor's Wound and, on an actor they do not own, fail on the write.
   */
  registerChatAction('wound', async (action, context) => {
    debug('action', `wound ${action.table}`);

    const messageId = cardOrigin(context.button).messageId;
    if (messageId === null) return warn('Mothership.Errors.NoWoundTarget');

    const request = {
      messageId,
      uuid: rowTarget(context.button),
      table: action.table,
      advantage: action.advantage,
    };
    const sent = await dispatch<WoundOutcome>('wound', request);

    // Nobody to ask: the same verified path here, which succeeds only if this client may write to
    // what the card names.
    if (sent.kind === 'no-gm') {
      const message = cardMessage(context.button);
      if (message === undefined) return warn('Mothership.Errors.NoWoundTarget');
      return woundWarning(await woundFromCard({ message, sender: game?.user }, request));
    }

    if (sent.kind === 'timeout') return warn('Mothership.Errors.WardenDidNotAnswer');
    if (sent.kind === 'failed') return warn('Mothership.Errors.NotYourWound');
    woundWarning(sent.result);
  });

  registerChatAction('apply', async (action) => {
    debug('action', `apply ${action.condition} ×${action.count}`);
    await applyCondition(action.condition, action.count);
  });

  // The button's formula already has the crit rule applied — don't recompute it here.
  registerChatAction('damage', async (action, context) => {
    debug('action', `damage ${action.formula}`);
    const { actor, itemId, messageId } = cardOrigin(context.button);
    if (actor === null || itemId === null) {
      if (typeof ui !== 'undefined') ui?.notifications?.warn(localize('Mothership.Errors.NoDamageSource'));
      return;
    }

    const message = messageId === null ? undefined : game?.messages?.get(messageId);
    const item = actor.items.get(itemId);
    if (message !== undefined && item !== undefined) {
      const outcome = await rollDamageInCard(message, game?.user, actor, item, action.formula);
      if (outcome === 'rewritten') return;
      if (outcome === 'forbidden') {
        if (typeof ui !== 'undefined') ui?.notifications?.warn(localize('Mothership.Errors.NotYourCard'));
        return;
      }
    }

    // `unrecorded`: nothing to rewrite, so the damage arrives one message further down.
    await actor.rollWeapon(itemId, { roll: 'damage', damage: action.formula });
  });
}

export const NEW_API = {
  MothershipActor,
  MothershipItem,
  rollStat,
  promptCheck,
  rollSkill,
  rollWeapon,
  rollItem,
  rollPanic,
  rollRestSave,
  rollTable,
  modify,
  promptStress,
  promptSave,
  promptWound,
  applyCondition,
  forTargetActors,
  targetActors,
} as const;
