/** Page templates: home, section index, article, tag index, tag, 404. */

import { baseLayout } from "./layout.mjs";
import { esc, icon, breadcrumbs, tocPanel, prevNext, pageMeta, card, startCard, sectionCard, tagChips, statTiles, coverageRow, plannedCount, plannedEntries, nextUpCard } from "./components.mjs";
import { tagsForPage } from "../lib/tags.mjs";

/**
 * Resolve `home.startHere` config entries — content paths without the
 * extension, e.g. "case-studies/001-url-shortener" — to page objects.
 * Silently drops entries that don't match a published page, so a curated
 * list can't break the build when a page is renamed.
 */
function resolveStartHere(config, sections) {
  const wanted = config.home?.startHere;
  if (!Array.isArray(wanted) || !wanted.length) return [];
  const byPath = new Map();
  for (const sec of sections) {
    for (const p of sec.pages) {
      if (p.contentRel) byPath.set(p.contentRel.replace(/\.mdx?$/i, "").toLowerCase(), p);
    }
  }
  return wanted
    .map((ref) => byPath.get(String(ref).replace(/\.mdx?$/i, "").toLowerCase()))
    .filter((p) => p && !p.placeholder);
}

export function homePage(config, sections, tags = []) {
  const site = config.site;

  // The case-study corpus is every section the config groups as a domain.
  // The old code looked for a section literally called "case-studies" and
  // fell back to sections[0] when it found none — which, after the docs were
  // reorganised into numbered domains, silently made Linux "the" section:
  // the primary button read "Browse linux" and pointed at an empty page, and
  // "Latest" filtered to Linux and so rendered nothing at all.
  const domains = sections.filter((s) => s.group === "Domains");
  const corpus = domains.length ? domains : sections;

  const listed = (sec) => sec.pages.filter((p) => !p.isReadme && p.type === "md");
  const writtenIn = (sec) => listed(sec).filter((p) => !p.placeholder);

  const caseStudies = corpus.flatMap(writtenIn);
  const allPages = sections.flatMap((s) => s.pages).filter((p) => !p.isReadme && p.type === "md");
  const published = allPages.filter((p) => !p.placeholder);

  const diagrams = published.reduce((n, p) => n + (p.html.match(/class="mermaid"/g)?.length || 0), 0);
  const minutes = published.reduce((n, p) => n + (p.readingTime || 0), 0);

  // Roadmap, read back out of each domain index's Planned table.
  const coverage = corpus.map((sec) => {
    const written = writtenIn(sec).length;
    const readme = sec.pages.find((p) => p.isReadme);
    return { sec, written, planned: written + plannedCount(readme) };
  });
  const plannedTotal = coverage.reduce((n, c) => n + c.planned, 0);
  const domainsCovered = coverage.filter((c) => c.written).length;

  // Land the primary button somewhere with content in it. Busiest domain
  // first, so this keeps working as the corpus grows.
  const busiest = coverage.slice().sort((a, b) => b.written - a.written)[0];
  const browseUrl = busiest?.written ? busiest.sec.url : site.baseUrl + "tags/";

  // "Latest" means latest across everything published, newest first, with
  // document order as the tie-break for pages that never set a date.
  const latest = published
    .slice()
    .sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")))
    .slice(0, 6);

  const startHere = resolveStartHere(config, sections);
  const topTags = tags.slice(0, 14).map((t) => ({ ...t, count: t.pages.length }));

  // Featured scenarios: the opening paragraph of each case study's Scenario
  // section. This is the most honest possible answer to "what is this site" —
  // it shows the actual voice of the content rather than describing it. Pages
  // without a Scenario section (references, mock-interview prompts) opt out
  // by simply not having one.
  const scenarios = published
    .map((pg) => {
      const sc = (pg.searchSections || []).find((h) => /^scenario$/i.test(h.title));
      if (!sc?.text) return null;
      const text = sc.text.replace(/\s+/g, " ").trim();
      return text.length > 40 ? { page: pg, text: text.slice(0, 210).trim() } : null;
    })
    .filter(Boolean)
    .slice(0, 5);

  // Next up: real planned entries, round-robined across domains so the strip
  // shows breadth rather than six consecutive Linux rows.
  const queues = corpus.map((sec) => plannedEntries(sec.pages.find((pg) => pg.isReadme)).map((e) => ({ sec, ...e })));
  const nextUp = [];
  for (let i = 0; nextUp.length < 6; i++) {
    const before = nextUp.length;
    for (const q of queues) {
      if (q[i] && nextUp.length < 6) nextUp.push(q[i]);
    }
    if (nextUp.length === before) break;
  }

  // Filter chips for Latest, built from the sections actually represented.
  const latestSections = [];
  for (const pg of latest) {
    if (pg.section && !latestSections.some((x) => x.dir === pg.section.dir)) latestSections.push(pg.section);
  }

  const hours = minutes >= 90 ? `${(minutes / 60).toFixed(1)} h` : `${minutes} min`;
  const stats = [
    { value: `${caseStudies.length} / ${plannedTotal}`, label: "Case studies written" },
    { value: `${domainsCovered} / ${corpus.length}`, label: "Domains covered" },
    diagrams ? { value: diagrams, label: "Diagrams" } : null,
    minutes ? { value: hours, label: "Of reading" } : null,
    tags.length ? { value: tags.length, label: "Tags" } : null,
  ].filter(Boolean);

  const content = `<main id="main" class="main home">
<section class="hero">
  <h1>${esc(site.title)}</h1>
  <p class="hero-tagline">${esc(site.tagline)}</p>
  <p class="hero-desc">${esc(site.description)}</p>
  <button class="hero-search" id="hero-search" type="button" aria-label="Search case studies">
    ${icon("search")}<span class="hero-search-label">Search failure modes, patterns, commands…</span><kbd><span class="kbd-mod">Ctrl</span> K</kbd>
  </button>
  <div class="hero-actions">
    <a class="btn btn-primary" href="${browseUrl}">Browse case studies ${icon("arrowRight")}</a>
    <a class="btn" href="${site.repo}" target="_blank" rel="noopener">${icon("github")} View on GitHub</a>
  </div>
  ${statTiles(stats)}
</section>

${scenarios.length ? `<section class="scenes" id="scenes"${scenarios.length > 1 ? ' data-rotate="7000"' : ""}>
  <div class="scenes-track">${scenarios
    .map(
      (sc, i) => `<a class="scene${i === 0 ? " is-active" : ""}" href="${sc.page.url}"${i === 0 ? "" : ' aria-hidden="true" tabindex="-1"'}>
    <span class="scene-eyebrow">${icon("warning")}<span>Scenario</span><span class="scene-dot">·</span><span>${esc(sc.page.section.label)}</span>${
      sc.page.difficulty ? `<span class="scene-dot">·</span><span>${esc(String(sc.page.difficulty))}</span>` : ""
    }</span>
    <p class="scene-text">${esc(sc.text)}…</p>
    <span class="scene-cta">${esc(sc.page.title)} ${icon("arrowRight")}</span>
  </a>`
    )
    .join("")}</div>
  ${scenarios.length > 1 ? `<div class="scene-dots" role="tablist" aria-label="Featured scenarios">${scenarios
    .map((sc, i) => `<button class="scene-pip${i === 0 ? " is-active" : ""}" type="button" role="tab" aria-selected="${i === 0}" aria-label="Scenario ${i + 1}: ${esc(sc.page.title)}" data-i="${i}"></button>`)
    .join("")}</div>` : ""}
</section>` : ""}

${startHere.length ? `<section>
  <h2 class="home-h2">Start here</h2>
  <div class="grid grid-3">${startHere.map(startCard).join("")}</div>
</section>` : ""}

${latest.length ? `<section id="latest">
  <h2 class="home-h2">Latest</h2>
  ${latestSections.length > 1 ? `<div class="chips" id="latest-filters" role="group" aria-label="Filter by section">
    <button class="chip is-active" type="button" data-filter="all" aria-pressed="true">All <span class="chip-n">${latest.length}</span></button>
    ${latestSections
      .map((sec) => `<button class="chip" type="button" data-filter="${esc(sec.dir)}" aria-pressed="false">${esc(sec.label)} <span class="chip-n">${latest.filter((p) => p.section?.dir === sec.dir).length}</span></button>`)
      .join("")}
  </div>` : ""}
  <div class="grid" id="latest-grid">${latest.map((p) => card(p, { showDate: true })).join("")}</div>
  <p class="chips-empty" id="latest-empty" hidden>Nothing in that section yet.</p>
</section>` : ""}

${coverage.length ? `<section>
  <h2 class="home-h2">Coverage</h2>
  <p class="home-sub">What is written, and what is next. Counts come from the Planned table in each domain index, so this moves as the roadmap does.</p>
  <div class="coverage">${coverage.map((c) => coverageRow(c.sec, c.written, c.planned)).join("")}</div>
</section>` : ""}

${nextUp.length ? `<section>
  <h2 class="home-h2">Next up</h2>
  <p class="home-sub">The next entries queued across the domains, taken straight from each index's Planned table.</p>
  <div class="grid grid-3 next-grid">${nextUp.map(nextUpCard).join("")}</div>
</section>` : ""}

<section>
  <h2 class="home-h2">Explore</h2>
  <div class="grid">${sections.map(sectionCard).join("")}</div>
</section>

${topTags.length ? `<section>
  <h2 class="home-h2">Browse by tag</h2>
  <div class="tag-cloud">${tagChips(topTags, "tag-row")}</div>
  <p class="tag-more"><a href="${site.baseUrl}tags/">All ${tags.length} tags ${icon("arrowRight")}</a></p>
</section>` : ""}
</main>`;

  // The landing page carries its own navigation — Start here, Latest,
  // Coverage, Explore, tags — so a sidebar listing the same sections is
  // duplication that costs the hero its width.
  return baseLayout({ site, theme: config.theme, sections, tags, content, bodyClass: "is-home", url: site.baseUrl, needs: {}, sidebar: false });
}

export function sectionIndexPage(config, sections, sec, tags = []) {
  const site = config.site;
  const readme = sec.pages.find((p) => p.isReadme);
  const listing = sec.pages.filter((p) => !p.isReadme);
  const content = `<main id="main" class="main">
<article class="article">
  ${breadcrumbs(site, [{ label: sec.label, url: sec.url }])}
  <header class="page-header">
    <h1><span class="header-icon">${icon(sec.icon)}</span>${esc(sec.label)}</h1>
    <p class="lead">${esc(sec.blurb)}</p>
  </header>
  ${readme ? `<div class="prose">${readme.html}</div>` : ""}
  ${listing.length ? `<div class="grid grid-list">${listing.map(card).join("")}</div>` : `<p class="muted">Nothing here yet — content is on the roadmap.</p>`}
</article>
</main>`;
  return baseLayout({
    site, theme: config.theme, sections, tags,
    activeSection: sec,
    activePage: readme || null,
    title: sec.label,
    description: sec.blurb,
    content,
    url: sec.url,
    needs: { mermaid: !!readme?.hasMermaid, hljs: !!readme?.hasCode },
  });
}

export function articlePage(config, sections, sec, page, tags = []) {
  const site = config.site;
  const body = page.placeholder
    ? `<div class="prose">${page.html}
<div class="callout callout-info"><div class="callout-title">${icon("clock")} <span class="callout-label">Not written yet</span></div>
<p>This page is on the roadmap.
<a href="${site.repo}" target="_blank" rel="noopener">Contributions are welcome</a> — the structure to follow is in <code>templates/</code>.</p></div></div>`
    : `<div class="prose">${page.html}</div>`;

  const content = `<main id="main" class="main has-toc">
<article class="article">
  ${breadcrumbs(site, [{ label: sec.label, url: sec.url }, { label: page.title, url: page.url }])}
  <header class="page-header">
    <h1>${esc(page.title)}</h1>
    ${pageMeta(page, tagsForPage(page, tags))}
  </header>
  ${body}
  ${prevNext(page)}
</article>
${tocPanel(page.headings)}
</main>`;

  return baseLayout({
    site, theme: config.theme, sections, tags,
    activeSection: sec,
    activePage: page,
    title: page.title,
    description: page.description,
    content,
    needs: { mermaid: page.hasMermaid, hljs: page.hasCode },
  });
}

/** /tags/ — every tag, biggest first, sized so the common ones stand out. */
export function tagIndexPage(config, sections, tags) {
  const site = config.site;
  const url = `${site.baseUrl}tags/`;
  const max = tags[0]?.pages.length || 1;
  const chips = tags
    .map((t) => {
      // Five buckets rather than a continuous scale: enough to show relative
      // weight, few enough that the row still reads as a tidy set of chips.
      const step = Math.min(4, Math.floor((t.pages.length / max) * 5));
      return `<a class="tag tag-w${step}" href="${t.url}">${esc(t.name)}<span class="tag-count">${t.pages.length}</span></a>`;
    })
    .join("");

  const content = `<main id="main" class="main">
<article class="article">
  ${breadcrumbs(site, [{ label: "Tags", url }])}
  <header class="page-header">
    <h1><span class="header-icon">${icon("tag")}</span>Tags</h1>
    <p class="lead">${tags.length} tag${tags.length === 1 ? "" : "s"} across the library. Pick one to see everything filed under it.</p>
  </header>
  ${tags.length ? `<div class="tag-cloud tag-cloud-lg">${chips}</div>` : `<p class="muted">No tags yet — add <code>tags: [something]</code> to a page's frontmatter.</p>`}
</article>
</main>`;

  return baseLayout({
    site, theme: config.theme, sections, tags,
    title: "Tags",
    description: `Browse all ${tags.length} tags on ${site.title}.`,
    content, url, tagsActive: true, needs: {},
  });
}

/** /tags/<slug>/ — the pages carrying one tag. */
export function tagPage(config, sections, tag, tags) {
  const site = config.site;
  const bySection = new Map();
  for (const p of tag.pages) {
    if (!bySection.has(p.section.dir)) bySection.set(p.section.dir, { sec: p.section, pages: [] });
    bySection.get(p.section.dir).pages.push(p);
  }

  const groups = [...bySection.values()]
    .map(
      (g) => `<section class="tag-group">
    <h2>${icon(g.sec.icon)} ${esc(g.sec.label)} <span class="nav-count">${g.pages.length}</span></h2>
    <div class="grid grid-list">${g.pages.map(card).join("")}</div>
  </section>`
    )
    .join("");

  const content = `<main id="main" class="main">
<article class="article">
  ${breadcrumbs(site, [{ label: "Tags", url: `${site.baseUrl}tags/` }, { label: tag.name, url: tag.url }])}
  <header class="page-header">
    <h1><span class="header-icon">${icon("tag")}</span>${esc(tag.name)}</h1>
    <p class="lead">${tag.pages.length} page${tag.pages.length === 1 ? "" : "s"} tagged <code>${esc(tag.name)}</code>.</p>
  </header>
  ${groups}
</article>
</main>`;

  return baseLayout({
    site, theme: config.theme, sections, tags,
    title: `Tagged: ${tag.name}`,
    description: `${tag.pages.length} page${tag.pages.length === 1 ? "" : "s"} tagged "${tag.name}" on ${site.title}.`,
    content, url: tag.url, tagsActive: true, needs: {},
  });
}

export function notFoundPage(config, sections, tags = []) {
  const site = config.site;
  const content = `<main id="main" class="main"><article class="article center-404">
  <div class="e404">404</div>
  <h1>Page not found</h1>
  <p class="lead">This page doesn't exist — it may not be written yet.</p>
  <p><a class="btn btn-primary" href="${site.baseUrl}">Back to home ${icon("arrowRight")}</a></p>
</article></main>`;
  return baseLayout({ site, theme: config.theme, sections, tags, title: "Not found", content, url: site.baseUrl + "404.html", needs: {} });
}
