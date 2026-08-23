// An inventory, not a test: it asserts nothing and fails nothing. For every element our windows
// render, it asks who supplies each themable property -- us, or Foundry. A property no Mothership
// rule declares is one the core theme owns, and a Foundry release can move it under us.
//
//   AUDIT_FALLTHROUGH=1 npx playwright test test/e2e/fallthrough-audit.spec.ts
//
// Writes docs/audits/fallthrough.json. Skipped unless that variable is set, so the e2e gate does
// not pay for it and no ordinary run rewrites the report.
import { writeFileSync } from 'node:fs';
import { test, expect } from './fixtures/foundry-clients.ts';
import { CHARACTER, CREATURE, HORROR, ITEM_SHEETS, LOADOUT, openActor, openItem } from './fixtures/surfaces.ts';

type Row = {
  surface: string;
  signature: string;
  prop: string;
  verdict: 'uncovered' | 'contested' | 'inherited';
  supplier: string;
  value: string;
  themed: boolean;
};

const collected: Row[] = [];

/* eslint-disable @typescript-eslint/no-explicit-any */
function probe({ rootSelector, surface }: { rootSelector: string; surface: string }): Row[] {
  // Anything served out of the system's own directory is ours -- tokens.css, mothership.css and
  // every scoped <style> block arrive in one bundled sheet under that path.
  const isOurs = (sheet: CSSStyleSheet | null) => !!sheet?.href?.includes('systems/mothershiprpg/');

  const INHERITED = new Set([
    'color', 'font-family', 'font-size', 'font-weight', 'font-style',
    'line-height', 'letter-spacing', 'text-transform', 'text-align',
  ]);
  const PROPS = [
    ...INHERITED,
    'background-color', 'background-image', 'border-top-width', 'border-top-style',
    'border-top-color', 'border-top-left-radius', 'padding-top', 'padding-left',
    'margin-top', 'margin-left', 'row-gap', 'column-gap', 'box-shadow',
    'outline-width', 'outline-color', 'opacity',
  ];

  // Who declares what, per element. Built rule-first: one querySelectorAll per rule beats
  // matching every rule against every element by three orders of magnitude.
  const declarers = new Map<Element, { ours: Set<string>; theirs: Map<string, string> }>();
  const entry = (el: Element) => {
    let found = declarers.get(el);
    if (!found) declarers.set(el, (found = { ours: new Set(), theirs: new Map() }));
    return found;
  };

  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules) as any[]) {
      // Foundry reaches its own CSS, and ours, through `@import` from an inline <style>: an
      // imported sheet is never a member of document.styleSheets, so a walker that does not
      // follow this sees sixteen rules and calls the rest of the cascade absent.
      if (rule.styleSheet) walk(rule.styleSheet.cssRules);
      if (rule.cssRules) walk(rule.cssRules);
      if (!rule.selectorText || !rule.style) continue;

      const declared = PROPS.filter((prop) => rule.style.getPropertyValue(prop));
      if (!declared.length) continue;

      let matched: Element[];
      // A selector carrying `::before` or a syntax this engine will not query throws here; the
      // rule paints something no element owns, so dropping it loses nothing.
      try {
        matched = Array.from(document.querySelectorAll(rule.selectorText));
      } catch {
        continue;
      }
      const ours = isOurs(rule.parentStyleSheet);
      const origin = ours ? '' : `${(rule.parentStyleSheet?.href ?? 'inline').split('/').pop()} ${rule.selectorText}`;
      for (const el of matched) {
        const record = entry(el);
        for (const prop of declared) {
          if (ours) record.ours.add(prop);
          else record.theirs.set(prop, origin);
        }
      }
    }
  };
  for (const sheet of [...Array.from(document.styleSheets), ...((document as any).adoptedStyleSheets ?? [])]) {
    try {
      walk(sheet.cssRules);
    } catch {
      // A cross-origin sheet refuses to be read; nothing we ship is one.
    }
  }

  const root = document.querySelector(rootSelector);
  if (!root) throw new Error(`no element matched ${rootSelector}`);

  // The theme is the second question: a property we do not declare only bites when Foundry's
  // answer to it moves. Flipping the class and re-reading is the whole test.
  // v14 stamps the theme on <body> and again on every application frame — never on <html>, which
  // is the node this first reached for, and reading it found no theme and reported nothing themed.
  const themed = Array.from(document.querySelectorAll('.theme-dark, .theme-light'));
  const roots = document.body.matches('.theme-dark, .theme-light') ? [document.body, ...themed] : themed;
  const flip = (el: Element) => {
    const from = el.classList.contains('theme-dark') ? 'theme-dark' : 'theme-light';
    el.classList.replace(from, from === 'theme-dark' ? 'theme-light' : 'theme-dark');
  };

  const elements = Array.from(root.querySelectorAll('*'));
  const before = elements.map((el) => {
    const style = getComputedStyle(el);
    return Object.fromEntries(PROPS.map((prop) => [prop, style.getPropertyValue(prop)]));
  });

  let after = before;
  if (roots.length) {
    roots.forEach(flip);
    after = elements.map((el) => {
      const style = getComputedStyle(el);
      return Object.fromEntries(PROPS.map((prop) => [prop, style.getPropertyValue(prop)]));
    });
    roots.forEach(flip);
  }

  const signature = (el: Element) =>
    el.tagName.toLowerCase() +
    Array.from(el.classList)
      .filter((name) => !name.startsWith('svelte-'))
      .sort()
      .map((name) => `.${name}`)
      .join('');

  const rows: Row[] = [];
  elements.forEach((el, index) => {
    for (const prop of PROPS) {
      const mine = declarers.get(el)?.ours.has(prop);
      const theirs = declarers.get(el)?.theirs.get(prop);

      let verdict: Row['verdict'] | undefined;
      let supplier = theirs ?? '';

      if (mine && theirs) verdict = 'contested';
      else if (!mine && theirs) verdict = 'uncovered';
      else if (!mine && !theirs && INHERITED.has(prop)) {
        // Nobody dressed this element, so the value walked down to it. The first ancestor that
        // does declare the property is the real supplier, and it may sit outside our windows.
        for (let up = el.parentElement; up; up = up.parentElement) {
          const above = declarers.get(up);
          if (above?.ours.has(prop)) break;
          if (above?.theirs.has(prop)) {
            verdict = 'inherited';
            supplier = above.theirs.get(prop)!;
            break;
          }
        }
      }
      if (!verdict) continue;

      rows.push({
        surface,
        signature: signature(el),
        prop,
        verdict,
        supplier,
        value: before[index][prop],
        themed: before[index][prop] !== after[index][prop],
      });
    }
  });
  return rows;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

test.describe('fall-through audit', () => {
  test.skip(!process.env.AUDIT_FALLTHROUGH, 'set AUDIT_FALLTHROUGH=1 to collect the inventory');

  test.afterAll(async ({ gmPage }) => {
    await gmPage.evaluate(async () => {
      const g = (window as any).game;
      const actors = g.actors.filter((a: any) => a.name.startsWith('__audit_')).map((a: any) => a.id);
      if (actors.length) await g.actors.documentClass.deleteDocuments(actors);
      const items = g.items.filter((i: any) => i.name.startsWith('__audit_')).map((i: any) => i.id);
      if (items.length) await g.items.documentClass.deleteDocuments(items);
    });

    // Deduped on the shape of the element rather than the element: a list of forty identical rows
    // is one finding about one component, and the surfaces it appears on are the evidence.
    const merged = new Map<string, Row & { surfaces: string[] }>();
    for (const row of collected) {
      const key = `${row.signature}|${row.prop}|${row.verdict}`;
      const seen = merged.get(key);
      if (seen) {
        if (!seen.surfaces.includes(row.surface)) seen.surfaces.push(row.surface);
        seen.themed ||= row.themed;
      } else merged.set(key, { ...row, surfaces: [row.surface] });
    }

    const findings = [...merged.values()].sort(
      (a, b) => Number(b.themed) - Number(a.themed) || a.signature.localeCompare(b.signature) || a.prop.localeCompare(b.prop),
    );
    const count = (verdict: string) => findings.filter((f) => f.verdict === verdict).length;

    writeFileSync(
      'docs/audits/fallthrough.json',
      `${JSON.stringify({ elements: collected.length, findings }, null, 2)}\n`,
    );
    console.log(
      `\nfall-through: ${findings.length} findings · ${count('uncovered')} uncovered · ` +
        `${count('contested')} contested · ${count('inherited')} inherited · ` +
        `${findings.filter((f) => f.themed).length} move with the core theme\n` +
        `wrote docs/audits/fallthrough.json`,
    );
  });

  test('the character sheet', async ({ gmPage }) => {
    const { appId } = await openActor(gmPage, 'character', '__audit_character', CHARACTER, LOADOUT);
    collected.push(...(await gmPage.evaluate(probe, { rootSelector: `#${appId}`, surface: 'character-sheet' })));

    await gmPage.locator(`#${appId} a.tab-select[data-tab="weapons"]`).click();
    await expect(gmPage.locator(`#${appId} .tab[data-tab="weapons"]`)).toBeVisible();
    collected.push(...(await gmPage.evaluate(probe, { rootSelector: `#${appId}`, surface: 'character-sheet:weapons' })));
  });

  test('the creature sheet', async ({ gmPage }) => {
    const { appId } = await openActor(gmPage, 'creature', '__audit_creature', CREATURE, HORROR);
    collected.push(...(await gmPage.evaluate(probe, { rootSelector: `#${appId}`, surface: 'creature-sheet' })));
  });

  for (const fixture of ITEM_SHEETS) {
    test(`the ${fixture.type} sheet`, async ({ gmPage }) => {
      const { appId } = await openItem(gmPage, fixture.type, `__audit_${fixture.type}`, fixture.system);
      collected.push(...(await gmPage.evaluate(probe, { rootSelector: `#${appId}`, surface: fixture.name })));
    });
  }
});
