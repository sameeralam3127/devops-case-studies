/* sd365 client runtime: theme, collapsible sidebar (reading mode), reading
   progress, TOC scrollspy, copy buttons, mermaid + zoom, syntax highlight,
   and the client-side search engine. No frameworks. */
(function () {
  "use strict";
  var CFG = window.SD365 || {};
  var BASE = CFG.base || "/";
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var root = document.documentElement;

  /* ---------- platform-aware shortcut hints ---------- */
  // Rendered as "Ctrl" server-side; swapped to the Command symbol on Apple
  // hardware so the hint matches the key the reader actually presses.
  var isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
  if (isMac) {
    $$(".kbd-mod").forEach(function (el) { el.textContent = "⌘"; });
  }

  /* ---------- theme ---------- */
  function isDark() {
    var t = root.dataset.theme;
    if (t === "dark") return true;
    if (t === "light") return false;
    return matchMedia("(prefers-color-scheme: dark)").matches;
  }
  $("#theme-btn").addEventListener("click", function () {
    var next = isDark() ? "light" : "dark";
    root.dataset.theme = next;
    localStorage.setItem("sd365-theme", next);
    renderMermaid(true);
  });

  /* ---------- sidebar: manual toggle + reading auto-hide ---------- */
  var sidebarBtn = $("#sidebar-btn");
  var stored = localStorage.getItem("sd365-sidebar"); // "open" | "closed" | null
  // Auto-hide applies on article pages at reading width.
  //
  // This used to require stored === null, which meant a single click of the
  // toggle — ever — disabled reading mode permanently on that browser. The
  // stored value is a starting state, not a standing veto: "closed" means
  // the sidebar is already out of the way (the boot script handles it, so
  // there is nothing to hide), and "open" means start expanded, which says
  // nothing about what should happen 500px into an article.
  //
  // An explicit toggle still wins, but only for the page view it happens in:
  // the click handler disarms autoArmed so the sidebar you just opened to
  // navigate with does not snap shut under you.
  var autoArmed = CFG.autoHideSidebar !== false && stored !== "closed" &&
    !document.body.classList.contains("is-home") && !!$(".prose");
  var autoHidden = false;

  function setCollapsed(on) { root.classList.toggle("sidebar-collapsed", on); }

  // The landing page renders no sidebar at all, so these controls are absent
  // there. Binding blind threw on the first one and — because this file is a
  // single IIFE — took search, the theme toggle and everything after it down
  // with it. Bind only what the page actually has.
  var menuBtn = $("#menu-btn");
  var scrim = $("#sidebar-scrim");

  if (sidebarBtn) {
    sidebarBtn.addEventListener("click", function () {
      var collapsed = !root.classList.contains("sidebar-collapsed");
      setCollapsed(collapsed);
      localStorage.setItem("sd365-sidebar", collapsed ? "closed" : "open");
      autoArmed = false; // an explicit choice wins from here on
      autoHidden = false;
    });
  }

  /* ---------- mobile nav ---------- */
  if (menuBtn) menuBtn.addEventListener("click", function () { document.body.classList.toggle("nav-open"); });
  if (scrim) scrim.addEventListener("click", function () { document.body.classList.remove("nav-open"); });

  /* ---------- reading progress (+ auto-hide trigger) ---------- */
  var prog = $("#progress");
  function onScroll() {
    var h = root;
    var max = h.scrollHeight - h.clientHeight;
    var y = h.scrollTop;
    if (prog) prog.style.width = (max > 0 ? (y / max) * 100 : 0) + "%";

    if (autoArmed && innerWidth >= 1000) {
      if (!autoHidden && y > 480 && !root.classList.contains("sidebar-collapsed")) {
        setCollapsed(true);
        autoHidden = true;
      } else if (autoHidden && y < 140) {
        setCollapsed(false);
        autoHidden = false;
      }
    }
  }
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- TOC scrollspy ---------- */
  var tocLinks = $$(".toc a");
  if (tocLinks.length && "IntersectionObserver" in window) {
    var map = {};
    tocLinks.forEach(function (a) { map[a.getAttribute("href").slice(1)] = a; });
    var active = null;
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          if (active) active.classList.remove("active");
          active = map[e.target.id];
          if (active) active.classList.add("active");
        }
      });
    }, { rootMargin: "-70px 0px -70% 0px" });
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) obs.observe(el);
    });
  }

  /* ---------- copy code ---------- */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".copy-btn");
    if (!btn) return;
    var code = btn.parentElement.querySelector("code");
    var label = btn.querySelector("span");
    navigator.clipboard.writeText(code.innerText).then(function () {
      label.textContent = "Copied";
      btn.classList.add("copied");
      setTimeout(function () { label.textContent = "Copy"; btn.classList.remove("copied"); }, 1600);
    });
  });

  /* ---------- mermaid ---------- */
  var mermaidSources = null;
  function renderMermaid(rerender) {
    if (!window.mermaid) return;
    var blocks = $$(".mermaid");
    if (!blocks.length) return;
    if (!mermaidSources) mermaidSources = blocks.map(function (b) { return b.textContent; });
    if (rerender) {
      blocks.forEach(function (b, i) {
        b.removeAttribute("data-processed");
        b.innerHTML = "";
        b.textContent = mermaidSources[i];
      });
    }
    window.mermaid.initialize({
      startOnLoad: false,
      theme: isDark() ? "dark" : "default",
      // "antiscript" keeps <br> in node labels working while stripping
      // script content — "loose" would allow arbitrary HTML/JS from a
      // diagram, which is a needless risk for contributed content.
      securityLevel: "antiscript",
      fontFamily: getComputedStyle(document.body).fontFamily,
    });
    window.mermaid.run({ nodes: blocks });
  }

  /* ---------- diagram zoom ---------- */
  var overlay = $("#zoom-overlay"), zoomInner = $("#zoom-inner");
  document.addEventListener("click", function (e) {
    var d = e.target.closest(".diagram");
    if (d && !overlay.contains(e.target)) {
      var svg = d.querySelector("svg");
      if (!svg) return;
      zoomInner.innerHTML = "";
      var clone = svg.cloneNode(true);
      clone.removeAttribute("width");
      clone.removeAttribute("height");
      clone.style.maxWidth = "none";
      zoomInner.appendChild(clone);
      overlay.hidden = false;
    } else if (!overlay.hidden && (e.target === overlay || overlay.contains(e.target))) {
      overlay.hidden = true;
    }
  });

  /* ---------- syntax highlight ---------- */
  // Token colors live in theme.css and follow the theme variables, so
  // switching themes needs no work here.
  function highlight() {
    if (!window.hljs) return;
    $$("pre code[class*='language-']").forEach(function (el) { window.hljs.highlightElement(el); });
  }

  addEventListener("load", function () { renderMermaid(false); highlight(); });

  /* ---------- search ---------- */
  var modal = $("#search-modal"), input = $("#search-input"),
      resultsEl = $("#search-results"), filtersEl = $("#search-filters");
  var index = null, sel = 0, results = [], activeFilter = null, lastTerms = [];

  function openSearch() {
    modal.hidden = false;
    document.body.style.overflow = "hidden"; // don't scroll the page behind the sheet
    input.value = "";
    input.focus();
    if (!index) {
      resultsEl.innerHTML = '<li class="search-empty">Loading…</li>';
      fetch(BASE + "search-index.json")
        .then(function (r) { return r.json(); })
        .then(function (j) {
          index = SD365Search.prepare(j.docs);
          buildFilters();
          run("");
        })
        .catch(function () { resultsEl.innerHTML = '<li class="search-empty">Search index unavailable.</li>'; });
    } else run("");
  }
  function closeSearch() {
    modal.hidden = true;
    document.body.style.overflow = "";
  }

  // Warm the index while the browser is idle so the first keystroke has
  // nothing to wait for. Never blocks page load, and is skipped on metered
  // or slow connections where the extra request isn't worth it.
  function prefetchIndex() {
    if (index) return;
    var conn = navigator.connection;
    if (conn && (conn.saveData || /2g/.test(conn.effectiveType || ""))) return;
    fetch(BASE + "search-index.json")
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!index) { index = SD365Search.prepare(j.docs); buildFilters(); }
      })
      .catch(function () { /* search falls back to fetching on open */ });
  }
  if (window.requestIdleCallback) requestIdleCallback(prefetchIndex, { timeout: 4000 });
  else addEventListener("load", function () { setTimeout(prefetchIndex, 1500); });

  /**
   * Follow a result. A hit on the page you're already reading is only a hash
   * change, so the browser never reloads — the modal has to be dismissed and
   * the scroll lock released here, or it looks like the click did nothing.
   */
  function goTo(url) {
    var hashAt = url.indexOf("#");
    var path = hashAt < 0 ? url : url.slice(0, hashAt);
    var hash = hashAt < 0 ? "" : url.slice(hashAt);
    closeSearch();
    if (hash && path === location.pathname) {
      history.replaceState(null, "", url);
      var target = document.getElementById(hash.slice(1));
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      location.href = url;
    }
  }

  // Links keep real hrefs so middle-click and "open in new tab" still work;
  // only a plain left click is intercepted.
  resultsEl.addEventListener("click", function (e) {
    var a = e.target.closest("a");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    goTo(a.getAttribute("href"));
  });

  function buildFilters() {
    var secs = [];
    index.docs.forEach(function (d) { if (secs.indexOf(d.s) < 0) secs.push(d.s); });
    filtersEl.innerHTML = "";
    secs.forEach(function (s) {
      var b = document.createElement("button");
      b.textContent = s;
      b.addEventListener("click", function () {
        activeFilter = activeFilter === s ? null : s;
        $$("button", filtersEl).forEach(function (x) { x.classList.toggle("on", x.textContent === activeFilter); });
        run(input.value);
        input.focus();
      });
      filtersEl.appendChild(b);
    });
  }

  function mark(text, terms) {
    var out = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    terms.forEach(function (q) {
      if (!q) return;
      out = out.replace(new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig"), "\x01$1\x02");
    });
    return out.replace(/\x01/g, "<mark>").replace(/\x02/g, "</mark>");
  }

  function run(q) {
    if (!index) return;
    lastTerms = SD365Search.terms(q);
    results = SD365Search.search(index, q, activeFilter);
    sel = 0;
    render();
  }

  function render() {
    if (!results.length) {
      resultsEl.innerHTML = '<li class="search-empty">No matches. Try fewer or different words.</li>';
      return;
    }
    resultsEl.innerHTML = results.map(function (h, i) {
      var d = h.doc;
      var crumb = h.section
        ? '<span class="sr-crumb">' + mark(h.section.t, lastTerms) + "</span>"
        : "";
      var snip = lastTerms.length ? SD365Search.snippet(h, lastTerms) : "";
      return '<li class="' + (i === sel ? "sel" : "") + '"><a href="' + d.u +
        (h.section ? "#" + h.section.a : "") + '">' +
        '<div class="sr-title">' + mark(d.t, lastTerms) +
        '<span class="sr-meta">' + mark(d.s, []) + (d.p ? " · not written yet" : "") + "</span></div>" +
        crumb +
        (snip ? '<div class="sr-snip">' + mark(snip, lastTerms) + "</div>" : "") +
        "</a></li>";
    }).join("");
  }

  $("#search-btn").addEventListener("click", openSearch);
  // The landing page leads with search; it opens the same modal.
  var heroSearch = $("#hero-search");
  if (heroSearch) heroSearch.addEventListener("click", openSearch);
  input.addEventListener("input", function () { run(input.value); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!results.length) return;
      sel = (sel + (e.key === "ArrowDown" ? 1 : results.length - 1)) % results.length;
      render();
      var s = $(".search-results .sel");
      if (s) s.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      var a = $(".search-results .sel a");
      if (a) goTo(a.getAttribute("href"));
    }
  });
  modal.addEventListener("click", function (e) { if (e.target === modal) closeSearch(); });

  /* ---------- global keyboard shortcuts ---------- */
  document.addEventListener("keydown", function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === "Escape") {
      if (!overlay.hidden) overlay.hidden = true;
      else closeSearch();
      return;
    }
    if (typing) return;
    if (e.key === "/" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
      e.preventDefault();
      openSearch();
    } else if (e.key === "\\") {
      // No sidebar on the landing page, so nothing to toggle.
      if (!sidebarBtn) return;
      e.preventDefault();
      sidebarBtn.click();
    } else if (e.key === "[" || e.key === "]") {
      var link = $(".pn-" + (e.key === "[" ? "prev" : "next"));
      if (link) location.href = link.getAttribute("href");
    } else if (e.key.toLowerCase() === "t") {
      $("#theme-btn").click();
    }
  });
  /* ================= landing page ==================================
     Everything below is enhancement. The page is complete and correct
     server-rendered: the first scenario is visible, the coverage bars
     already carry their real widths, the stat tiles already show their
     final numbers, and every card is unfiltered. If this block never
     runs, nothing is missing — it only adds motion and filtering. */

  var reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- featured scenario rotator ---------- */
  (function () {
    var wrap = $("#scenes");
    if (!wrap) return;
    var scenes = [].slice.call(wrap.querySelectorAll(".scene"));
    var pips = [].slice.call(wrap.querySelectorAll(".scene-pip"));
    if (scenes.length < 2) return;

    var i = 0;
    var timer = null;
    var period = Number(wrap.getAttribute("data-rotate")) || 7000;

    function show(n) {
      i = (n + scenes.length) % scenes.length;
      scenes.forEach(function (el, k) {
        var on = k === i;
        el.classList.toggle("is-active", on);
        // Only the visible card should be reachable by Tab or read aloud.
        if (on) el.removeAttribute("aria-hidden");
        else el.setAttribute("aria-hidden", "true");
        el.tabIndex = on ? 0 : -1;
      });
      pips.forEach(function (pip, k) {
        pip.classList.toggle("is-active", k === i);
        pip.setAttribute("aria-selected", k === i ? "true" : "false");
      });
    }

    function start() { if (!reduceMotion && !timer) timer = setInterval(function () { show(i + 1); }, period); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }

    pips.forEach(function (pip) {
      pip.addEventListener("click", function () { stop(); show(Number(pip.getAttribute("data-i"))); });
    });

    // Reading one of these takes longer than the rotation, so hovering or
    // tabbing into the card holds it; leaving resumes.
    wrap.addEventListener("mouseenter", stop);
    wrap.addEventListener("mouseleave", start);
    wrap.addEventListener("focusin", stop);
    wrap.addEventListener("focusout", start);
    // A backgrounded tab should not burn through the whole set unseen.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop(); else start();
    });

    show(0);
    start();
  })();

  /* ---------- stat tiles: count up on first view ---------- */
  (function () {
    var tiles = [].slice.call(document.querySelectorAll(".stat-value"));
    if (!tiles.length || reduceMotion || !window.IntersectionObserver) return;

    // Stash the real value up front, before anything can animate over it.
    // Reading the target from textContent at animation time was a bug: if
    // animate() ran twice, the second run captured a half-counted value as
    // its destination, so the tiles crept toward a number that was never
    // right ("0 / 7" instead of "3 / 66") and never arrived.
    tiles.forEach(function (t) { t.setAttribute("data-final", t.textContent); });

    // Animate the numbers inside the string and leave everything else alone,
    // so "3 / 66", "2.9 h" and "88" all survive with their formatting.
    function animate(el) {
      if (el.getAttribute("data-counting")) return;
      el.setAttribute("data-counting", "1");
      var final = el.getAttribute("data-final");
      var parts = final.split(/(\d+(?:\.\d+)?)/);
      var srcNums = parts.filter(function (x) { return /^\d/.test(x); });
      if (!srcNums.length) { el.textContent = final; return; }
      var nums = srcNums.map(Number);
      var decimals = srcNums.map(function (src) {
        var dot = src.indexOf(".");
        return dot === -1 ? 0 : src.length - dot - 1;
      });
      var t0 = 0;
      var DUR = 900;
      function frame(ts) {
        if (!t0) t0 = ts;
        var k = Math.min(1, (ts - t0) / DUR);
        var ease = 1 - Math.pow(1 - k, 3);
        var n = -1;
        el.textContent = parts
          .map(function (chunk) {
            if (!/^\d/.test(chunk)) return chunk;
            n++;
            return (nums[n] * ease).toFixed(decimals[n]);
          })
          .join("");
        if (k < 1) requestAnimationFrame(frame);
        else el.textContent = final; // land exactly on the stashed real value
      }
      requestAnimationFrame(frame);
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        animate(en.target);
      });
    }, { threshold: 0.6 });
    tiles.forEach(function (t) { io.observe(t); });
  })();

  /* ---------- coverage bars: replay from zero on first view ---------- */
  (function () {
    var tracks = [].slice.call(document.querySelectorAll(".cov-bar"));
    if (!tracks.length || reduceMotion || !window.IntersectionObserver) return;

    // Observe the track, never the fill. Collapsing a fill to width:0 leaves
    // it with no intersection area at all, so a threshold above 0 can never
    // be met and the bar would sit at zero forever — which is worse than not
    // animating, because the server-rendered width was already correct.
    var pairs = tracks
      .map(function (track, i) {
        var fill = track.querySelector(".cov-fill[data-pct]");
        return fill ? { track: track, fill: fill, i: i } : null;
      })
      .filter(Boolean);
    if (!pairs.length) return;

    pairs.forEach(function (pr) { pr.fill.style.width = "0%"; });

    // One idempotent way to arrive at the real width. Whatever triggers it —
    // the observer, or the safety net below — a bar can only ever end up at
    // the value the build put there.
    function reveal(pr, delay) {
      if (pr.done) return;
      pr.done = true;
      pr.fill.style.transition = "width .8s cubic-bezier(.22,.8,.3,1)";
      setTimeout(function () {
        pr.fill.style.width = pr.fill.getAttribute("data-pct") + "%";
      }, delay || 0);
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        var pr = pairs.filter(function (x) { return x.track === en.target; })[0];
        // Stagger down the list so it reads as one sweep, not twelve twitches.
        if (pr) reveal(pr, Math.min(pr.i, 12) * 45);
      });
    }, { threshold: 0.25 });
    pairs.forEach(function (pr) { io.observe(pr.track); });

    // Safety net. An animation that fails to run is a cosmetic loss; a bar
    // stuck at 0% when the build said 25% is a page telling the reader
    // something false. So anything still unrevealed shortly after load gets
    // its width regardless of whether it was ever scrolled into view.
    setTimeout(function () {
      io.disconnect();
      pairs.forEach(function (pr) { reveal(pr, 0); });
    }, 4000);
  })();

  /* ---------- Latest: filter by section ---------- */
  (function () {
    var bar = $("#latest-filters");
    var grid = $("#latest-grid");
    var empty = $("#latest-empty");
    if (!bar || !grid) return;

    var chips = [].slice.call(bar.querySelectorAll(".chip"));
    var cards = [].slice.call(grid.querySelectorAll(".card"));

    bar.addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (!chip) return;
      var want = chip.getAttribute("data-filter");
      chips.forEach(function (c) {
        var on = c === chip;
        c.classList.toggle("is-active", on);
        c.setAttribute("aria-pressed", on ? "true" : "false");
      });
      var shown = 0;
      cards.forEach(function (card) {
        var hide = want !== "all" && card.getAttribute("data-section") !== want;
        card.classList.toggle("is-filtered", hide);
        if (!hide) shown++;
      });
      if (empty) empty.hidden = shown > 0;
    });
  })();
})();
