/**
 * Spending a target's Health for damage somebody else rolled. The arithmetic that follows — a Wound
 * per emptied bar, the surplus carried into the refilled one, death past the last Wound — is
 * `mutation/mutate.ts`'s; this module only decides how much arrives and who it arrives at.
 */

import {
  CARD_FLAG,
  mutationCard,
  ownsCard,
  postCard,
  rememberedCard,
  renderCard,
  SYSTEM_ID,
  targetRows,
  type CardMessage,
  type CardTarget,
} from '../chat/cards.ts';
import { mutate, type MutationResult } from '../mutation/mutate.ts';
import { isAdvantage } from '../rolls/spec.ts';
import { isWoundTable } from '../tables/tables.ts';
import { cardSource, isCharacter, speakerOf, voiceOfActor, type CheckActor } from './actor.ts';
import { woundOffer, type WoundRoll } from './damage.ts';
import { autoRollWounds } from './settings.ts';
import { runTable } from './tables.ts';
import { targetActor } from './targets.ts';

const HEALTH = 'system.health.value';

function fields(value: unknown): Record<string, unknown> {
  return (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
}

/**
 * Read off `system` rather than `toObject().system`, against this repo's usual rule: `deriveArmor`
 * sums the worn suits and the cover the actor is behind, and only the derived copy holds that total.
 */
export function damageReduction(actor: CheckActor): number {
  const armor = fields(fields(fields(actor.system).stats).armor);
  const value = Number(armor.damageReduction);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** PSG 25 — Damage Reduction comes off each hit, and a hit it fully absorbs deals nothing. */
export function harmAfterArmor(actor: CheckActor, amount: number): number {
  return Math.max(0, amount - damageReduction(actor));
}

export type HarmOutcome =
  | { readonly kind: 'applied'; readonly amount: number; readonly result: MutationResult }
  | { readonly kind: 'absorbed'; readonly amount: 0 }
  | { readonly kind: 'forbidden' };

/**
 * A player may hold a card without holding what it was aimed at, so the target decides, not the card.
 *
 * `subject` is the uuid this actor was found by — a token's, when a token was hit. The card it posts
 * records it, so the Wound offer on that card can be answered from the card rather than from
 * whatever the clicker has selected.
 */
export async function harmActor(
  actor: CheckActor,
  amount: number,
  wound: WoundRoll | null = null,
  subject: string | null = null,
): Promise<HarmOutcome> {
  if (actor.isOwner === false) return { kind: 'forbidden' };

  const taken = harmAfterArmor(actor, amount);
  if (taken === 0) return { kind: 'absorbed', amount: 0 };

  const result = await mutate(actor, HEALTH, { kind: 'amount', amount: -taken });

  // A Wound with no weapon behind it names no table, and a dead actor has run out of them.
  const wounded = result.wounds !== null && !result.dead && wound !== null;
  const rolls = wounded && autoRollWounds(isCharacter(actor));

  await postCard(
    mutationCard({
      source: cardSource(actor),
      result,
      voice: voiceOfActor(actor),
      wound: wounded && !rolls ? woundOffer(wound) : '',
      woundRoll: wounded && !rolls ? wound : null,
      subject,
    }),
    { speaker: speakerOf(actor) },
  );

  // PSG 29.1 — rolling the table is what taking a Wound means, but the Wound itself was already
  // spent by the hit, so this roll charges nothing.
  if (rolls) await runTable(actor, wound.table, { advantage: wound.advantage, costsWound: false });

  return { kind: 'applied', amount: taken, result };
}

/** What a target row looked like before this click, so re-rendering keeps every other row's state. */
function appliedSoFar(data: Record<string, unknown>): Record<string, number> {
  const rows = Array.isArray(data.targets) ? data.targets : [];
  const applied: Record<string, number> = {};
  for (const row of rows) {
    const target = fields(row);
    if (typeof target.uuid === 'string' && target.taken === true && typeof target.applied === 'number') {
      applied[target.uuid] = target.applied;
    }
  }
  return applied;
}

export function storedTargets(data: Record<string, unknown>): CardTarget[] {
  const rows = Array.isArray(data.targets) ? data.targets : [];
  return rows.map((row) => {
    const target = fields(row);
    return {
      uuid: typeof target.uuid === 'string' ? target.uuid : '',
      name: typeof target.name === 'string' ? target.name : '',
      img: typeof target.img === 'string' ? target.img : '',
    };
  });
}

export type CardRewrite = 'rewritten' | 'forbidden' | 'unrecorded' | 'unaimed';

async function rewriteTargets(
  message: CardMessage,
  user: unknown,
  targets: readonly CardTarget[],
  applied: Readonly<Record<string, number>>,
): Promise<CardRewrite> {
  if (!ownsCard(message, user)) return 'forbidden';

  const card = rememberedCard(message);
  if (card === null) return 'unrecorded';

  const total = typeof card.data.damageTotal === 'number' ? card.data.damageTotal : null;
  const rows = targetRows(targets, total, applied);
  const content = await renderCard({ kind: card.kind, data: { ...card.data, targets: rows } });
  if (content === null) return 'unrecorded';

  await message.update({ content, [`flags.${SYSTEM_ID}.${CARD_FLAG}.data.targets`]: rows });
  return 'rewritten';
}

/** The card records what it cost, so the same damage cannot be spent on the same target twice. */
export async function recordHarm(
  message: CardMessage,
  user: unknown,
  uuid: string,
  amount: number,
): Promise<CardRewrite> {
  const card = rememberedCard(message);
  if (card === null) return 'unrecorded';

  const applied = { ...appliedSoFar(card.data), [uuid]: amount };
  return await rewriteTargets(message, user, storedTargets(card.data), applied);
}

/** The crosshairs moved after the shot: the card takes the shooter's current targets instead. */
export async function retargetCard(
  message: CardMessage,
  user: unknown,
  targets: readonly CardTarget[],
): Promise<CardRewrite> {
  // Aiming at nothing is a mis-click, not an instruction: rewriting the card here would empty it,
  // and a card with no rows is one nobody can ever spend its damage from.
  if (targets.length === 0) return 'unaimed';

  const card = rememberedCard(message);
  if (card === null) return 'unrecorded';

  // Damage already taken is kept — retargeting is for the rows that were missing, not an undo. A
  // row that has paid keeps its place on the card whatever the crosshairs say now: it is the record
  // that stops the same damage being spent twice, and dropping it would hand its buttons back.
  const applied = appliedSoFar(card.data);
  const paid = storedTargets(card.data).filter((target) => Object.hasOwn(applied, target.uuid));
  const fresh = targets.filter((target) => !paid.some((row) => row.uuid === target.uuid));

  return await rewriteTargets(message, user, [...paid, ...fresh], applied);
}

/**
 * What the Warden's client does when a player clicks Apply on their own card.
 *
 * The amount is re-read from the card, never taken from the request: a client that could name its
 * own number could spend any actor's Health. For the same reason the target must be one the card
 * already recorded, and the sender must be whoever the card belongs to. What a player gets out of
 * this is the damage their own attack rolled, applied to who their own attack was aimed at.
 */
export interface HarmRequest {
  readonly messageId: string;
  readonly uuid: string;
  readonly half: boolean;
}

export function isHarmRequest(data: unknown): data is HarmRequest {
  const request = fields(data);
  return (
    typeof request.messageId === 'string' &&
    typeof request.uuid === 'string' &&
    typeof request.half === 'boolean'
  );
}

/** Half is rounded down; `chat/enrichers.ts`'s `harmAmount` is the same rule on the button's side. */
function requested(total: number, half: boolean): number {
  return half ? Math.floor(total / 2) : total;
}

/** The wound the card recorded, read back the way every other field off the wire is: checked, not believed. */
export function cardWound(data: Record<string, unknown>): WoundRoll | null {
  const wound = fields(data.wound);
  const table = typeof wound.table === 'string' ? wound.table : '';
  const advantage = typeof wound.advantage === 'string' ? wound.advantage : 'none';

  if (!isWoundTable(table) || !isAdvantage(advantage)) return null;
  return { table, advantage };
}

export interface HarmCard {
  readonly message: CardMessage;
  readonly sender: unknown;
}

export async function harmFromCard(card: HarmCard, request: HarmRequest): Promise<HarmOutcome> {
  const remembered = rememberedCard(card.message);
  if (remembered === null) return { kind: 'forbidden' };

  // Not `ownsCard`: this runs as the Warden, who may modify every message. The question is whether
  // the *sender* may, which is what makes this their card and not somebody else's.
  if (!card.message.canUserModify(card.sender, 'update')) return { kind: 'forbidden' };

  const total = remembered.data.damageTotal;
  if (typeof total !== 'number') return { kind: 'forbidden' };
  if (!storedTargets(remembered.data).some((target) => target.uuid === request.uuid)) {
    return { kind: 'forbidden' };
  }

  const actor = await targetActor(request.uuid);
  if (actor === null) return { kind: 'forbidden' };

  const outcome = await harmActor(
    actor,
    requested(total, request.half),
    cardWound(remembered.data),
    request.uuid,
  );
  if (outcome.kind === 'forbidden') return outcome;

  await recordHarm(card.message, card.sender, request.uuid, outcome.amount);
  return outcome;
}

/** The uuid stays beside the actor it found: the card the hit posts records who was hit, not who they are. */
export interface HarmTarget {
  readonly uuid: string;
  readonly actor: CheckActor;
}

/** Who a `@Harm` button is aimed at: its own row, or the clicker's live targets for a card with none. */
export async function harmTargets(
  uuid: string | null,
  live: readonly CardTarget[],
): Promise<HarmTarget[]> {
  const uuids = uuid === null ? live.map((target) => target.uuid) : [uuid];
  const targets: HarmTarget[] = [];
  for (const each of uuids) {
    const actor = await targetActor(each);
    if (actor !== null) targets.push({ uuid: each, actor });
  }
  return targets;
}
