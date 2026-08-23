# Design system — primitives with variants

Handover for a fresh thread. Written 2026-08-23, at `bf5ad4b`.

## The task

Extract the system's UI into **reusable primitives with a variant API**, so a component is
configured rather than restyled. `@motion-proto/live-tokens` is the reference model.

**Scope this correctly — the obvious framing is wrong.** "We hardcode and recreate every time"
does not survive measurement:

| Measured at `bf5ad4b` | |
|---|---|
| Components with scoped styles | 37 |
| Property clusters written 3+ times across components | **0** |
| Components hand-styling a raw control | 8 (`button` 5, `input` 3, `textarea` 2, `select` 1) |
| Declarations referencing a token | 1133 of 2074 |
| Hard-coded literals with a token available | **0** |

The S9 audit already collapsed the real duplications (CheckField's twin, the two popup bodies,
the trauma box, the armour bar, the black pill — see `git log`). There is no copy-paste left to
delete.

The actual gap is that **no primitive exists to configure**. Five components each style their own
`<button>` because there is no `Button`. That is extraction of a variant API, not deduplication —
and the difference matters, because most per-component styling is *legitimate* variation that must
survive the refactor, not be flattened into a common look.

## The inventory to design against

Every bespoke control class the system renders (Foundry's own `header-control` buttons excluded —
those stay Foundry's):

```
button:    cover-choice · damage-mode-add · stepper-step · icon.toggle (Foundry's ProseMirror)
input:     circle-input · creature-name.noborder · maxhealth-input · textvaluewrapper-input
           stat-modifier-field · noborder · (bare)
select:    textvaluewrapper-input
textarea:  textarea-input
```

These are the variants to name. They differ in geometry — padding, radius, font-size,
line-height — by design; `input.circle-input` and `input.maxhealth-input` genuinely want
different sizes. A variant API has to express that, not erase it.

30 components already define Layer-2 `--<componentid>-*` tokens (CreatureSheet 44, ChoiceList 36,
ArmorBlock 28, …). That convention is the seam a variant API should build on, not replace.

The still-open S9 item from `CLAUDE.md` belongs to this work: **the shared stat vocabulary in
`css/mothership.css` that six components hand-write**, which needs MainStat/CircleStats to grow
variants before it can move. Start there — it is the one place with a named, blocked consumer.

## What the last thread established

Four findings that cost real effort. **They should graduate into `CLAUDE.md`'s Gotchas** — this
file is transient, that one is not.

1. **Foundry v14's layer order is**
   `reset, variables, elements, blocks, applications, compatibility, layouts, system, modules, exceptions`.
   `system` is ours and sits after everything core styles itself with, so **our rules beat every
   layered Foundry rule regardless of specificity**. No `!important` is ever needed to override
   core. Verified: a bare one-class rule in `system` overrode `.application .window-header
   .window-title`. The `!important` ceiling of 0 is not a constraint on this work.

2. **Because layer beats specificity, a heavy selector in a shared tier outranks our own
   components too.** Shared rules must stay low-specificity — use `:where()` for exclusions, which
   contributes zero. `css/mothership.css`'s control tier is written this way and says so at the
   site. Any new shared tier must follow it or it will silently defeat component styles.

3. **Font Awesome is unlayered** (4,395 rules) and therefore outranks everything layered,
   including us. Never fight it. Only `font-family` and `font-weight` select a glyph's face — every
   other property is safe on an icon button. Owning `font-family` on all buttons blanked Foundry's
   ProseMirror toggle; the fix was excluding the two face-selecting properties, not the element.

4. **`.icon` and `[class*="fa-"]` mark Foundry's glyph buttons.** No button of ours wears either,
   so they are a safe discriminator.

## Tools you inherit

```bash
npm run audit:tokens        # static: literals vs the token scales; --assert-none is ratchet-ready
npm run audit:fallthrough   # runtime: who supplies each themable property, us or Foundry
```

- `scripts/audit-tokens.ts` — classifies every declaration (exact / near / arithmetic / unscaled /
  colour). Currently **0 actionable**. Its `REVIEWED` allowlist records two geometry literals kept
  on purpose. It does **not** catch string literals — a hard-coded font stack slips past it.
- `test/e2e/fallthrough-audit.spec.ts` + `test/e2e/fixtures/fallthrough-probe.ts` — the in-page
  probe. `test/e2e/fixtures/surfaces.ts` holds the fixtures and openers shared with the visual
  baselines, so both photograph the same furniture.
- `docs/audits/fallthrough.json` — the current report.

**The probe overstates by 108.** Its `contested` verdict means "we and Foundry both declare it",
but given the layer order we always win those. Teach it the layer order before trusting the number.

### Current state of the report

```
305 findings · 193 uncovered · 108 contested · 4 inherited · 0 move with the core theme
```

Down from 572 / 271 inherited / 99 themed. The 4 remaining `inherited` are deliberate: the
ProseMirror pencil's `font-size`, the hidden `window-icon`'s colour and size (window frame is
Foundry's), and `<option>`'s line-height (the OS draws native dropdowns). The 193 `uncovered` are
overwhelmingly per-component geometry, which is the variant surface — not a defect list.

## Reference material

- **LiveTokens**: `/Users/mark/Documents/repos/motionproto-repos/live-tokens`
- **A real consumer**: `/Users/mark/Documents/repos/runegoblin/runegoblin-site` imports
  `@motion-proto/live-tokens` (`Callout.svelte`, `Table`, a component-config convention, and
  auto-generated component-config dirs that are committed). Read the consumer as well as the
  library — it shows the API in practice.
- **This system's own gallery**: `npm run design` mounts every component at its real window width
  and is test-pinned to full coverage by `test/design-gallery.test.ts`. It imports the real
  components and stylesheets, so it is the place to see a variant API before it ships.

## Loose end

**11 visual baselines are stale** and need review, then `--update-snapshots`:
character/creature/item/weapon/armor/ability/condition/class/skill sheets, the rolltable config
window, and the rollTable card. ~1,350px of that drift came from the style-ownership commit; the
rest predates it (`f2a1c33`). Review the diffs before regenerating — `maxDiffPixels: 0` is the
point of that tier.

## Verification tiers

`npm test` (1062 specs, ~3s) and `npm run check` (~3s) on every change. `npx playwright test
<spec>` while iterating; `test/e2e/README.md` maps source area to spec. The full e2e suite is ~8
minutes and is a pre-commit gate, not a per-change tier. For this work specifically,
`test/css-guards.test.ts`, `test/ui-parts.test.ts` and `test/design-gallery.test.ts` are the
component contract — 151 specs, and they run in the vitest tier.
