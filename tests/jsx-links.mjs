/**
 * The links a .tsx file renders, read from its source: the elements, their attributes, and the
 * URLs an attribute's literals spell out. Shared by the tests that hold the site's links to a
 * shape (tests/link-prefetch.test.mjs, tests/chrome-links.test.mjs).
 *
 * Not a parser. It finds the opening tags of the elements it is asked about and reads their
 * attributes, stepping over braces, strings and template literals, which is all those tests need.
 * Give it the output of code() (tests/source.mjs), so that a link in a comment is not a link.
 */

/** Where the bracket at `start` closes, skipping strings and template text. */
export function closing(source, start) {
  const open = source[start], close = { "{": "}", "(": ")", "[": "]" }[open];
  let depth = 0;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (character === '"' || character === "'" || character === "`") {
      cursor = stringEnd(source, cursor);
      continue;
    }
    if (character === open) depth += 1;
    else if (character === close && --depth === 0) return cursor;
  }
  return source.length;
}

/** Where the string or template literal opening at `start` ends, interpolations included. */
export function stringEnd(source, start) {
  const quote = source[start];
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === "\\") { cursor += 1; continue; }
    if (quote === "`" && source[cursor] === "$" && source[cursor + 1] === "{") { cursor = closing(source, cursor + 1); continue; }
    if (source[cursor] === quote) return cursor;
  }
  return source.length;
}

/**
 * Every opening tag of an element named in `names`, with its attributes: a Map from each
 * attribute's name to the source of its value - the expression inside `{...}`, or a quoted string
 * with its quotes, or "true" for a bare attribute. Spread props are listed under `spreads`, and
 * `order` names everything in the order written (a spread as "..."), since a later prop wins.
 */
export function elements(source, names) {
  if (!names.length) return [];
  const found = [];
  const tag = new RegExp(`<(${names.map((name) => name.replace(/[.$]/g, "\\$&")).join("|")})(?=[\\s/>])`, "g");
  for (const match of source.matchAll(tag)) {
    const attributes = new Map(), spreads = [], order = [];
    let cursor = match.index + match[0].length;
    while (cursor < source.length) {
      const character = source[cursor];
      if (character === ">" || (character === "/" && source[cursor + 1] === ">")) break;
      if (character === "{") {
        const end = closing(source, cursor);
        spreads.push(source.slice(cursor + 1, end).trim());
        order.push("...");
        cursor = end + 1;
        continue;
      }
      const name = /^[A-Za-z_][\w:.-]*/.exec(source.slice(cursor, cursor + 100))?.[0];
      if (!name) { cursor += 1; continue; }
      cursor += name.length;
      order.push(name);
      if (source[cursor] !== "=") { attributes.set(name, "true"); continue; }
      cursor += 1;
      const end = source[cursor] === "{" ? closing(source, cursor) : stringEnd(source, cursor);
      attributes.set(name, source[cursor] === "{" ? source.slice(cursor + 1, end).trim() : source.slice(cursor, end + 1));
      cursor = end + 1;
    }
    found.push({ name: match[1], at: match.index, attributes, spreads, order, tag: source.slice(match.index, cursor + 1) });
  }
  return found;
}

/**
 * The URLs an expression can produce, as far as its literals say: every string literal, and every
 * template literal up to its first interpolation that is not the locale. `/${locale}/deals/${slug}`
 * reads as "/${locale}/deals/", which is enough to see where it goes. The same reading as
 * tests/locale-links.test.mjs.
 */
export function literals(expression) {
  const found = [];
  for (let cursor = 0; cursor < expression.length; cursor += 1) {
    const character = expression[cursor];
    if (character !== '"' && character !== "'" && character !== "`") continue;
    const end = stringEnd(expression, cursor);
    const body = expression.slice(cursor + 1, end);
    found.push(character === "`" ? body.replace(/\$\{(?!locale\})[\s\S]*$/, "") : body);
    cursor = end;
  }
  return found;
}

/**
 * The local names a file gives the two client-side link components: next-intl's <Link> through
 * i18n/navigation (`wrapper`), and next/link (`next`).
 */
export function linkImports(source) {
  const wrapper = [], next = [];
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](?:\.\.?\/)+(?:[\w[\].-]+\/)*i18n\/navigation["']/g)) {
    for (const specifier of match[1].split(",")) {
      const [imported, local] = specifier.trim().split(/\s+as\s+/);
      if (imported === "Link") wrapper.push(local ?? imported);
    }
  }
  for (const match of source.matchAll(/import\s+(\w+)\s*(?:,\s*\{[^}]*\}\s*)?from\s*["']next\/link["']/g)) next.push(match[1]);
  return { wrapper, next };
}
