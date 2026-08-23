import { registerChatAction } from '../chat/actions.ts';
import { gainAddress, type ChatAction } from '../chat/enrichers.ts';
import { mutationCard, postCard } from '../chat/cards.ts';
import { isCondition } from '../conditions.ts';
import { mutate, type Change } from '../mutation/mutate.ts';
import { parseRollSpec } from '../rolls/parse.ts';
import { CHECK_SEMANTICS, type Advantage, type RollSpec } from '../rolls/spec.ts';
import { cardSource, speakerOf, voiceOfActor, type CheckActor } from './actor.ts';
import { checkOf, runCheck } from './checks.ts';
import { woundChoice } from './damage.ts';
import { evaluateRoll, type Rolled } from './roll.ts';
import { runTable } from './tables.ts';

export type TargetActors = () => Promise<readonly CheckActor[]> | readonly CheckActor[];

/** An amount is rolled the way damage is: what it says on the dice, top face and all. */
const AMOUNT_KIND = 'weapon-damage';

/** The schema's name for the Wound track; the book's word for it is on the label. */
const WOUNDS = 'hits';

/** 'none' means the content states no modifier, so it maps to null rather than an instruction. */
function stated(advantage: Advantage): Advantage | null {
  return advantage === 'none' ? null : advantage;
}

/**
 * `isCondition` matches by compendium id when the condition was granted through this system
 * (`{keepId: true}`), or by canonical name otherwise — a condition dragged straight onto the
 * sheet keeps Foundry's own fresh id and only matches by name.
 */
function severityOf(actor: CheckActor, condition: string): number {
  let total = 0;
  for (const item of actor.items) {
    if (item.type !== 'condition' || !isCondition(item, condition)) continue;
    const system = (item.system ?? {}) as { severity?: unknown };
    total += Number(system.severity) || 0;
  }
  return total;
}

export async function gain(
  actor: CheckActor,
  action: Extract<ChatAction, { verb: 'gain' }>,
): Promise<void> {
  const { amount } = action;
  let spec: RollSpec | null = null;
  let rolled: Rolled | null = null;
  let change: Change;

  if (amount.kind === 'roll') {
    spec = parseRollSpec(amount.dice, CHECK_SEMANTICS[AMOUNT_KIND].aim);
    rolled = await evaluateRoll({ spec, kind: AMOUNT_KIND });
    change = { kind: 'roll', roll: rolled.roll };
  } else if (amount.kind === 'severity') {
    change = { kind: 'amount', amount: amount.sign * severityOf(actor, amount.condition) };
  } else {
    change = { kind: 'amount', amount: amount.amount };
  }

  const result = await mutate(actor, gainAddress(action), change);

  // PSG 29.1 — a Wound means a roll on a Wound table, however the Wound arrived. Nothing here names
  // which table (a weapon would), so the card offers the choice; the Wound itself was spent by this
  // change, so the roll it leads to charges none.
  const wounded = result.field.address.pod === WOUNDS && result.field.to > result.field.from;

  const card = mutationCard({
    source: cardSource(actor),
    result,
    voice: voiceOfActor(actor),
    spec,
    rollOutcome: rolled?.outcome ?? null,
    wound: wounded ? woundChoice() : '',
    subject: wounded ? (actor.uuid ?? null) : null,
  });
  await postCard(card, { speaker: speakerOf(actor) });
}

export async function runAction(action: ChatAction, actors: readonly CheckActor[]): Promise<void> {
  for (const actor of actors) {
    switch (action.verb) {
      case 'check':
        await runCheck(actor, checkOf(action.scope), { advantage: stated(action.advantage) });
        break;
      case 'table':
        await runTable(actor, action.table, { advantage: action.advantage });
        break;
      case 'gain':
        await gain(actor, action);
        break;
      case 'apply':
        // api.ts's registerActions claims this verb directly; the branch stays only to cover the switch.
        break;
    }
  }
}

export const REGISTERED_VERBS = ['check', 'table', 'gain'] as const;

export function registerCheckActions(target: TargetActors): void {
  for (const verb of REGISTERED_VERBS) {
    registerChatAction(verb, async (action) => {
      await runAction(action, await target());
    });
  }
}
