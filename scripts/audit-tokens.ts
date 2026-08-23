// A literal is only a defect where a scale exists to hold it: `--space-*` can carry a padding,
// nothing carries a measured column width. So every finding names the family it belongs to, and a
// property with no family is reported as `unscaled` — a Layer-2 token to mint, never an auto-fix.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const ROOT_FONT_SIZE = 16;

/** Property → the Layer-1 family whose steps may hold its value. */
const FAMILIES: [RegExp, string][] = [
  [/^(padding|margin|gap|row-gap|column-gap|inset)(-|$)/, 'space'],
  [/^(top|right|bottom|left)$/, 'space'],
  [/^border-radius$|^border-[a-z]+-radius$/, 'radius'],
  [/^border(-(top|right|bottom|left))?(-width)?$|^outline(-width)?$/, 'border-width'],
  [/^font-size$/, 'font-size'],
  [/^line-height$/, 'line-height'],
  [/^letter-spacing$/, 'letter-spacing'],
  [/^font-weight$/, 'font-weight'],
];

/**
 * Reviewed, and kept literal: each is geometry derived from a sibling measurement, so the nearest
 * scale step is a coincidence and taking it would move pixels. Keyed on the value rather than the
 * line so an edit above does not silently retire the exemption.
 */
const REVIEWED: { file: string; prop: string; literal: string; why: string }[] = [
  { file: 'css/mothership.css', prop: 'top', literal: '-95px', why: 'centres the 200px pause icon, with `left: calc(50% - 100px)`' },
  { file: 'module/ui/generator/SkillSelector.svelte', prop: 'margin', literal: '0.15rem', why: 'centres the 0.4rem dot in its 0.7rem well' },
];

/** Values that carry no design decision: a literal here means nothing and maps to nothing. */
const STRUCTURAL = /^(0|auto|none|inherit|initial|unset|revert|currentcolor|transparent)$/i;

type Declaration = { file: string; line: number; prop: string; value: string };

/** Comments blanked, newlines kept, so a line number survives the strip. */
const decomment = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));

/**
 * Every `prop: value` inside a block. A prelude ends at `{` and is never emitted, which is what
 * keeps `@media (max-width: 40rem)` — a breakpoint, not a declaration — out of the corpus.
 */
function declarations(css: string, file: string, lineOffset = 0): Declaration[] {
  const found: Declaration[] = [];
  let statement = '';
  let depth = 0;
  let parens = 0;
  let quote = '';
  let line = 1;
  let startLine = 1;

  const flush = () => {
    const match = /^\s*(--[\w-]+|[a-zA-Z-]+)\s*:\s*([\s\S]+?)\s*$/.exec(statement);
    if (match && depth > 0) {
      found.push({ file, line: startLine + lineOffset, prop: match[1], value: match[2] });
    }
    statement = '';
  };

  for (const char of decomment(css)) {
    if (char === '\n') line++;

    if (quote) {
      statement += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; statement += char; continue; }
    if (char === '(') parens++;
    else if (char === ')') parens--;

    if (parens > 0) { statement += char; continue; }

    if (char === '{') { statement = ''; depth++; }
    else if (char === '}') { flush(); depth--; }
    else if (char === ';') flush();
    else {
      if (!statement.trim() && char.trim()) startLine = line;
      statement += char;
    }
  }
  return found;
}

function filesUnder(dir: string, extension: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

/** A `<style>` block's declarations, carrying the line offset back to the .svelte file. */
function svelteDeclarations(path: string): Declaration[] {
  const source = readFileSync(path, 'utf8');
  const file = relative(REPO, path);
  const found: Declaration[] = [];

  for (const match of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const before = source.slice(0, match.index + match[0].indexOf(match[1]));
    found.push(...declarations(match[1], file, before.split('\n').length - 1));
  }
  return found;
}

/* -------------------------------------------- */
/*  The scales                                  */
/* -------------------------------------------- */

type Step = { name: string; raw: string; px: number };

const tokensCss = readFileSync(join(REPO, 'css/tokens.css'), 'utf8');

/** A length in px, or undefined for anything with no fixed size (`%`, `fr`, `calc`, keywords). */
function toPx(raw: string): number | undefined {
  const match = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(raw.trim());
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!match[2]) return n; // unitless: line-height and font-weight scales
  return match[2] === 'px' ? n : n * ROOT_FONT_SIZE;
}

const scales = new Map<string, Step[]>();
for (const { prop, value } of declarations(tokensCss, 'css/tokens.css')) {
  if (!prop.startsWith('--')) continue;
  const family = [...new Set(FAMILIES.map(([, name]) => name))].find((name) =>
    prop.startsWith(`--${name}-`),
  );
  const px = toPx(value);
  if (!family || px === undefined) continue;
  scales.set(family, [...(scales.get(family) ?? []), { name: prop, raw: value, px }]);
}

/* -------------------------------------------- */
/*  Classification                              */
/* -------------------------------------------- */

const LITERAL = /(?<![\w.-])(-?\d*\.?\d+(?:px|rem|em))|#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g;

type Verdict = 'exact' | 'near' | 'arithmetic' | 'unscaled' | 'colour';
type Finding = Declaration & {
  literal: string;
  family: string;
  verdict: Verdict;
  suggestion: string;
  distance: number;
};

const familyOf = (prop: string) => FAMILIES.find(([pattern]) => pattern.test(prop))?.[1];

/** A literal inside `calc()`/`min()`/`max()`/`clamp()` is an operand on something else — an
 *  inset off a percentage, a rise off an em — so it answers to arithmetic, not to a scale. */
function inArithmetic(value: string, at: number): boolean {
  let depth = 0;
  for (let i = 0; i < at; i++) {
    if (/^(calc|min|max|clamp)\(/.test(value.slice(i))) depth++;
    else if (value[i] === '(' && depth > 0) depth++;
    else if (value[i] === ')' && depth > 0) depth--;
  }
  return depth > 0;
}

/** Beyond this a "nearest step" is a coincidence, not a mapping. */
const TOLERANCE_PX = 2;

/** The closest step in the family, and how far off it is in px. */
function nearest(family: string, px: number): { step: Step; distance: number } | undefined {
  const steps = scales.get(family);
  if (!steps?.length) return undefined;
  const step = steps.reduce((best, next) =>
    Math.abs(next.px - px) < Math.abs(best.px - px) ? next : best,
  );
  return { step, distance: Math.abs(step.px - px) };
}

function classify(declaration: Declaration): Finding[] {
  const { prop, value } = declaration;
  if (STRUCTURAL.test(value)) return [];

  // A `url()` carries arbitrary digits, and a font stack carries none that mean anything.
  const scrubbed = value.replace(/url\([^)]*\)/g, 'url()');
  const family = familyOf(prop) ?? '';
  const findings: Finding[] = [];

  for (const match of scrubbed.matchAll(LITERAL)) {
    const [literal] = match;
    if (literal.startsWith('#') || /^(rgba?|hsla?)\(/.test(literal)) {
      findings.push({ ...declaration, literal, family: 'colour', verdict: 'colour', suggestion: '', distance: 0 });
      continue;
    }
    const px = toPx(literal);
    if (px === undefined || px === 0) continue;

    if (inArithmetic(scrubbed, match.index)) {
      findings.push({ ...declaration, literal, family: family || '—', verdict: 'arithmetic', suggestion: '', distance: 0 });
      continue;
    }

    // The sign is the site's, not the scale's: `-95px` is `--space-96` spent upwards.
    const closest = family ? nearest(family, Math.abs(px)) : undefined;
    if (!closest || closest.distance > TOLERANCE_PX) {
      findings.push({ ...declaration, literal, family: family || '—', verdict: 'unscaled', suggestion: '', distance: closest?.distance ?? 0 });
    } else if (closest.distance === 0) {
      const sign = px < 0 ? '-' : '';
      findings.push({ ...declaration, literal, family, verdict: 'exact', suggestion: `${sign}var(${closest.step.name})`, distance: 0 });
    } else {
      findings.push({ ...declaration, literal, family, verdict: 'near', suggestion: `var(${closest.step.name}) /* ${closest.step.raw} */`, distance: closest.distance });
    }
  }
  return findings;
}

/* -------------------------------------------- */

const sources = [
  ...filesUnder(join(REPO, 'css'), '.css')
    .filter((path) => !path.endsWith('tokens.css'))
    .flatMap((path) => declarations(readFileSync(path, 'utf8'), relative(REPO, path))),
  ...filesUnder(join(REPO, 'module/ui'), '.svelte').flatMap(svelteDeclarations),
];

/**
 * A Layer-2 definition is *supposed* to hold a literal — that is what makes it a definition. It
 * is only a finding when the literal it holds is a Layer-1 step, which the definition should
 * reference instead of restating.
 */
const isLayer2Definition = (declaration: Declaration) => declaration.prop.startsWith('--');

const tokenised = sources.filter(({ value }) => value.includes('var(--')).length;
const findings = sources
  .flatMap(classify)
  .filter((finding) => !(isLayer2Definition(finding) && finding.verdict !== 'exact'));

const reviewed = (finding: Finding) =>
  REVIEWED.some((entry) => entry.file === finding.file && entry.prop === finding.prop && entry.literal === finding.literal);

const order: Verdict[] = ['exact', 'near', 'colour', 'unscaled', 'arithmetic'];
findings.sort(
  (a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict) || a.file.localeCompare(b.file) || a.line - b.line,
);

const argv = process.argv.slice(2);
const counted = (verdict: Verdict) => findings.filter((finding) => finding.verdict === verdict).length;
const actionable = findings.filter(
  (finding) => ['exact', 'near', 'colour'].includes(finding.verdict) && !reviewed(finding),
).length;

console.log(
  `${sources.length} declarations · ${tokenised} reference a token · ` +
    `${counted('exact')} exact · ${counted('near')} near · ${counted('colour')} colour · ` +
    `${counted('unscaled')} unscaled · ${counted('arithmetic')} arithmetic · ${actionable} actionable`,
);

const quiet: Verdict[] = ['unscaled', 'arithmetic'];
const shown = argv.includes('--verbose') ? findings : findings.filter((f) => !quiet.includes(f.verdict));
const width = Math.max(0, ...shown.map((f) => `${f.file}:${f.line}`.length));

for (const finding of shown) {
  const site = `${finding.file}:${finding.line}`.padEnd(width);
  const fix = finding.suggestion ? ` → ${finding.suggestion}` : '';
  const note = reviewed(finding) ? '  (reviewed, kept)' : '';
  console.log(`  ${finding.verdict.padEnd(10)} ${site}  ${finding.prop}: ${finding.literal}${fix}${note}`);
}

const json = argv.indexOf('--json');
if (json >= 0) {
  const path = argv[json + 1] ?? 'docs/audits/token-literals.json';
  const body = { declarations: sources.length, tokenised, actionable, findings: findings.map((finding) => ({ ...finding, reviewed: reviewed(finding) })) };
  writeFileSync(join(REPO, path), `${JSON.stringify(body, null, 2)}\n`);
  console.log(`\nwrote ${path}`);
}

if (argv.includes('--assert-none') && actionable) process.exit(1);
