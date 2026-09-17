/**
 * Shrinks the built output. Deliberately conservative: this runs on every
 * page of a site whose whole value is that the content renders correctly,
 * so anything that could alter rendering is left alone.
 *
 * HTML  — drops comments and collapses indentation runs to a single space.
 *         Whitespace becomes one space rather than nothing, because between
 *         two inline elements it is significant. Content inside <pre>,
 *         <code>, <script>, <style> and <textarea> is never touched: code
 *         samples must keep their formatting, and rewriting an inline
 *         <script> would invalidate its Content-Security-Policy hash.
 * CSS   — drops comments and collapses whitespace around syntax.
 * JS    — drops comments and indentation, and nothing else. Renaming or
 *         re-sequencing anything would need a real parser; deleting comments
 *         needs only a lexer, which is what minifyJs is. Newlines are kept
 *         wherever one was, so automatic semicolon insertion still sees the
 *         same line structure it did in the source.
 */

const PROTECTED_SOURCE = "<(pre|code|script|style|textarea)\\b[^>]*>[\\s\\S]*?</\\1>";

function squash(chunk) {
  return chunk
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/ {2,}/g, " ");
}

function minifyHtml(html) {
  // Walk the protected regions by index and only rewrite what falls between
  // them. (A split() with capture groups also yields the captured tag names,
  // which silently corrupts a rejoin — index slicing avoids the whole class
  // of mistake.)
  const re = new RegExp(PROTECTED_SOURCE, "gi");
  let out = "";
  let last = 0;
  for (const m of html.matchAll(re)) {
    out += squash(html.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + squash(html.slice(last));
}

function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/\s*([{}:;,>~])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

/**
 * Strip comments and leading indentation from JavaScript.
 *
 * The only hard part is knowing when you are inside something that merely
 * looks like code: a string, a template literal, or a regex. A `/` is a
 * regex delimiter or a division operator depending purely on what preceded
 * it, and `//` inside a string is two characters of data, not a comment.
 * So this walks the source once as a lexer rather than pattern-matching it.
 *
 * What it will not do: rename, reorder, or drop a single token. The output
 * is the input minus comments and indentation, which is why it is safe to
 * run unattended on every build.
 */
function minifyJs(src) {
  let out = "";
  let i = 0;
  const n = src.length;

  // Last significant character emitted — decides whether a `/` opens a
  // regex (after `=`, `(`, `,`, `return` …) or divides (after a value).
  let prevSig = "";
  // Template-literal nesting: each `${` inside a template pushes a frame, so
  // a backtick inside an interpolation does not end the outer literal.
  const tmpl = [];

  const REGEX_OK_BEFORE = "=(,:[!&|?{};+-*%~^<>";

  const emit = (s) => {
    out += s;
    const t = s.trimEnd();
    if (t) prevSig = t[t.length - 1];
  };

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    // --- comments ---------------------------------------------------
    if (c === "/" && c2 === "/" && !tmpl.length) {
      while (i < n && src[i] !== "\n") i++;
      continue; // the newline itself is emitted by the branch below
    }
    if (c === "/" && c2 === "*" && !tmpl.length) {
      const end = src.indexOf("*/", i + 2);
      const body = src.slice(i, end === -1 ? n : end + 2);
      // Keep a /*! … */ banner: by convention that is a licence that has to
      // survive minification.
      if (body.startsWith("/*!")) emit(body);
      // A comment spanning lines leaves its newlines behind, or two
      // statements separated only by that comment would merge.
      else if (body.includes("\n")) out += "\n";
      i = end === -1 ? n : end + 2;
      continue;
    }

    // --- strings ----------------------------------------------------
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      emit(src.slice(i, Math.min(j + 1, n)));
      i = j + 1;
      continue;
    }

    // --- template literals ------------------------------------------
    if (c === "`") {
      if (tmpl.length && tmpl[tmpl.length - 1] === "tmpl") tmpl.pop();
      else tmpl.push("tmpl");
      emit(c);
      i++;
      continue;
    }
    if (tmpl.length && tmpl[tmpl.length - 1] === "tmpl") {
      // Inside a template's literal text: copy verbatim (its whitespace is
      // data) until `${` or the closing backtick.
      let j = i;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "`") break;
        if (src[j] === "$" && src[j + 1] === "{") break;
        j++;
      }
      if (j > i) { out += src.slice(i, j); i = j; continue; }
      if (src[i] === "$") { tmpl.push("expr"); emit("${"); i += 2; continue; }
    }
    if (c === "}" && tmpl.length && tmpl[tmpl.length - 1] === "expr") {
      tmpl.pop();
      emit(c);
      i++;
      continue;
    }

    // --- regex literals ---------------------------------------------
    if (c === "/") {
      const kw = /(^|[^\w$])(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/.test(out.trimEnd());
      if (!prevSig || REGEX_OK_BEFORE.includes(prevSig) || kw) {
        let j = i + 1;
        let cls = false;
        while (j < n) {
          const d = src[j];
          if (d === "\\") { j += 2; continue; }
          if (d === "[") cls = true;
          else if (d === "]") cls = false;
          else if (d === "/" && !cls) break;
          else if (d === "\n") break; // unterminated: not a regex after all
          j++;
        }
        if (src[j] === "/") {
          j++;
          while (j < n && /[a-z]/.test(src[j])) j++; // flags
          emit(src.slice(i, j));
          i = j;
          continue;
        }
      }
    }

    // --- indentation ------------------------------------------------
    if (c === "\n") {
      let j = i + 1;
      while (j < n && (src[j] === " " || src[j] === "\t")) j++;
      // Collapse blank lines: only emit a newline if something follows.
      if (j < n) out += "\n";
      i = j;
      continue;
    }

    emit(c);
    i++;
  }

  return out.trim() + "\n";
}

export default {
  name: "minify",
  onDone(ctx) {
    if (ctx.config.build.minify === false) return;

    let before = 0, after = 0;
    // Snapshot first: emitting inside the loop mutates ctx.written.
    for (const [rel, contents] of Array.from(ctx.written)) {
      if (typeof contents !== "string") continue;
      let out = null;
      if (rel.endsWith(".html")) out = minifyHtml(contents);
      else if (rel.endsWith(".css")) out = minifyCss(contents);
      else if (rel.endsWith(".js")) out = minifyJs(contents);
      if (out === null) continue;
      before += contents.length;
      after += out.length;
      ctx.emit(rel, out);
    }
    if (before) {
      const saved = (((before - after) / before) * 100).toFixed(1);
      console.log(`  [minify] ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB (${saved}% smaller)`);
    }
  },
};
