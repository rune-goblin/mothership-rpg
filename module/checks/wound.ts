/**
 * Rolling the Wound a card led to, on the Warden's client, for whoever the card was aimed at.
 *
 * Who takes it is re-read from the card, never taken from the request — the same rule `harm.ts`
 * applies to a damage amount, and for the same reason: a client that could name its own target
 * could charge any actor a Wound. Whether the roll charges one is the card's answer too. The table
 * and the advantage are the clicker's, because a weapon's wound effect may name more than one table
 * and `[+]`/`[-]` are offered beside every one of them; neither picks who pays.
 */

import {
  CARD_FLAG,
  renderCard,
  rememberedCard,
  SYSTEM_ID,
  type Card,
  type CardMessage,
} from '../chat/cards.ts';
import { isAdvantage, type Advantage } from '../rolls/spec.ts';
import { isWoundTable, type TableKey } from '../tables/tables.ts';
import { storedTargets } from './harm.ts';
import { runTable, type TableResult } from './tables.ts';
import { targetActor } from './targets.ts';

export interface WoundRequest {
  readonly messageId: string;
  /** The target row clicked, when the button sits in one. Null takes every target the card recorded. */
  readonly uuid: string | null;
  readonly table: TableKey;
  readonly advantage: Advantage;
}

function fields(value: unknown): Record<string, unknown> {
  return (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
}

export function isWoundRequest(data: unknown): data is WoundRequest {
  const request = fields(data);
  return (
    typeof request.messageId === 'string' &&
    (typeof request.uuid === 'string' || request.uuid === null) &&
    typeof request.table === 'string' &&
    isWoundTable(request.table) &&
    typeof request.advantage === 'string' &&
    isAdvantage(request.advantage)
  );
}

export type WoundOutcome =
  | { readonly kind: 'rolled'; readonly results: readonly (TableResult | null)[] }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'unaimed' };

/**
 * What the card says this click means. A mutation card reports a hit that already spent the Wound,
 * so its roll charges nothing (PSG 29.1); a weapon's wound effect has not been paid for yet.
 */
interface WoundPlan {
  readonly subjects: readonly string[];
  readonly costsWound: boolean;
  /**
   * Whether the sender has to own the card. A roll that charges a Wound is a write to whoever was
   * hit, so it is the card owner's to ask for. A hit card's offer writes nothing — the Wound was
   * spent by the damage — and the card it sits in was posted by the Warden's client, which the
   * player who landed the hit does not own. Gating that one on the card would make it unclickable
   * for exactly the person the offer exists for.
   */
  readonly owned: boolean;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function plan(card: Card<Record<string, unknown>>, uuid: string | null): WoundPlan | null {
  if (card.kind === 'mutation') {
    // The offer is what may be spent, and it may be spent once: a card whose offer has already been
    // taken has no Wound left to roll, whoever asks.
    if (text(card.data.woundActions) === '') return null;
    const subject = text(card.data.subject);
    return subject === '' ? null : { subjects: [subject], costsWound: false, owned: false };
  }

  if (text(card.data.woundEffect) === '') return null;

  // The card's own record of who was aimed at, not the crosshairs now — the shooter has moved on.
  const recorded = storedTargets(card.data).map((target) => target.uuid);
  const subjects = uuid === null ? recorded : recorded.filter((each) => each === uuid);
  return subjects.length === 0 ? null : { subjects, costsWound: true, owned: true };
}

/** The offer becomes spent in the card that made it, so one hit's Wound cannot be rolled twice. */
async function spendOffer(message: CardMessage, card: Card<Record<string, unknown>>): Promise<void> {
  if (card.kind !== 'mutation') return;

  const content = await renderCard({ kind: card.kind, data: { ...card.data, woundActions: '' } });
  if (content === null) return;
  await message.update({ content, [`flags.${SYSTEM_ID}.${CARD_FLAG}.data.woundActions`]: '' });
}

export interface WoundCard {
  readonly message: CardMessage;
  readonly sender: unknown;
}

export async function woundFromCard(card: WoundCard, request: WoundRequest): Promise<WoundOutcome> {
  const remembered = rememberedCard(card.message);
  if (remembered === null) return { kind: 'forbidden' };

  const wanted = plan(remembered, request.uuid);
  if (wanted === null) return { kind: 'unaimed' };

  // Not `ownsCard`: this runs as the Warden, who may modify every message. The question is whether
  // the *sender* may, which is what makes this their card and not somebody else's.
  if (wanted.owned && !card.message.canUserModify(card.sender, 'update')) {
    return { kind: 'forbidden' };
  }

  // Spent before the first roll: `runTable` opens no dialog here, but it does await, and a second
  // click arriving in between would find the offer still standing.
  await spendOffer(card.message, remembered);

  const results: (TableResult | null)[] = [];
  for (const subject of wanted.subjects) {
    const actor = await targetActor(subject);
    if (actor === null) continue;
    results.push(
      await runTable(actor, request.table, {
        advantage: request.advantage,
        costsWound: wanted.costsWound,
      }),
    );
  }

  return results.length === 0 ? { kind: 'unaimed' } : { kind: 'rolled', results };
}
