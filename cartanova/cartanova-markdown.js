/*!
 * CartaNove MarkdownLite — tiny Markdown-to-HTML parser (no deps)
 * Supports: headings, paragraphs, line breaks, bold, italic, underline, strike,
 * highlight, superscript, subscript, blockquotes, lists (ul/ol/task),
 * definition lists, images, links, inline & fenced code (language ignored),
 * horizontal rules, and pipe tables.
 *
 * Not a full CommonMark implementation; designed to be small & predictable.
 * Safe by default: escapes raw HTML except inside code spans/blocks.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MarkdownLite = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Simple UID for placeholders (to protect code spans/blocks during inline parsing)
  const UID = () => "§§" + Math.random().toString(36).slice(2) + "§§";

  function splitLines(src) {
    return src.replace(/\r\n?/g, "\n").split("\n");
  }

  function trimRightBlank(lines, i) {
    // move index back if the current line is out of range
    while (i < lines.length && lines[i] === "") i++;
    return i;
  }

  // Inline parser for emphasis/links/images/code spans, etc.
  function renderInline(text) {
    if (!text) return "";

    // Protect inline code spans first: `code`
    const codeMap = new Map();
    text = text.replace(/`([^`]*?)`/g, (_, code) => {
      const key = UID();
      codeMap.set(key, `<code>${escapeHtml(code)}</code>`);
      return key;
    });

    // Images: ![alt](url "title")
    text = text.replace(
      /!\[([^\]]*?)\]\((\s*<?([^)\s]+)>?\s*(?:(?:"([^"]*)")|(?:'([^']*)'))?\s*)\)/g,
      (_, alt, _mix, url, title1, title2) => {
        const title = title1 || title2 || "";
        const t = title ? ` title="${escapeHtml(title)}"` : "";
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"${t}>`;
      }
    );

    // Links: [text](url "title")
    text = text.replace(
      /\[([^\]]+?)\]\((\s*<?([^)\s]+)>?\s*(?:(?:"([^"]*)")|(?:'([^']*)'))?\s*)\)/g,
      (_, label, _mix, url, title1, title2) => {
        const title = title1 || title2 || "";
        const t = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(url)}"${t}>${renderInline(label)}</a>`;
      }
    );

    // Autolinks: <http://example.com>
    text = text.replace(/<((?:https?:\/\/|mailto:)[^ >]+)>/g, (_, url) => {
      const safe = escapeHtml(url);
      return `<a href="${safe}">${safe}</a>`;
    });

    // Strikethrough: ~~text~~
    text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");

    // Underline (GitHub-style extension used by many tools): ++text++
    text = text.replace(/\+\+(.+?)\+\+/g, "<u>$1</u>");

    // Highlight: ==text== (many flavors use this)
    text = text.replace(/==(.+?)==/g, "<mark>$1</mark>");

    // Superscript: ^text^
    text = text.replace(/\^([^^]+)\^/g, "<sup>$1</sup>");

    // Subscript: ~text~   (careful to not collide with ~~strike~~ handled earlier)
    // Use a conservative rule: single ~ on each side, not doubled.
    text = text.replace(/(^|[^~])~([^~]+)~(?!~)/g, (_, pre, inner) => `${pre}<sub>${inner}</sub>`);

    // Bold: **text** or __text__
    text = text
      .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__([\s\S]+?)__/g, "<strong>$1</strong>");

    // Italic: *text* or _text_
    // Keep it simple (not perfect with nested markup, but practical)
    text = text
      .replace(/(^|[\s(])\*([^\s][\s\S]*?[^\s])\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
      .replace(/(^|[\s(])_([^\s][\s\S]*?[^\s])_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");

    // Restore code spans
    for (const [k, v] of codeMap) text = text.split(k).join(v);

    return text;
  }

	// --- Improved table splitter: supports escaped pipes (\|) and optional outer pipes
function splitRowEscaped(row) {
  let r = row.trim();
  if (r.startsWith("|")) r = r.slice(1);
  if (r.endsWith("|")) r = r.slice(0, -1);

  const cells = [];
  let cur = "";
  let esc = false;

  for (let i = 0; i < r.length; i++) {
    const ch = r[i];
    if (esc) {               // previous char was a backslash
      cur += ch;             // keep the escaped char (e.g., |)
      esc = false;
      continue;
    }
    if (ch === "\\") {       // start escape
      esc = true;
      continue;
    }
    if (ch === "|") {        // column break
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

// --- Robust table parser (multi-column, flexible alignment detection)
function parseTable(lines, start) {
  const headerLine = lines[start];
  const sepLine = lines[start + 1];
  if (!sepLine) return null;

  const headerHasPipe = headerLine.includes("|");
  const sepHasPipe = sepLine.includes("|");
  if (!headerHasPipe || !sepHasPipe) return null;

  // Split header + separator
  const headerCells = splitRowEscaped(headerLine);
  const sepCells = splitRowEscaped(sepLine);

  // Valid alignment cells look like: ---  :---  ---:  :---:
  const isAlign = (s) => /^:?-{3,}:?$/.test(s.trim());
  if (sepCells.length < 1 || !sepCells.every(isAlign)) return null;

  // Collect body rows until a blank or a non-table-looking line
  const bodyRows = [];
  let i = start + 2;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) break;                  // blank ends table
    if (!line.includes("|")) break;           // no pipe → not a table row
    // treat a line of only alignment cells as a new separator -> stop
    const maybeSep = splitRowEscaped(line);
    const looksLikeSep = maybeSep.length > 0 && maybeSep.every(isAlign);
    if (looksLikeSep) break;

    bodyRows.push(splitRowEscaped(line));
    i++;
  }

  // Normalize column count across header/sep/body
  const colCount = Math.max(
    headerCells.length,
    sepCells.length,
    ...bodyRows.map(r => r.length)
  );

  const alignAt = (idx) => {
    const spec = (sepCells[idx] || "").trim();
    const left = spec.startsWith(":");
    const right = spec.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  };

  const th = Array.from({ length: colCount }, (_, idx) => {
    const a = alignAt(idx);
    const style = a ? ` style="text-align:${a};"` : "";
    const content = renderInline(escapeHtml(headerCells[idx] || ""));
    return `<th${style}>${content}</th>`;
  }).join("");

  const trs = bodyRows.map(row => {
    const tds = Array.from({ length: colCount }, (_, idx) => {
      const a = alignAt(idx);
      const style = a ? ` style="text-align:${a};"` : "";
      const content = renderInline(escapeHtml(row[idx] || ""));
      return `<td${style}>${content}</td>`;
    }).join("");
    return `<tr>${tds}</tr>`;
  }).join("");

  return {
    html: `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`,
    linesConsumed: i - start
  };
}



  // Parse a definition list block (simple single-line form: Term: Definition)
  function parseDefList(lines, start) {
    const dl = [];
    let i = start;
    while (i < lines.length) {
      const m = /^([^:\n][^:\n]*?)\s*:\s+(.+)$/.exec(lines[i]);
      if (!m) break;
      dl.push({ dt: m[1].trim(), dd: m[2].trim() });
      i++;
    }
    if (dl.length === 0) return null;

    const html =
      "<dl>" +
      dl.map(({ dt, dd }) => `<dt>${renderInline(escapeHtml(dt))}</dt><dd>${renderInline(escapeHtml(dd))}</dd>`).join("") +
      "</dl>";

    return { html, linesConsumed: dl.length };
  }

  // Parse blockquotes by collecting contiguous '>' lines, stripping and parsing recursively
  function parseBlockquote(lines, start) {
    if (!/^>\s?/.test(lines[start])) return null;
    const chunk = [];
    let i = start;
    while (i < lines.length && /^>\s?/.test(lines[i])) {
      chunk.push(lines[i].replace(/^>\s?/, ""));
      i++;
    }
    const inner = parseBlocks(chunk.join("\n"));
    return { html: `<blockquote>\n${inner}\n</blockquote>`, linesConsumed: i - start };
  }

  // Parse lists (unordered/ordered/task). No nested lists in this minimal version.
  function parseList(lines, start) {
    const liUn = /^\s*[-+*]\s+/.test(lines[start]);
    const liOl = /^\s*\d+[.)]\s+/.test(lines[start]);
    if (!liUn && !liOl) return null;

    const items = [];
    let i = start;
    while (i < lines.length) {
      const line = lines[i];
      if (!/^\s*(?:[-+*]\s+|\d+[.)]\s+)/.test(line)) break;

      // Task list?
      let taskMatch = /^\s*[-*]\s+\[( |x|X)\]\s+/.exec(line);
      if (taskMatch) {
        const checked = /[xX]/.test(taskMatch[1]);
        const content = line.replace(/^\s*[-*]\s+\[(?: |x|X)\]\s+/, "");
        items.push({
          html: `<li class="task"><input type="checkbox" disabled${checked ? " checked" : ""}> ${renderInline(escapeHtml(content))}</li>`,
          type: "ul"
        });
        i++;
        continue;
      }

      //const marker = liOl ? /^\s*\d+[.)]\s+/.exec(line)[0] : /^\s*[-+*]\s+/.exec(line)[0];
	  const match = liOl
	    ? /^\s*\d+[.)]\s+/.exec(line)
	    : /^\s*[-+*]\s+/.exec(line);

	  const marker = match ? match[0] : "";
      let content = line.slice(marker.length);

      // Capture following indented lines as part of the same item
      const sub = [content];
      let j = i + 1;
      while (j < lines.length && /^\s{2,}\S/.test(lines[j])) {
        sub.push(lines[j].replace(/^\s{2}/, "")); // unindent a notch
        j++;
      }
      items.push({ html: `<li>${renderInline(escapeHtml(sub.join("\n")))}</li>`, type: liOl ? "ol" : "ul" });
      i = j;
    }

    const listType = items.some(it => it.type === "ol") ? "ol" : "ul"; // prefer ol if any
    const html = `<${listType}>\n${items.map(i => i.html).join("\n")}\n</${listType}>`;
    return { html, linesConsumed: i - start };
  }

  // Parse fenced code blocks ``` ... ```
  function parseFences(lines, start) {
    const fence = /^```/.exec(lines[start]);
    if (!fence) return null;
    let i = start + 1;
    const buf = [];
    while (i < lines.length && !/^```/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    // skip closing fence if present
    if (i < lines.length && /^```/.test(lines[i])) i++;
    const code = escapeHtml(buf.join("\n"));
    return { html: `<pre><code>${code}\n</code></pre>`, linesConsumed: i - start };
  }

  // Parse horizontal rule
  function parseHr(line) {
    return /^(\*\s*\*\s*\*|-\s*-\s*-|_\s*_\s_)\s*$/.test(line);
  }

  // Parse headings
  function parseAtxHeading(line) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!m) return null;
    const level = m[1].length;
    return `<h${level}>${renderInline(escapeHtml(m[2]))}</h${level}>`;
  }

  // Parse paragraphs (collect until blank line or another block element)
  function parseParagraph(lines, start) {
    const buf = [];
    let i = start;
    while (i < lines.length && lines[i].trim() !== "") {
      // Stop paragraph if the next line would start a block structure (heading, hr, list, quote, fence, table/deflist)
      if (
        parseAtxHeading(lines[i]) ||
        parseHr(lines[i]) ||
        /^\s*[-+*]\s+/.test(lines[i]) ||
        /^\s*\d+[.)]\s+/.test(lines[i]) ||
        /^>\s?/.test(lines[i]) ||
        /^```/.test(lines[i]) ||
        /^\s*\|/.test(lines[i]) // potential table row
      ) break;
      buf.push(lines[i]);
      i++;
    }

    if (buf.length === 0) return null;

    // Single line breaks inside paragraph become <br>
    const html = renderInline(escapeHtml(buf.join("\n"))).replace(/\n/g, "<br>\n");
    return { html: `<p>${html}</p>`, linesConsumed: i - start };
  }

  function parseBlocks(src) {
    const lines = splitLines(src);
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Skip blank lines
      if (line.trim() === "") { i++; continue; }

      // Headings
      const h = parseAtxHeading(line);
      if (h) { out.push(h); i++; continue; }

      // Horizontal rule
      if (parseHr(line)) { out.push("<hr>"); i++; continue; }

      // Fenced code
      const fc = parseFences(lines, i);
      if (fc) { out.push(fc.html); i += fc.linesConsumed; continue; }

      // Blockquote
      const bq = parseBlockquote(lines, i);
      if (bq) { out.push(bq.html); i += bq.linesConsumed; continue; }

      // Table
      const tbl = parseTable(lines, i);
      if (tbl) { out.push(tbl.html); i += tbl.linesConsumed; continue; }

      // Definition list
      const dl = parseDefList(lines, i);
      if (dl) { out.push(dl.html); i += dl.linesConsumed; continue; }

      // Lists
      const list = parseList(lines, i);
      if (list) { out.push(list.html); i += list.linesConsumed; continue; }

      // Paragraph
      const p = parseParagraph(lines, i);
      if (p) { out.push(p.html); i += p.linesConsumed; continue; }

      // Fallback: treat as paragraph line
      out.push(`<p>${renderInline(escapeHtml(line))}</p>`);
      i++;
    }

    return out.join("\n");
  }

  function parse(markdownText) {
    if (typeof markdownText !== "string") markdownText = String(markdownText ?? "");
    return parseBlocks(markdownText);
  }

  // Tiny helper to render into an element (browser convenience)
  function renderTo(markdownText, element) {
    if (!element) throw new Error("renderTo requires a target element");
    element.innerHTML = parse(markdownText);
    return element;
  }

  return { parse, renderTo, version: "0.1.0" };
});
