# Mothership — project rules

The unofficial **Mothership** system for Foundry VTT. A Foundry **system** (not a module):
`system.json` is the manifest, `module/index.js` the esmodule (css + `init.ts`), built by Vite to
`dist/mothershiprpg.{js,css}`, plus compendium content built from JSON in `packs/_source/`.

**Detailed conventions live in the `foundry-mothership` skill** (`.claude/skills/foundry-mothership/`) —
the v14 API surface, Svelte-in-ApplicationV2, the test tiers, packs, and the build. Consult
it for any of those; it loads on demand so this file stays short. Here: only the hard rules
and what is specific to this repo.

Code style: global `~/.claude/CLAUDE.md` — comment only the non-obvious *why*.

## Where the project is

**The goal: our own implementation of Mothership 1e, complete and faithful to the Player's
Survival Guide, containing nothing else — then extend one book at a time.** The Warden's
Operations Manual is next; the Shipbreaker's Toolkit brings ships back.

**There is no plan file.** `docs/plans/` is empty: the design system finished on 2026-08-15 and
its plan was deleted with the rest — the PSG core (S1–S8), the legacy remake (R0–R7; the runtime
core is typed services), the architecture review, its evidence file, and the run-to-the-end
protocol. **Git history is the record of what happened** — `git log -S"<symbol>"` finds the
commit that introduced or removed anything, with the diff and the reasoning attached, and
`git show <commit>:docs/plans/<file>` recovers any deleted plan (the design system's is at
`24fe460`, and its §4.7 literal→token map is the reference for anything the sweep did not
reach). Still open, recorded here so it keeps a home: the **last S9 call site** — the shared
stat vocabulary in `css/mothership.css`, which six components hand-write and no scoped block can
reach, and which needs MainStat/CircleStats to grow variants before it can move; `checkJs` over
`module/ui/**`; `template.json`'s retirement once a generated type snapshot is mutation-proven
(v16 removes support regardless); and the open U-series findings in
`docs/audits/architecture-audit.md`. Durable knowledge belongs in a test, in a comment at the
site, or in the Gotchas below; not in a prose log.

**Ships, the Calm/android panic variants and all unsourced content were cut** and live on
master's own history at ancestor `11eee67` (the archive refs were trimmed 2026-08-13 — a label
on an ancestor preserves nothing history doesn't; `git show 11eee67:<path>` recovers any cut
file). Nothing was destroyed; ships return as an
additive book tier. **Do not re-add content without a book behind it.**

**Port, verify, ship, and record the compromise.** Conversions deliberately kept AppV1-era
shapes so each carried no visual risk; the S9 audit has since collapsed the duplications those
left — CheckField's swarm twin, the two popup bodies, the trauma box, the armour bar, the black
pill — leaving one call site, the shared stat vocabulary.

| Done | Not done |
|---|---|
| Vite build, TS tooling, CI | S9's last call site — the shared stat vocabulary |
| DataModels for the 9 surviving types | |
| Packs generated from the book, 0e removed | |
| Svelte 5 wired into build, check, vitest | |
| **Every item sheet on ApplicationV2 + Svelte** | |
| **The creature sheet, on shared sections** | |
| **The character sheet — no AppV1 class, no sheet template left** | |
| Shared components in `module/ui/parts/`, sections in `parts/sections/` | |
| 0e / `firstEdition` rules removed | |
| `creature-settings` on ApplicationV2 | |
| The PSG cut — 13,337 lines removed | |
| **274 documents generated from the PSG** | |
| Both class adjustments are real `SchemaField`s | |
| **The character generator, on a draft store** — no `FormApplication` left | |
| **Conditions preselect the roll they name** | |
| **The runtime core remade — `actor.js`/`mosh.js` gone for typed services, sheets adopted them (R7)** | |
| **Damage rolled for real, and applied to the targeted actor** | |
| **A socket action dispatcher — players apply through the Warden's client** | |

## Hard rules (override defaults)

- **v14 only in new code.** Everything under `foundry.*`. No bare `Application` /
  `FormApplication` / `Dialog` / `duplicate` / `mergeObject` — those are deprecated with a
  **v16** removal. New windows are ApplicationV2, dialogs DialogV2, data
  `foundry.abstract.TypeDataModel`. Existing v1 code is mid-migration: don't add to it;
  when you touch a v1 class, prefer converting it whole.
- **TypeScript for tooling, and for the runtime core.** `*.config.ts`, `scripts/*.ts`,
  `test/**/*.ts` **and `module/**/*.ts`** are checked by `npm run check`. Node ≥22.18 runs `.ts`
  scripts directly — no `tsx`/`ts-node`.
  **The runtime core was remade in TypeScript, not migrated** (the legacy remake, R0–R7;
  `git log --grep='^R[0-9]'`) — `actor/actor.js`, `mosh.js`, `item/item.js` and the old
  `settings.js` are **gone**, deleted at the R5 swap, replaced by typed modules under `module/`
  (`documents/`, `checks/`, `mutation/`, `rolls/`, `tables/`, `chat/`, `api/`, …). Nothing was
  translated file-by-file; there is no per-file `// @ts-check` migration. `module/ui/**` stays
  `.js`/`.svelte`, `checkJs: false`.
- **Verify, don't eyeball — and pick the tier.** `npm test` and `npm run check` cost about three
  seconds each: run both on every change. **The e2e suite is ~8 minutes and is not a per-change
  tier.** While iterating, run only the spec that covers what you touched —
  `npx playwright test <spec>`, 15–60s, and `test/e2e/README.md` maps source area to spec. The
  whole suite is a gate before committing runtime behaviour, or when asked; not a reflex after
  every edit. Don't report work as done on an untested edit. If a green run surprises you,
  suspect the harness.

## Commands

```bash
npm run build            # vite → dist/
npm run setup            # dev install: symlink scaffold (packs are COPIED — re-run after packing)
npm run deploy           # release rehearsal: link-free copy, same shape as the zip
./scripts/packs.sh pack  # packs/_source/*.json → LevelDB (close Foundry first)
npm run content -- --allocate  # content/books/** -> packs/_source/** (--allocate mints new ids)
npm test                 # 1048 vitest specs — the CI tier, ~3s
npm run check            # tsc over the .ts surface, then svelte-check over module/ui, ~3s
npx playwright test <spec>   # ONE e2e spec — the iterating tier, 15-60s
npm run test:e2e         # all 173 Playwright specs vs a real headless Foundry — ~8min, a gate
npm run design           # the design-system app on :30010 — tokens, and every component
```

A fresh clone needs `npm ci && npm run build && ./scripts/packs.sh pack` — both `dist/` and
`packs/` are gitignored build output.

## This repo's specifics

- **System id `mothershiprpg`** — keys settings, flags, pack names
  (`mothershiprpg.<pack>`), the runtime path `systems/mothershiprpg/…`, **and the public API
  `game.mothershiprpg`**. One string identifies the package everywhere. **The `mosh` retirement
  is complete** (design-system DS1–DS9): the scope class is `.mothership`, the lang root is
  `Mothership.*`, the classes are `Mothership*`, and the prose, the skill directory
  (`foundry-mothership`) and the three `system.json` art files all say Mothership too. `grep -w
  mosh` now finds only justified history: the local `TEST_WORLD` Foundry world folder, which is
  outside the repo; the deleted files `mosh.js`/`css/mosh.css` named in comments and in
  `docs/audits/architecture-audit.md`, which records the pre-rename codebase and must not be
  rewritten; the content-pipeline spec that asserts a link naming the pre-rename package is
  rejected; and `LICENSE.txt`'s 2021 copyright line. The one content-baked survivor,
  `data-mosh-voice` in the Panic table, was regenerated as `data-mothership-voice`. Never name
  anything new `mosh` or `ms`.
- **`module/dispatch/` is the one socket pipeline.** `dispatch(action, data)` runs the handler
  here when this client is the Warden and otherwise asks the Warden's client to, awaiting a
  correlated reply. It answers `no-gm`/`timeout`/`failed` as *values*, the way `lookup.ts` does, so
  a caller that can do the work itself falls back instead of catching. Modelled on
  pf2e-reignmaker's ActionDispatcher. **The dispatcher authorizes nothing** — a handler runs with
  the Warden's permissions, so it must authorize its own sender. `checks/harm.ts`'s `harmFromCard`
  is the worked example: it re-reads the amount off the card rather than believing the request,
  requires the sender to own that card, and requires the target to be one the card recorded.
  **A new action that trusts a number off the wire is a hole.**
- **`game.mothershiprpg` is the public API.** The verb surface — `rollStat`, `rollSkill`,
  `rollWeapon`, `rollTable`, `modify`, `applyItem`, `promptStress`/`promptSave`/`promptWound`,
  `rollItem`, … (`module/api/api.ts`) — is what shipped macros and new content call.
  `rollItemMacro`/`initRollTable`/`initRollCheck`/`initModifyActor`/`initModifyItem`/
  `noCharSelected` and the legacy actor methods survive as a deprecated shim (`module/api/legacy.ts`)
  for macros already imported into worlds. **Changing either surface's signature breaks something** —
  grep `packs/_source/` for the new verbs, `test/api-legacy.test.ts` pins the old ones.
- **Strings** live in `lang/en.json` under `Mothership.*` — the only language the manifest
  declares. The `pt-BR` translation was pulled on 2026-08-21 and sits unbuilt and untested in
  `docs/archive/lang/`; see the README beside it before reviving it.
- **CSS is hand-authored, not compiled** — no SCSS step (the `scss/` tree was 17 months stale
  and was deleted). `css/tokens.css` holds the Layer-1 design tokens (~400, adapted from
  live-tokens, scoped to `.mothership` inside `@layer system`); `css/mothership.css` holds
  `@font-face`, branding, the chat cards, and the declared **shared tier** (classes several
  components hand-write — each rule is tagged with its readers). Component-owned styles live
  in scoped `<style>` blocks that open with `@layer system` and read only their own
  `--<componentId>-*` tokens. `test/css-guards.test.ts` enforces the `!important` ceiling,
  zero unlayered rules (source and bundle), and zero token-name collisions with the installed
  Foundry build; `scripts/audit-css.ts --assert-none` proves no stylesheet class is dead.
- **`template.json` is inert but kept on purpose** — it is the oracle the DataModel
  equivalence tests compare against. Changing a schema means changing both, deliberately.
- **New UI lives in `module/ui/`** — an ApplicationV2 shell per window plus Svelte 5
  components (runes mode is forced on). The conventions: the document stays the source of
  truth, Foundry persists the form, mount once.
- **`module/ui/parts/` holds the shared primitives** — `ItemList`/`ItemRow`/`ItemCell`/
  `ItemControls`/`ItemControl`, `Tabs`/`TabPanel`, `CircleStats`, `MainStat`, `Field`,
  `CheckField`, `ChoiceList`, `Editor`, `SheetHeader`, `MinMaxField`, `PipTrack`, `RollableStat`,
  `ItemImage`, plus the `dropTarget` attachment. **`ChoiceList` is the one list this system
  selects from** — the roll prompts and the compendium pickers both draw their rows from it;
  a new "pick one of these" window configures it (`headers`, `filterLabel`, `cells`, `trailing`)
  rather than writing rows of its own. It is a real `<table>`: columns are `<col>`s, the
  description spans with `colspan` and the trailing cell holds both rows with `rowspan`, and
  selection is one native radio group, which is where the arrow keys and `Enter` come from. The
  radio itself is visually hidden and a span draws the mark — Foundry's core theme reaches
  `input[type="radio"]` from outside every layer, so styling it would take `!important`.
  **The compendium picker lists the world as well as the pack** — `PickFromPack` shows
  `game.items` of the type beneath the pack rows under a group heading, keyed by uuid because the
  two halves are separate id spaces, and its **Create** writes a world document and opens its
  sheet. Create is a body control, not a footer button: a footer button answers the dialog, and
  the point is that it stays open so the new row can be picked out of the list it just joined.
  The world half is live off the `createItem`/`updateItem`/`deleteItem` hooks. Build a conversion out of these before
  writing bespoke markup. Most own their styles in scoped `<style>` blocks; classes still
  served by `css/mothership.css`'s shared tier keep their pins in `test/ui-parts.test.ts`,
  because that half of the contract still has no compiler.
- **`design/` is the design-system app** — `npm run design`, three pages: Layer 1 out of
  `css/tokens.css` (colour regrouped by family, the way `PaletteEditor.svelte` groups it — ramp on
  top, Surfaces/Borders/Text beneath), Layer 2 out of every scoped `<style>` block, and one
  specimen per component, each staged at its window's real width.
  It **imports the real components and the real stylesheets**, so an edit there is an edit to the
  system; the only thing it owns is the sample props, its own chrome and the readers. It parses
  rather than transcribes — a new token or component appears without editing the app — and it is
  outside both `scripts/audit-css.ts`'s corpus and `test/css-guards.test.ts`'s directory on
  purpose, so it can never keep a dead class alive. `test/design-gallery.test.ts` mounts every
  specimen, holds the gallery to covering every component under `module/`, asserts no Layer 2
  token sits under another component's prefix, and pins the chrome's own typography — a 14px
  floor, no uppercase labels, and every ink measured at 4.5:1 or better on every ground it is
  printed on. The shell is the Live Tokens editor panel's, in its `--ui-*` vocabulary.
  `design/README.md` has the rest.
- **Manifest URLs point at `rune-goblin`**. `manifest` must stay on
  `/releases/latest` or Foundry can never detect an update; `download` is version-specific and
  is stamped by `release.yml` from the tag — don't hardcode it.

## Not in scope

- **Both third-party content modules are dropped from the merge**.
  `mothership-survival-guide` is GPL-3 (absorbing it would relicense this MIT system) and
  `mothership-character-builder` declares no licence and is Naurgul's. Only rune-goblin's own
  extraction merges. Don't merge content whose provenance is unsettled.

## Gotchas

- **Check that a "source" is really the source.** Two dead sources have already been found
  and deleted (`scss/`, `_macros/`), each duplicating something that had moved on. Before
  building from any input, verify it produces what actually ships.
- **`packs/_source/**` is generated — do not hand-edit it.** The real source is
  `content/books/psg/*.ts` (typed catalogs); `npm run content` emits the pack sources and
  `packs.sh pack` compiles them. `packs/` and `dist/` are never committed; `packs/_source/` is.
- **A sheet can bind a field no schema declares.** A `SchemaField` cleans off keys it does not
  know, so the write is accepted and silently discarded. That is how the DataModel migration
  stopped armour from equipping; twelve such fields were found and restored.
  `test/sheet-bindings.test.ts` pins all 13 types.
- **Foundry holds an exclusive LevelDB lock** on every pack it can see; `packs.sh` refuses
  to run while it is open. That guard is deliberate.
- **`packs.sh pack` never deletes — not a pack, and not a document.** `fvtt package pack` writes
  and updates LevelDB keys; it removes nothing. So **deleting a source JSON does not delete the
  document**: it stays in the compiled pack and Foundry keeps serving it. A whole pack whose
  source is gone survives the same way. Both `packs/` and the e2e tree's
  `test/foundry-data/Data/systems/mothershiprpg/packs/` are affected, and they are separate
  copies. **After removing any source document, `rm -rf` the compiled pack directories in both
  places and re-pack from scratch** — otherwise every count assertion passes against ghosts.
- **Never hand-edit `test/foundry-data/.../packs` — it is rebuilt on every e2e boot.**
  `start-test-env.sh` runs `setup-test-env.ts` before each launch, which re-clones the system
  **from your live Foundry Data dir**. So the real sequence after changing pack *sources* is:
  `./scripts/packs.sh pack` → **`npm run setup`** (refreshes the live Data dir, which is where
  the harness clones from) → `npm run test:e2e`. Skipping `npm run setup` means the suite keeps
  testing the packs from whenever you last ran it, no matter what you do to the test tree.
  Together with the point above this cost four e2e cycles during the PSG cut. `npm run test:e2e`'s
  script runs all three steps itself now (audit C5) — this trap is only live if you run
  `packs.sh` and `playwright test`/`test:e2e:run` by hand instead.
- **A killed e2e run leaves a lock, not an occupied session** (this entry used to say the
  opposite). Foundry locks its data dir as `Config/options.json.lock`, a **directory**, and only
  releases it on a clean exit; `kill -9` leaves it behind and the next boot dies with *"already
  locked by another process"*, which Playwright reports as the contentless `webServer was not able
  to start. Exit code: 1`. Freeing the port does **not** clear it — which is why the old advice
  here appeared to fail. `start-test-env.sh` now clears a stale lock itself (port free ⇒ stale),
  so prefer `npm run test:e2e` over a hand-started server, and kill with **`kill`** rather than
  `kill -9` so Foundry unlocks on its way out.
- **An `[[inline]]` roll in card content is rolled again by every client.** Foundry enriches a
  message's content in `ChatMessage#renderHTML`, per viewer, and an inline roll with no command is
  evaluated during that enrichment — so the Warden and each player saw a *different* damage number,
  and none of them was a number the system could apply. Damage is now a real `evaluateRoll`, printed
  through `rollHtml` and carried on the message's `rolls`. **Never state a number in card content as
  `[[…]]`.**
- **Rolling a wound table charges a Wound.** `runTable` adds one to `system.hits.value` for every
  table whose definition says `wound: true` — PSG 29.1, where rolling *is* taking the Wound. Damage
  that empties the bar has already spent one in `planHealthChange`, so the roll it leads to passes
  `costsWound: false`. Anything else that rolls a wound table after damage must do the same, or one
  hit costs two Wounds. `@Wound[…]` is that roll as a button — unlike `@Table[…]`, it rolls against
  the actor whose card it sits in rather than whoever clicks it.
- **`resolveOutcome` reports the die it *kept*, which is a rule about checks.** A damage roll is
  Foundry's own arithmetic: `2d10` sums, `{d,d}kh` keeps by the formula's own modifier. Read
  `roll.total`, not `outcome.total` — `mutate.ts`'s `changeAmount` draws the same line, and a
  one-die test stub hides the difference.
- **`prepareDerivedData` mutates `this.system` in place.** Assert stored data with
  `doc.toObject().system`, never `doc.system`. **The exception is anything only the derivation
  knows** — `stats.armor.damageReduction` sums worn suits and cover, so `checks/harm.ts` reads it
  off `system` deliberately.
- **A token is unlinked unless it says so, and its `actor` is the synthetic one.** Writing to it
  lands in the token's delta, not on the base actor — which is what a hit should do. An e2e test
  that creates a token and then asserts against the *base* actor watches a number that never moves.
- **A package's socket channel is dead unless the manifest says `"socket": true`.** Foundry's
  `Package#registerCustomSocket` returns early without it, so the server never relays
  `system.mothershiprpg` and every request just times out — no error, anywhere.
  `test/dispatch.test.ts` pins the flag, because nothing in the code can notice its absence.
- **Only `game.users.activeGM` may execute a relayed action.** Every GM client receives the
  request; without that gate a table with two Wardens applies all damage twice. Replies are
  broadcast too — Foundry sockets have no point-to-point send — so a reply carries `targetId` and
  every other client drops it.
- **`Actor.create` returns `undefined` on a validation failure** — it does not throw.
- **Update paths are `system.*`.** The `data.` alias was removed in v10; six updates were
  still using it and silently doing nothing.
- **History was rewritten** (`git filter-repo`, to drop 854 MB of committed release zips) and
  has now been **force-pushed**; `master` tracks `origin/master`, so plain `git push` works.
  The pre-rewrite history is gone from both the remote and this clone.
  Anyone holding an older clone must re-clone.
