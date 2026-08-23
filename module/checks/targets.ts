/**
 * Who is being hit, which is a different question from `api.ts`'s `targetActors` — that one answers
 * who is *acting*, off the macro-target setting. This one reads Foundry's own crosshair targets.
 */

import type { CheckActor } from './actor.ts';

interface TargetToken {
  readonly actor?: { readonly name?: unknown; readonly img?: unknown } | null;
  readonly document?: { readonly uuid?: unknown; readonly name?: unknown } | null;
}

declare const game: { readonly user?: { readonly targets?: Iterable<TargetToken> } } | undefined;

declare const foundry:
  | { readonly utils: { fromUuid(uuid: string): Promise<unknown> } }
  | undefined;

/** What a card remembers about who was aimed at: enough to draw the row and find the actor again. */
export interface CardTarget {
  readonly uuid: string;
  readonly name: string;
  readonly img: string;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value !== '' ? value : fallback;
}

/**
 * The token's own name, not the actor's — two copies of the same creature are two rows, and telling
 * them apart is the whole point of naming them.
 */
export function currentTargets(): readonly CardTarget[] {
  const targets = typeof game === 'undefined' ? undefined : game?.user?.targets;
  if (targets === undefined) return [];

  const rows: CardTarget[] = [];
  for (const token of targets) {
    const uuid = text(token.document?.uuid);
    if (uuid === '' || token.actor === null || token.actor === undefined) continue;
    rows.push({
      uuid,
      name: text(token.document?.name, text(token.actor.name)),
      img: text(token.actor.img),
    });
  }
  return rows;
}

/**
 * A token that has since been deleted resolves to null rather than throwing at the click.
 *
 * Two kinds of uuid arrive here. A damage card records the *token* that was hit, because a hit
 * lands in the token's delta; a card about an actor's own change records the actor. A token names
 * its actor, and an actor uuid already is one — anything else is neither, and answers null.
 */
export async function targetActor(uuid: string): Promise<CheckActor | null> {
  if (typeof foundry === 'undefined') return null;

  const document = (await foundry.utils.fromUuid(uuid)) as
    | { readonly actor?: unknown; readonly documentName?: unknown }
    | null;
  if (document === null || document === undefined) return null;

  const actor = document.actor ?? (document.documentName === 'Actor' ? document : null);
  return actor === null || actor === undefined ? null : (actor as CheckActor);
}
