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
import { collected, probe, type Row } from './fixtures/fallthrough-probe.ts';

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
