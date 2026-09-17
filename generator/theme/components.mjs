/** Reusable server-side components. Pure functions: model in, HTML out. */

import { escapeHtml as esc } from "../lib/markdown.mjs";
import { icon } from "../lib/icons.mjs";

export { esc, icon };

export function statusBadge(page) {
  if (page.placeholder) return `<span class="badge badge-planned">Planned</span>`;
  if (page.difficulty) return `<span class="badge badge-${esc(String(page.difficulty).toLowerCase())}">${esc(page.difficulty)}</span>`;
  return "";
}

/** One collapsible section in the sidebar. */
function navGroup(sec, activePage, activeSection) {
  const isActive = activeSection?.dir === sec.dir;
  const pages = sec.pages.filter((p) => !p.isReadme);
  const written = pages.filter((p) => !p.placeholder).length;

  const items = pages
    .map((p) => {
      const cur = activePage?.url === p.url ? ` aria-current="page"` : "";
      const num = p.num != null ? `<span class="nav-num">${String(p.num).padStart(3, "0")}</span>` : "";
      const dot = p.placeholder ? `<span class="nav-dot" title="Planned"></span>` : "";
      // A long case-study title is clipped by CSS, so carry the full text in
      // a tooltip rather than leaving the reader with "CrashLoopBackOff Af…".
      return `<li><a href="${p.url}"${cur} title="${esc(p.title)}">${num}<span class="nav-title">${esc(p.title)}</span>${dot}</a></li>`;
    })
    .join("");

  // An empty section gets no badge at all. A column of "0" pills was the
  // loudest thing in the sidebar and said "nothing here" eighteen times over
  // — and a column of "soon" labels is the same column with new words. The
  // dimmed label carries it, and the home page's coverage panel is where the
  // roadmap actually belongs. A written section stands out by being the only
  // kind with a number next to it.
  const badge = written ? `<span class="nav-count">${written}</span>` : "";

  return `<details class="nav-group${written ? "" : " is-empty"}"${isActive ? " open" : ""}>
  <summary>${icon(sec.icon, "nav-icon")}<span class="nav-label">${esc(sec.label)}</span>${badge}</summary>
  <ul>
    <li><a href="${sec.url}"${activePage?.isReadme && isActive ? ` aria-current="page"` : ""}><span class="nav-title">Overview</span></a></li>
    ${items}
  </ul>
</details>`;
}

export function sidebar(sections, activePage, activeSection, opts = {}) {
  // Sections declare their own heading via `group` in the config. Preserve
  // config order rather than sorting: the order is editorial. A site that
  // sets no groups gets one flat list, exactly as before.
  const order = [];
  const byGroup = new Map();
  for (const sec of sections) {
    const g = sec.group || "";
    if (!byGroup.has(g)) {
      byGroup.set(g, []);
      order.push(g);
    }
    byGroup.get(g).push(sec);
  }

  const groups = order
    .map((g) => {
      const body = byGroup
        .get(g)
        .map((sec) => navGroup(sec, activePage, activeSection))
        .join("\n");
      const heading = g ? `<h2 class="nav-group-label">${esc(g)}</h2>` : "";
      return `${heading}${body}`;
    })
    .join("\n");
  // Tags are a cross-cutting view rather than a section, so they sit outside
  // the collapsible groups instead of pretending to be one.
  const extras = opts.tagsUrl
    ? `<a class="nav-extra" href="${opts.tagsUrl}"${opts.tagsActive ? ` aria-current="page"` : ""}>${icon("tag", "nav-icon")}<span class="nav-label">Browse by tag</span>${
        opts.tagCount ? `<span class="nav-count">${opts.tagCount}</span>` : ""
      }</a>`
    : "";
  return `<nav class="sidebar-nav" aria-label="Content">${groups}${extras}</nav>`;
}

export function breadcrumbs(site, trail) {
  const items = [{ label: "Home", url: site.baseUrl }, ...trail];
  const lis = items
    .map((t, i) =>
      i === items.length - 1
        ? `<li aria-current="page">${esc(t.label)}</li>`
        : `<li><a href="${t.url}">${esc(t.label)}</a></li>`
    )
    .join(`<li class="crumb-sep" aria-hidden="true">/</li>`);
  return `<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>${lis}</ol></nav>`;
}

export function tocPanel(headings) {
  if (!headings?.length) return "";
  const items = headings
    .map((h) => `<li class="toc-d${h.depth}"><a href="#${h.id}">${esc(h.text)}</a></li>`)
    .join("");
  return `<aside class="toc" aria-label="On this page">
  <div class="toc-title">On this page</div>
  <ul>${items}</ul>
</aside>`;
}

export function prevNext(page) {
  if (!page.prev && !page.next) return "";
  const cell = (p, dir) =>
    p
      ? `<a class="pn pn-${dir}" href="${p.url}">
  <span class="pn-label">${dir === "prev" ? `${icon("arrowLeft")} Previous` : `Next ${icon("arrowRight")}`}</span>
  <span class="pn-title">${esc(p.title)}</span>
</a>`
      : `<span></span>`;
  return `<nav class="prev-next" aria-label="Pagination">${cell(page.prev, "prev")}${cell(page.next, "next")}</nav>`;
}

/**
 * Tag chips. `resolved` entries carry a url and become links; a bare string
 * renders as a plain chip, which is what happens when the tag index is
 * unavailable (e.g. a partial render in a test).
 */
export function tagChips(tags, cls = "meta-tags") {
  if (!tags?.length) return "";
  const chips = tags
    .map((t) =>
      typeof t === "string"
        ? `<span class="tag">${esc(t)}</span>`
        : `<a class="tag" href="${t.url}">${esc(t.name)}${
            t.count != null ? `<span class="tag-count">${t.count}</span>` : ""
          }</a>`
    )
    .join("");
  return `<span class="${cls}">${chips}</span>`;
}

export function pageMeta(page, tags = null) {
  const bits = [];
  if (page.num != null) bits.push(`<span class="meta-num">${String(page.num).padStart(3, "0")}</span>`);
  bits.push(statusBadge(page));
  if (!page.placeholder) bits.push(`<span class="meta-item">${icon("clock")}${page.readingTime} min read</span>`);
  if (page.updated) bits.push(`<span class="meta-item">${icon("calendar")}${esc(String(page.updated))}</span>`);
  bits.push(tagChips(tags?.length ? tags : page.tags.map((t) => String(t))));
  return `<div class="page-meta">${bits.filter(Boolean).join("")}</div>`;
}

export function card(page, { showDate = false } = {}) {
  const num = page.num != null ? `<span class="card-num">${String(page.num).padStart(3, "0")}</span>` : "";
  const desc = page.placeholder
    ? `<p class="card-desc muted">Not written yet.</p>`
    : `<p class="card-desc">${esc(page.description)}</p>`;
  const date = showDate && page.updated
    ? `<p class="card-date">${icon("calendar")}${esc(String(page.updated))}</p>`
    : "";
  return `<a class="card${page.placeholder ? " card-planned" : ""}" href="${page.url}"${
    page.section ? ` data-section="${esc(page.section.dir)}"` : ""
  }${page.difficulty ? ` data-difficulty="${esc(String(page.difficulty).toLowerCase())}"` : ""}>
  <div class="card-top">${num}${statusBadge(page)}</div>
  <h3>${esc(page.title)}</h3>
  ${desc}
  ${date}
</a>`;
}

/**
 * A curated entry point on the home page. Numbered rather than badged,
 * because the point of the row is the order you read them in.
 */
export function startCard(page, i) {
  return `<a class="card start-card" href="${page.url}">
  <div class="card-top"><span class="start-num">${i + 1}</span><span class="start-sec">${esc(page.section.label)}</span></div>
  <h3>${esc(page.title)}</h3>
  <p class="card-desc">${esc(page.description)}</p>
</a>`;
}

/**
 * How many entries a section's index lists as planned.
 *
 * The roadmap's source of truth is the "Planned" table a human maintains in
 * each domain README, not a field in a config file — so the home page reads
 * that table back out of the rendered page and counts its rows. Derived, not
 * duplicated: add a row to the README and the progress bar moves on the next
 * build, with nothing else to remember to update.
 */
export function plannedEntries(readme) {
  if (!readme?.html) return [];
  const at = readme.html.indexOf('id="planned"');
  if (at === -1) return [];
  const tbody = readme.html.slice(at).match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbody) return [];
  const strip = (h) => h.replace(/<[^>]+>/g, "").trim();
  return [...tbody[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map((row) => [...row[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => strip(c[1])))
    .filter((cells) => cells[0])
    .map(([name, type]) => ({ name, type: type || "" }));
}

export function plannedCount(readme) {
  return plannedEntries(readme).length;
}

/**
 * A planned case study, shown on the home page as what is coming next.
 * Not a link: there is nothing to link to yet, and a card that looks
 * clickable but is not is worse than one that plainly is not.
 */
export function nextUpCard({ sec, name, type }) {
  return `<div class="next-card">
  <div class="next-top">${icon(sec.icon, "next-icon")}<span class="next-sec">${esc(sec.label)}</span>${
    type ? `<span class="next-type">${esc(type)}</span>` : ""
  }</div>
  <p class="next-name">${esc(name)}</p>
</div>`;
}

/**
 * One domain's progress. `written` of `planned`, as a bar.
 *
 * A domain with nothing written still gets a row: the point of the panel is
 * to show the shape of the whole roadmap, and an empty Linux row is the
 * honest statement that Linux is next rather than absent.
 */
export function coverageRow(sec, written, planned) {
  const total = Math.max(planned, written);
  const pct = total ? Math.round((written / total) * 100) : 0;
  // The real width is inline so the bar is correct with JavaScript disabled.
  // data-pct lets the reveal animation replay it from zero when motion is
  // allowed — enhancement, never the source of truth.
  return `<a class="cov-row${written ? "" : " is-empty"}" href="${sec.url}">
  <span class="cov-icon">${icon(sec.icon)}</span>
  <span class="cov-label">${esc(sec.label)}</span>
  <span class="cov-bar" role="img" aria-label="${written} of ${total} written">
    <span class="cov-fill" data-pct="${pct}" style="width:${pct}%"></span>
  </span>
  <span class="cov-num">${written}<span class="cov-den">/${total}</span></span>
</a>`;
}

export function sectionCard(sec) {
  const listed = sec.pages.filter((p) => !p.isReadme);
  const done = listed.filter((p) => !p.placeholder).length;
  // An empty section showing "0/0" reads as a broken counter rather than as
  // "nothing here yet", so it gets a word instead of a fraction.
  const meter = listed.length
    ? `<span class="nav-count">${done}/${listed.length}</span>`
    : `<span class="badge badge-planned">Planned</span>`;
  return `<a class="card section-card${listed.length ? "" : " section-card-empty"}" href="${sec.url}">
  <div class="card-top"><span class="card-icon">${icon(sec.icon)}</span>${meter}</div>
  <h3>${esc(sec.label)}</h3>
  <p class="card-desc">${esc(sec.blurb)}</p>
</a>`;
}

/**
 * KPI row for the home page. Values are plain counts in text ink — no colour
 * coding, no fake deltas; there is no time series behind them to compare
 * against.
 */
export function statTiles(stats) {
  const tiles = stats
    .filter((s) => s.value != null)
    .map(
      (s) => `<div class="stat"><div class="stat-value">${esc(String(s.value))}</div>` +
        `<div class="stat-label">${esc(s.label)}</div></div>`
    )
    .join("");
  return `<div class="stats">${tiles}</div>`;
}
