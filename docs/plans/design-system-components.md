# Design system — unify the controls onto a shared scale

Handover for a fresh thread. Written 2026-08-23, at `bf5ad4b`.

## The task

Unify the system's UI into **a small set of primitives with a cohesive size/variant scale**, so a
component is configured rather than restyled. `@motion-proto/live-tokens` is the reference model.

The objective is **convergence, not preservation**. Where components differ today, assume the
difference was inherited until someone shows it was chosen — the measurements below say most of it
was not.

### What is actually wrong

Two facts that look contradictory and are both true:

| Measured at `bf5ad4b` | |
|---|---|
| Components with scoped styles | 37 |
| Property clusters written 3+ times across components | **0** |
| Hard-coded literals with a token available | **0** |
| Declarations referencing a token | 1133 of 2074 |
| Distinct `<input>` geometries | **8**, across 8 classes / 144 instances |
| Distinct `<button>` geometries | 3, across 3 classes / 8 instances |

So there is **no copy-paste to delete** — S9 already collapsed that (CheckField's twin, the two
popup bodies, the trauma box, the armour bar, the black pill; see `git log`). What is left is
**uncontrolled divergence**: every component reached for its own values, and nothing ever
reconciled them. Nothing to delete, a great deal to converge.

### The evidence that the divergence is accidental

Measured live across the character, creature and five item sheets (157 controls):

```
  font  radius   bw  line-h  box   class
  36px     4px  0px  39.6px   40   input.creature-name.noborder
  32px    48px  3px    32px   66   input.circle-input
  24px     4px  0px    32px   32   input.maxhealth-input (darkGreyText | whiteText)
  24px    48px  3px    32px   50   input.circle-input
  20px   999px  0px    32px   26   input.stat-modifier-field
  16px     4px  0px    32px   32   input.textvaluewrapper-input, input.noborder
14.4px     0px  0px    18px   21   input
14.4px     4px  1px    32px   32   input
```

Three tells, none of which a designer would have chosen:

1. **Two tokens for one intent.** `circle-input` rounds with `--radius-4xl` (48px);
   `stat-modifier-field` with `--radius-full` (999px). At `circle-input`'s 66px box, 48px is not
   even fully round.
2. **`line-height: 32px` is pinned across font-sizes from 14.4px to 36px** — at 36px it is smaller
   than the font. That is an inherited constant, not a decision.
3. **`darkGreyText` / `whiteText` are separate classes on the same input.** A colour variant
   encoded as a class is precisely what a prop should carry.

Buttons are nearly healthy already: 3 geometries, two differing only in `line-height`
(`13.6px` vs `normal`) — 2 real designs and a slip. **Inputs are the problem**, and a cohesive
scale should land near three sizes, not eight.

### The shape to aim for

- A **size scale** (roughly sm / md / lg) that inputs, buttons, selects and textareas all draw
  from, replacing the current per-component font/radius/height triplets.
- **Variants as props, not classes** — tone (`darkGreyText`/`whiteText`), shape (circle, stadium,
  square), and border presence (`noborder`) are all props of one primitive.
- **One rounding vocabulary.** Decide between `--radius-4xl` and `--radius-full` for "fully
  round" and retire the other from control styling.
- **Line-height derived from the size step**, not a constant.

30 components already define Layer-2 `--<componentid>-*` tokens (CreatureSheet 44, ChoiceList 36,
ArmorBlock 28, …). That convention is the seam to build the scale on — a primitive should read its
size step from tokens the same way.

Expect this to move pixels. That is the point, and `test/e2e/visual-baselines.spec.ts` at
`maxDiffPixels: 0` is the review mechanism: every change is either intended and regenerated, or
caught.

### The starting point

The still-open S9 item in `CLAUDE.md` belongs to this work: **the shared stat vocabulary in
`css/mothership.css` that six components hand-write**, explicitly blocked on MainStat/CircleStats
growing variants. It is the one place with a named, waiting consumer — and `circle-input`'s two
sizes and stray 48px radius sit right in it.

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
