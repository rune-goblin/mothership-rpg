import type { CardSource, Speaker, Voice } from '../chat/cards.ts';
import { voiceOf } from '../chat/cards.ts';
import type { ItemCard } from '../documents/item.ts';
import type { FireOutcome, ReloadOutcome } from '../inventory/ammo.ts';
import type { MutableDocument } from '../mutation/mutate.ts';
import { isSkillRank, rankBonus, skillRank, storedRank } from '../rules.ts';
import { isRobotic } from '../tables/tables.ts';

export interface CheckItem {
  readonly id: string | null;
  readonly name: string;
  readonly img: string;
  readonly type: string;
  readonly system: unknown;
  fire(): Promise<FireOutcome>;
  reload(): Promise<ReloadOutcome>;
  toChat(): ItemCard;
}

export interface ItemCollection extends Iterable<CheckItem> {
  get(id: string): CheckItem | undefined;
}

export interface CheckActor extends MutableDocument {
  readonly id: string | null;
  /** How a card records who it is about, when what changed is the actor's own. */
  readonly uuid?: string;
  readonly name: string;
  readonly img: string;
  readonly type: string;
  /** The derived system (armour, swarm multiplier, condition tally) — mutations read `toObject().system` instead. */
  readonly system: unknown;
  readonly items: ItemCollection;
  readonly token?: { readonly id?: string | null } | null;
  /** Whether this client may write to the document — a player cannot spend a creature's Health. */
  readonly isOwner?: boolean;
}

export const CHARACTER = 'character';

function fields(value: unknown): Record<string, unknown> {
  return (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function cardSource(actor: CheckActor): CardSource {
  return { actorId: actor.id, actorImg: actor.img, tokenId: actor.token?.id ?? null };
}

export function speakerOf(actor: CheckActor): Speaker {
  return { actor: actor.id, token: actor.token?.id ?? null, alias: actor.name };
}

export function voiceOfActor(actor: CheckActor): Voice {
  return voiceOf(isRobotic(actor));
}

/** label and rollLabel are the two names the card prints — they can differ. */
export interface StatValue {
  readonly key: string;
  readonly value: number;
  readonly mod: number;
  readonly label: string;
  readonly rollLabel: string;
}

export function statOf(system: unknown, key: string): StatValue | null {
  const stats = fields(fields(system).stats);
  if (!Object.hasOwn(stats, key)) return null;

  const stat = fields(stats[key]);
  return {
    key,
    value: number(stat.value),
    mod: number(stat.mod),
    label: text(stat.label) || key,
    rollLabel: text(stat.rollLabel) || key,
  };
}

/** PSG 20 — the number a Panic Check is rolled against. */
export function stressOf(system: unknown): number {
  return number(fields(fields(fields(system).other).stress).value);
}

/** `system.bonus` is a denormalized copy of the rank's bonus — the fallback for an unnamed rank, not a second opinion. */
export function skillBonus(system: unknown): number {
  const skill = fields(system);
  const rank = text(skill.rank);
  return isSkillRank(rank) ? rankBonus(rank) : number(skill.bonus);
}

/** Returns null when the book doesn't name the rank, rather than inventing a word. */
export function skillRankWord(system: unknown): string | null {
  const stored = text(fields(system).rank);
  return isSkillRank(stored) ? storedRank(skillRank(stored)) : null;
}

export function isCharacter(actor: CheckActor): boolean {
  return actor.type === CHARACTER;
}
