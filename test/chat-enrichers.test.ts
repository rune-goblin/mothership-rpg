// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  ACTION_ATTRIBUTE,
  ACTION_PATTERN,
  actionButton,
  actionLabel,
  CHECK_SCOPES,
  enrichAction,
  formatAction,
  gainAddress,
  harmAmount,
  parseAction,
  registerEnrichers,
  type ChatAction,
} from '../module/chat/enrichers.ts';
import { clearFoundryStubs, installI18n } from './foundry-stubs.ts';
// Straight from the recorder rather than through `field-stubs.ts`, which reads `template.json`
// off disk — this spec runs in jsdom, where `import.meta.url` is not a file URL.
import { installFoundryFieldStubs } from '../scripts/model-schema.ts';

installFoundryFieldStubs();
const { ROLL_SCOPES } = (await import('../module/data/item-models.js')) as { ROLL_SCOPES: string[] };

afterEach(clearFoundryStubs);

const parsed = (text: string): ChatAction => {
  const result = parseAction(text);
  if (!result.ok) throw new Error(`${text}: ${result.fault} — ${result.detail}`);
  return result.action;
};

/**
 * The fifteen expressions content actually links today — six condition descriptions and
 * the Panic table's eight condition results.
 */
const CONTENT_ACTIONS: readonly (readonly [string, string, ChatAction])[] = [
  ['Bleeding', '@Gain[health -bleeding]', { verb: 'gain', field: 'health', leaf: 'value', amount: { kind: 'severity', condition: 'bleeding', sign: -1 } }],
  ['Coward', '@Check[fear]', { verb: 'check', scope: 'fear', advantage: 'none' }],
  ['Frightened, save', '@Check[fear -]', { verb: 'check', scope: 'fear', advantage: 'disadvantage' }],
  ['Frightened, stress', '@Gain[stress 1d5]', { verb: 'gain', field: 'stress', leaf: 'value', amount: { kind: 'roll', dice: '1d5' } }],
  ['Deflated', '@Gain[stress 1]', { verb: 'gain', field: 'stress', leaf: 'value', amount: { kind: 'amount', amount: 1 } }],
  ['Nightmares', '@Check[restSave -]', { verb: 'check', scope: 'restSave', advantage: 'disadvantage' }],
  ['Spiraling', '@Check[panicCheck -]', { verb: 'check', scope: 'panicCheck', advantage: 'disadvantage' }],
  ['Panic 5', '@Apply[coward]', { verb: 'apply', condition: 'coward', count: 1 }],
  ['Panic 6', '@Apply[frightened]', { verb: 'apply', condition: 'frightened', count: 1 }],
  ['Panic 7', '@Apply[nightmares]', { verb: 'apply', condition: 'nightmares', count: 1 }],
  ['Panic 8', '@Apply[loss-of-confidence]', { verb: 'apply', condition: 'loss-of-confidence', count: 1 }],
  ['Panic 9', '@Apply[deflated]', { verb: 'apply', condition: 'deflated', count: 1 }],
  ['Panic 10', '@Apply[doomed]', { verb: 'apply', condition: 'doomed', count: 1 }],
  ['Panic 12', '@Apply[haunted]', { verb: 'apply', condition: 'haunted', count: 1 }],
  ['Panic 17', '@Apply[spiraling]', { verb: 'apply', condition: 'spiraling', count: 1 }],
];

describe('the grammar covers what content links today', () => {
  for (const [name, text, action] of CONTENT_ACTIONS) {
    it(`${name}: ${text}`, () => {
      expect(parsed(text)).toEqual(action);
      expect(formatAction(action)).toBe(text);
    });
  }

  it('states each of the four verbs once, with the variation as arguments', () => {
    expect(new Set(CONTENT_ACTIONS.map(([, , action]) => action.verb))).toEqual(
      new Set(['check', 'gain', 'apply']),
    );
  });
});

describe('parsing', () => {
  it('reads a modifier as the advantage it means', () => {
    expect(parsed('@Check[body +]')).toMatchObject({ advantage: 'advantage' });
    expect(parsed('@Check[body -]')).toMatchObject({ advantage: 'disadvantage' });
    expect(parsed('@Check[body]')).toMatchObject({ advantage: 'none' });
  });

  it('reads a bound as the leaf it addresses, and writes it back', () => {
    expect(gainAddress(parsed('@Gain[stress 1]') as never)).toBe('system.other.stress.value');
    expect(gainAddress(parsed('@Gain[stress.min 1]') as never)).toBe('system.other.stress.min');
    expect(gainAddress(parsed('@Gain[stress.max -1d10]') as never)).toBe('system.other.stress.max');
    expect(gainAddress(parsed('@Gain[wounds 1]') as never)).toBe('system.hits.value');

    for (const text of ['@Gain[stress.min 1]', '@Gain[stress.max -1d10]', '@Gain[wounds -1]']) {
      expect(formatAction(parsed(text))).toBe(text);
    }
  });

  it('reads a severity by count, and a count by number', () => {
    expect(parsed('@Apply[bleeding 2]')).toEqual({ verb: 'apply', condition: 'bleeding', count: 2 });
    expect(formatAction({ verb: 'apply', condition: 'bleeding', count: 2 })).toBe('@Apply[bleeding 2]');
  });

  // critFormula produces formulas like `1d10 * 2` and `{1d10,1d10}kh` — the expression must
  // keep its spaces and braces intact.
  it('reads a damage expression whole, spaces and all', () => {
    for (const formula of ['4d10', '1d10 * 2', '{1d10,1d10}kh', 'floor(45/10)', '1']) {
      expect(parsed(`@Damage[${formula}]`)).toEqual({ verb: 'damage', formula });
      expect(formatAction({ verb: 'damage', formula })).toBe(`@Damage[${formula}]`);
    }
  });

  it('refuses a damage naming no dice and no number, so a typo stays text', () => {
    expect(parseAction('@Damage[lots]')).toMatchObject({ ok: false, fault: 'argument' });
    expect(parseAction('@Damage[]')).toMatchObject({ ok: false, fault: 'argument' });
  });

  it('takes a label the way `@UUID` does', () => {
    const result = parseAction('@Gain[health -bleeding]{Take Bleeding Damage}');

    expect(result).toMatchObject({ ok: true, label: 'Take Bleeding Damage' });
  });

  it('refuses what it cannot mean, saying which half was wrong', () => {
    expect(parseAction('@Check[luck]')).toMatchObject({ ok: false, fault: 'argument' });
    expect(parseAction('@Gain[morale 1]')).toMatchObject({ ok: false, fault: 'argument' });
    expect(parseAction('@Gain[stress]')).toMatchObject({ ok: false, fault: 'argument' });
    expect(parseAction('@Gain[stress.middle 1]')).toMatchObject({ ok: false, fault: 'argument' });
    expect(parseAction('@Apply[coward 0]')).toMatchObject({ ok: false, fault: 'argument' });
    expect(parseAction('@Roll[fear]')).toMatchObject({ ok: false, fault: 'syntax' });
    expect(parseAction('')).toMatchObject({ ok: false, fault: 'syntax' });
  });

  it('has one spelling for a Panic Check', () => {
    expect(parseAction('@Table[panic]')).toMatchObject({ ok: false, detail: 'a Panic Check is @Check[panicCheck]' });
    expect(parsed('@Table[gunshot -]')).toEqual({ verb: 'table', table: 'gunshot', advantage: 'disadvantage' });

    // No table named: the card asks which before it rolls, so the bracket is empty.
    expect(parsed('@Wound[]')).toEqual({ verb: 'wound', table: null, advantage: 'none' });
    expect(formatAction({ verb: 'wound', table: null, advantage: 'none' })).toBe('@Wound[]');
    expect(parseAction('@Wound[nonsense]')).toMatchObject({
      ok: false,
      detail: 'nonsense is not a wound table',
    });

    // Round-trips, which is what lets a card be rebuilt from what it printed.
    expect(formatAction({ verb: 'death', advantage: 'none' })).toBe('@Death[]');
    expect(formatAction({ verb: 'death', advantage: 'advantage' })).toBe('@Death[+]');
    expect(parsed(formatAction({ verb: 'death', advantage: 'disadvantage' }))).toEqual({
      verb: 'death',
      advantage: 'disadvantage',
    });

    // The one table with no argument to name: the Death Save takes only its modifier.
    expect(parsed('@Death[]')).toEqual({ verb: 'death', advantage: 'none' });
    expect(parsed('@Death[+]')).toEqual({ verb: 'death', advantage: 'advantage' });
    expect(parsed('@Death[-]')).toEqual({ verb: 'death', advantage: 'disadvantage' });
  });

  // Conditions have a `scope` enum so text like Nightmares names a specific roll; checks
  // must name that same key space.
  it('names checks with the schema’s own scope vocabulary', () => {
    expect([...CHECK_SCOPES]).toEqual(ROLL_SCOPES);
  });
});

describe('harming the target', () => {
  it('reads an amount, and half of one', () => {
    expect(parsed('@Harm[7]')).toEqual({ verb: 'harm', amount: 7, half: false });
    expect(parsed('@Harm[7 half]')).toEqual({ verb: 'harm', amount: 7, half: true });
  });

  it('round-trips through the grammar', () => {
    expect(formatAction({ verb: 'harm', amount: 7, half: false })).toBe('@Harm[7]');
    expect(formatAction({ verb: 'harm', amount: 7, half: true })).toBe('@Harm[7 half]');
    expect(formatAction({ verb: 'retarget' })).toBe('@Retarget[]');
    expect(parsed('@Retarget[]')).toEqual({ verb: 'retarget' });
  });

  it('rounds half down, the way every other quotient in the book does', () => {
    expect(harmAmount({ verb: 'harm', amount: 7, half: true })).toBe(3);
    expect(harmAmount({ verb: 'harm', amount: 7, half: false })).toBe(7);
    expect(harmAmount({ verb: 'harm', amount: 1, half: true })).toBe(0);
  });

  it('refuses an amount that is not one, and a modifier that is not half', () => {
    expect(parseAction('@Harm[1d10]').ok).toBe(false);
    expect(parseAction('@Harm[]').ok).toBe(false);
    expect(parseAction('@Harm[7 double]').ok).toBe(false);
  });

  it('says how much each button spends', () => {
    installI18n({
      'Mothership.Chat.HarmLabel': 'Apply {amount}',
      'Mothership.Chat.HarmHalfLabel': 'Half ({amount})',
    });

    expect(actionLabel({ verb: 'harm', amount: 7, half: false })).toBe('Apply 7');
    expect(actionLabel({ verb: 'harm', amount: 7, half: true })).toBe('Half (3)');
  });
});

/**
 * A wound is rolled against the actor whose card it sits in, not whoever clicks it — which is the
 * whole difference between `@Wound` and `@Table`, the same roll asked for by the person clicking.
 */
describe('the Wound a hit leads to', () => {
  it('names a table and how to roll it', () => {
    expect(parsed('@Wound[gunshot]')).toEqual({ verb: 'wound', table: 'gunshot', advantage: 'none' });
    expect(parsed('@Wound[gunshot -]')).toEqual({
      verb: 'wound',
      table: 'gunshot',
      advantage: 'disadvantage',
    });
  });

  it('round-trips through the grammar', () => {
    expect(formatAction({ verb: 'wound', table: 'bleeding', advantage: 'advantage' })).toBe(
      '@Wound[bleeding +]',
    );
    expect(formatAction({ verb: 'wound', table: 'bleeding', advantage: 'none' })).toBe('@Wound[bleeding]');
  });

  // The Panic Check and the Death Save are rolls, not wounds; neither is a Wound's table.
  it('refuses a table no Wound is rolled on', () => {
    expect(parseAction('@Wound[panic]').ok).toBe(false);
    expect(parseAction('@Wound[death]').ok).toBe(false);
    expect(parseAction('@Wound[gunshot double]').ok).toBe(false);
  });

  it('says which wound it rolls, and marks the modifier rather than spelling it', () => {
    installI18n({ 'Mothership.Chat.WoundLabel': 'Roll {wound}', 'Mothership.Table.gunshot': 'Gunshot Wound' });

    expect(actionLabel({ verb: 'wound', table: 'gunshot', advantage: 'none' })).toBe('Roll Gunshot Wound');
    expect(actionLabel({ verb: 'wound', table: 'gunshot', advantage: 'disadvantage' })).toBe(
      'Roll Gunshot Wound [-]',
    );
  });
});

describe('the button', () => {
  it('carries the expression it was written as', () => {
    const button = actionButton(parsed('@Check[fear -]'));

    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.dataset.action).toBe(ACTION_ATTRIBUTE);
    expect(button.dataset.mothershipAction).toBe('@Check[fear -]');
    expect(parsed(button.dataset.mothershipAction ?? '')).toEqual(parsed('@Check[fear -]'));
  });

  it('labels itself from the lang files, and yields to a label the content gives it', () => {
    installI18n({
      'Mothership.RollScope.fear': 'Fear Save',
      'Mothership.Chat.GainLabel': '{amount} {field}',
      'Mothership.Chat.ApplyLabel': '{count} {condition}',
      'Mothership.Chat.SufferLabel': 'Take {condition} Damage',
      'Mothership.Chat.BoundedField': '{bound} {field}',
      'Mothership.Minimum': 'Minimum',
      'Mothership.Stress': 'Stress',
      'Mothership.Table.gunshot': 'Gunshot Wound',
      'Mothership.Chat.DamageLabel': 'Roll {damage}',
    });

    expect(actionLabel(parsed('@Check[fear -]'))).toBe('Fear Save [-]');
    expect(actionLabel(parsed('@Gain[stress 1d5]'))).toBe('+1d5 Stress');
    expect(actionLabel(parsed('@Gain[stress.min 1]'))).toBe('+1 Minimum Stress');
    expect(actionLabel(parsed('@Gain[health -bleeding]'))).toBe('Take Bleeding Damage');
    expect(actionLabel(parsed('@Apply[loss-of-confidence]'))).toBe('+1 Loss Of Confidence');
    expect(actionLabel(parsed('@Table[gunshot]'))).toBe('Gunshot Wound');
    expect(actionLabel(parsed('@Damage[4d10]'))).toBe('Roll 4d10');
    expect(actionButton(parsed('@Apply[coward]'), '+1 Coward').textContent).toBe('+1 Coward');
  });
});

describe('enrichment', () => {
  it('matches every expression in a piece of content', () => {
    const text = 'Make a @Check[fear -] or gain @Gain[stress 1d5]{+1d5 Stress}.';

    expect([...text.matchAll(ACTION_PATTERN)].map((match) => match[0])).toEqual([
      '@Check[fear -]',
      '@Gain[stress 1d5]{+1d5 Stress}',
    ]);
  });

  it('leaves an expression it cannot read as text, so a typo is visible', () => {
    expect(enrichAction(['@Check[luck]', 'Check', 'luck'] as unknown as RegExpMatchArray)).toBeNull();
  });

  it('registers once, however often init runs', () => {
    const enrichers: unknown[] = [];
    (globalThis as Record<string, unknown>).CONFIG = { TextEditor: { enrichers } };

    registerEnrichers();
    registerEnrichers();

    expect(enrichers).toHaveLength(1);
  });
});
