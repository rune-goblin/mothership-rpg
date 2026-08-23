// The probe the fall-through audit runs in the page, and the experiment harness that asks what a
// candidate stylesheet would remove. Kept out of the spec so a bench run can import it without
// registering the audit's tests.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = {
  surface: string;
  signature: string;
  prop: string;
  verdict: 'uncovered' | 'contested' | 'inherited';
  supplier: string;
  value: string;
  themed: boolean;
};

export const collected: Row[] = [];

export function probe({ rootSelector, surface }: { rootSelector: string; surface: string }): Row[] {
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
