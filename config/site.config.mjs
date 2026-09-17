/**
 * Central configuration for the sd365 static site generator.
 * Everything the build needs to know about the site lives here —
 * the generator itself is content-agnostic.
 */
export default {
  site: {
    title: "DevOps Engineering Case Studies",
    tagline: "Learn the problem. Design the solution. Understand the trade-offs. Operate the system.",
    description:
      "Practical DevOps, SRE, Cloud and Platform Engineering case studies covering architecture, troubleshooting, automation, reliability, security and production operations.",
    // Project pages live under /<repo>/ on GitHub Pages.
    baseUrl: "/devops-case-studies/",
    origin: "https://sameeralam3127.github.io",
    repo: "https://github.com/sameeralam3127/devops-case-studies",
    author: "Sameer Alam",
    language: "en",
  },

  // Content sections, in sidebar/nav order. `dir` is a folder under docs/,
  // `icon` is a name from generator/lib/icons.mjs, and `group` is the optional
  // sidebar heading a section sits under. Sections with no `group` are listed
  // ungrouped, so a site that wants one flat list simply omits the field.
  sections: [
    { dir: "01-linux", group: "Domains", label: "Linux", icon: "terminal", blurb: "Host-level failures: CPU saturation, memory pressure, disk exhaustion." },
    { dir: "02-networking", group: "Domains", label: "Networking", icon: "network", blurb: "DNS, TCP, proxies, load balancers, TLS." },
    { dir: "03-docker", group: "Domains", label: "Docker", icon: "layers", blurb: "Images, build pipelines, cgroups, container runtime behaviour." },
    { dir: "04-kubernetes", group: "Domains", label: "Kubernetes", icon: "grid", blurb: "Scheduling, probes, autoscaling, cluster architecture, failure modes." },
    { dir: "05-cicd", group: "Domains", label: "CI/CD", icon: "spark", blurb: "Pipeline design, deployment safety, rollback, migration." },
    { dir: "06-gitops", group: "Domains", label: "GitOps", icon: "github", blurb: "Argo CD, drift, sync failures, secrets in a declarative world." },
    { dir: "07-infrastructure-as-code", group: "Domains", label: "Infrastructure as Code", icon: "chip", blurb: "Terraform/OpenTofu state, drift, modules, migrations." },
    { dir: "08-observability", group: "Domains", label: "Observability", icon: "search", blurb: "Metrics, logs, traces, alert design, cost of telemetry." },
    { dir: "09-sre", group: "Domains", label: "SRE", icon: "warning", blurb: "Incident response, postmortems, SLOs, error budgets, MTTR." },
    { dir: "10-security", group: "Domains", label: "Security", icon: "shield", blurb: "Secrets, RBAC, supply chain, credential compromise." },
    { dir: "11-cloud", group: "Domains", label: "Cloud", icon: "star", blurb: "Multi-region architecture, failover, cost engineering." },
    { dir: "12-platform-engineering", group: "Domains", label: "Platform Engineering", icon: "bulb", blurb: "Internal developer platforms, golden paths, self-service." },
    { dir: "labs", group: "Practice", label: "Labs", icon: "bug", blurb: "Reproducible environments that break on purpose." },
    { dir: "adr", group: "Practice", label: "Decision Records", icon: "scale", blurb: "Architecture decisions, the options rejected, and why." },
    { dir: "interview", group: "Practice", label: "Interview Prep", icon: "mic", blurb: "Scenario-driven questions with strong and weak answers." },
    { dir: "system-design", group: "Practice", label: "System Design", icon: "note", blurb: "Distributed systems designed end to end." },
    { dir: "glossary", group: "Reference", label: "Glossary", icon: "book", blurb: "Terms you should be able to define cold." },
    { dir: "notes", group: "Reference", label: "Notes", icon: "list", blurb: "Roadmap, references, and working notes." },
  ],

  theme: {
    // Collapse the sidebar automatically once the reader scrolls into an
    // article, so long-form content gets the full width. A manual toggle
    // (button or the \ key) always wins and is remembered.
    autoHideSidebar: true,
    // Generate /tags/ and /tags/<tag>/ from frontmatter `tags`, and turn the
    // tag chips on each page into links. Set false to drop them entirely.
    tags: true,
  },

  markdown: {
    // Expand `:rocket:` shortcodes to emoji in body text, titles, and
    // descriptions. Code spans and fenced blocks are never touched.
    emoji: true,
  },

  home: {
    // Curated entry points shown above the Explore grid, in this order.
    // Paths are relative to the content dir, without the .md extension.
    // Entries that don't resolve to a published page are skipped, so a
    // rename can't break the build.
    startHere: [
      "04-kubernetes/crashloopbackoff-after-release",
      "04-kubernetes/oomkilled-under-load",
      "10-security/python-before-your-code-runs",
    ],
  },

  build: {
    contentDir: "docs",
    assetsDir: "assets",
    publicDir: "public",
    outDir: "dist",
    // Words-per-minute used for reading-time estimates.
    wpm: 220,
    // Set false to keep the built HTML/CSS readable while debugging.
    minify: true,
  },

  // Plugins run in order. Each is a module in generator/plugins/ exporting
  // { name, setup?, onPage?, onDone? }. `minify` rewrites emitted files, so
  // it must run last.
  plugins: ["search-index", "sitemap", "rss", "og-meta", "minify"],
};
