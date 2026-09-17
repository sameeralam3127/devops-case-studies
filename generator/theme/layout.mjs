/** Base HTML document layout: head/SEO, header, sidebar, search modal, footer. */

import { createHash } from "node:crypto";
import { esc, sidebar, icon } from "./components.mjs";

/**
 * Third-party runtime deps, pinned with Subresource Integrity so a
 * compromised or mutated CDN file is refused by the browser rather than
 * executed. Loaded only on pages that need them.
 */
const CDN = {
  mermaid: {
    src: "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js",
    sri: "sha384-WmdflGW9aGfoBdHc4rRyWzYuAjEmDwMdGdiPNacbwfGKxBW/SO6guzuQ76qjnSlr",
  },
  hljs: {
    src: "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js",
    sri: "sha384-F/bZzf7p3Joyp5psL90p/p89AZJsndkSoGwRpXcZhleCWhd8SnRuoYo4d0yirjJp",
  },
};
const CDN_ORIGIN = "https://cdn.jsdelivr.net";

const sha256 = (s) => "sha256-" + createHash("sha256").update(s, "utf8").digest("base64");

/**
 * Serialise data for embedding inside a <script> element.
 *
 * JSON.stringify leaves `<` and `>` untouched, so a value containing
 * "</script>" would close the element and let the rest of the string be
 * parsed as HTML. Escaping them as \u-sequences keeps the JSON valid and
 * makes an early close impossible.
 */
function jsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
}

function cdnScript(dep) {
  return `<script src="${dep.src}" integrity="${dep.sri}" crossorigin="anonymous" referrerpolicy="no-referrer" defer></script>`;
}

/**
 * Where this page sits in the hierarchy, as schema.org expects it.
 *
 * Search engines use this to render the "Home > Kubernetes > OOMKilled"
 * trail instead of a bare URL, which is worth more on a deep documentation
 * URL than on a shallow one. A section index is its own last crumb, so it
 * is not repeated.
 *
 * Deliberately absent: SearchAction. It claims the site accepts a search
 * query at a URL, and this one only has a client-side modal with no `?q=`
 * route — declaring it would be structured data that lies.
 */
function breadcrumbLd(site, page) {
  if (!page) return null;
  const crumbs = [{ name: "Home", url: site.origin + site.baseUrl }];
  if (page.section) {
    crumbs.push({
      name: page.section.label,
      url: site.origin + site.baseUrl + page.section.dir + "/",
    });
  }
  if (!page.isReadme) crumbs.push({ name: page.title, url: site.origin + page.url });
  if (crumbs.length < 2) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };
}

function jsonLd(site, page) {
  if (!page) {
    return {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: site.title,
      description: site.description,
      url: site.origin + site.baseUrl,
    };
  }
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: page.title,
    description: page.description,
    author: { "@type": "Person", name: page.author || site.author },
    datePublished: page.created || undefined,
    dateModified: page.updated || undefined,
    url: site.origin + page.url,
    wordCount: page.words || undefined,
    keywords: page.tags?.length ? page.tags.join(", ") : undefined,
  };
}

/** All structured-data nodes for a page, as one array. */
function structuredData(site, page) {
  return [jsonLd(site, page), breadcrumbLd(site, page)].filter(Boolean);
}

/**
 * @param {object} o
 *  site, theme, sections, activePage, activeSection, title, description,
 *  content (main HTML), bodyClass, extraHead
 */
export function baseLayout(o) {
  const { site, sections } = o;
  const fullTitle = o.title ? `${o.title} · ${site.title}` : `${site.title} — ${site.tagline}`;
  const desc = o.description || site.description;
  const canonical = site.origin + (o.activePage ? o.activePage.url : o.url || site.baseUrl);
  const b = site.baseUrl;
  const needs = o.needs || {};
  // A page can opt out of the sidebar entirely (the landing page does). It is
  // left out of the DOM rather than hidden with CSS: a nav that is not there
  // costs no bytes, cannot be reached by Tab, and takes its now-meaningless
  // toggle buttons with it.
  const hasSidebar = o.sidebar !== false;

  // Inline scripts are allowed by hash, so the CSP needs no 'unsafe-inline'
  // for scripts. The boot script must stay inline: it runs before first
  // paint to prevent a theme/sidebar flash.
  const bootJs = `(function(){var t=localStorage.getItem("sd365-theme");if(t)document.documentElement.dataset.theme=t;if(localStorage.getItem("sd365-sidebar")==="closed")document.documentElement.classList.add("sidebar-collapsed");})();`;
  const cfgJs = `window.SD365={base:"${b}",autoHideSidebar:${o.theme?.autoHideSidebar !== false}};`;

  // Publication dates as Open Graph article properties. Only meaningful on a
  // real article, and only when the frontmatter actually carries the date —
  // an empty content="" is worse than the tag's absence.
  const ap = o.activePage;
  const articleMeta = ap
    ? [
        ap.created ? `\n<meta property="article:published_time" content="${ap.created}">` : "",
        ap.updated ? `\n<meta property="article:modified_time" content="${ap.updated}">` : "",
        ...(ap.tags || []).map((t) => `\n<meta property="article:tag" content="${esc(t)}">`),
      ].join("")
    : "";

  const needsCdn = needs.mermaid || needs.hljs;
  const csp = [
    "default-src 'self'",
    `script-src 'self' '${sha256(bootJs)}' '${sha256(cfgJs)}'${needsCdn ? ` ${CDN_ORIGIN}` : ""}`,
    `style-src 'self' 'unsafe-inline'${needs.hljs ? ` ${CDN_ORIGIN}` : ""}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");

  return `<!doctype html>
<html lang="${site.language}" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0b0d11" media="(prefers-color-scheme: dark)">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="${o.activePage ? "article" : "website"}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="${esc(site.title)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="author" content="${esc(o.activePage?.author || site.author)}">${articleMeta}
<link rel="icon" href="${b}assets/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(site.title)}" href="${b}rss.xml">
<link rel="stylesheet" href="${b}assets/css/theme.css">${needsCdn ? `\n<link rel="preconnect" href="${CDN_ORIGIN}" crossorigin>` : ""}
<script>${bootJs}</script>
<script type="application/ld+json">${jsonForScript(structuredData(site, o.activePage))}</script>
${o.extraHead || ""}
</head>
<body class="${o.bodyClass || ""}">
<a class="skip-link" href="#main">Skip to content</a>
<div class="progress-bar" aria-hidden="true"><div id="progress"></div></div>
<header class="topbar">${
  hasSidebar
    ? `
  <button id="menu-btn" class="icon-btn" aria-label="Open navigation">${icon("menu")}</button>
  <button id="sidebar-btn" class="icon-btn" aria-label="Toggle sidebar" title="Toggle sidebar (\\)">${icon("panelClose", "i-close")}${icon("panelOpen", "i-open")}</button>`
    : ""
}
  <a class="brand" href="${b}">
    <span class="brand-mark">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5-8 4.5-8-4.5 8-4.5Z" fill="currentColor" opacity=".95"/><path d="m4 12.5 8 4.5 8-4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".65"/></svg>
    </span>
    <span class="brand-name">${esc(site.title)}</span>
  </a>
  <button id="search-btn" class="search-fake" aria-label="Search (press / or Ctrl+K)">
    ${icon("search")}<span class="search-fake-label">Search documentation</span><kbd><span class="kbd-mod">Ctrl</span> K</kbd>
  </button>
  <div class="topbar-right">
    <button id="theme-btn" class="icon-btn" aria-label="Toggle dark mode" title="Toggle theme (t)">${icon("sun", "i-sun")}${icon("moon", "i-moon")}</button>
    <a class="icon-btn" href="${site.repo}" target="_blank" rel="noopener" aria-label="GitHub repository">${icon("github")}</a>
  </div>
</header>
<div class="shell${hasSidebar ? "" : " shell-bare"}">${
  hasSidebar
    ? `
  <aside class="sidebar" id="sidebar">${sidebar(sections, o.activePage, o.activeSection, {
    tagsUrl: o.tags?.length ? `${b}tags/` : null,
    tagCount: o.tags?.length || 0,
    tagsActive: !!o.tagsActive,
  })}</aside>
  <div class="sidebar-scrim" id="sidebar-scrim"></div>`
    : ""
}
  ${o.content}
</div>
<footer class="footer">
  <span>© ${new Date().getFullYear()} ${esc(site.author)} · <a href="${site.repo}" target="_blank" rel="noopener">Contribute on GitHub</a></span>
  <span class="muted">Built with sd365 — a custom static site generator. Content is plain Markdown.</span>
</footer>

<div class="search-modal" id="search-modal" hidden>
  <div class="search-panel" role="dialog" aria-modal="true" aria-label="Search">
    <div class="search-input-row">${icon("search")}<input id="search-input" type="search" placeholder="Search case studies, patterns, concepts…" autocomplete="off" spellcheck="false"></div>
    <div class="search-filters" id="search-filters"></div>
    <ul class="search-results" id="search-results"></ul>
    <div class="search-help"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span><span class="search-help-mod"><kbd><span class="kbd-mod">Ctrl</span> K</kbd> anytime</span></div>
  </div>
</div>

<div class="zoom-overlay" id="zoom-overlay" hidden><div class="zoom-inner" id="zoom-inner"></div></div>

<script>${cfgJs}</script>${needs.mermaid ? `\n${cdnScript(CDN.mermaid)}` : ""}${needs.hljs ? `\n${cdnScript(CDN.hljs)}` : ""}
<script src="${b}assets/js/search.js" defer></script>
<script src="${b}assets/js/app.js" defer></script>
</body>
</html>`;
}
