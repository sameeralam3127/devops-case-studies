---
title: "Cloudflare's 18 Nov 2025 Outage: One Bad Feature File"
description: A database permissions change doubled the size of an auto-generated config file, a hard limit in the proxy turned that into a panic, and a large share of the web returned 5xx for about three hours. Reading the incident as an SRE, from alert to corrective actions.
tags: [sre, incident, postmortem, real-incident, config-management, deployment-safety, clickhouse, rust, cloudflare]
type: incident
difficulty: hard
author: Sameer Alam
created: 2026-10-31
updated: 2026-10-31
status: published
---

> [!NOTE] This one is real
> Every other case study on this site uses a constructed scenario. This one does
> not. The **facts** (times, the query, the 200-feature limit, the panic, the
> affected services, the corrective actions) come from Cloudflare's own public
> post-mortem, *Cloudflare outage on November 18, 2025*, linked under
> [References](#references). The **investigation path, code samples, alerts
> and runbook** are this site's teaching reconstruction of how you would work
> the same failure. They are labelled that way and do not describe Cloudflare's
> internal tooling. Where the public sources disagree, both values are given.

## Scenario

It is 11:28 UTC on Tuesday, 18 November 2025. Cloudflare's edge, which sits in
front of a large share of the world's websites and APIs, starts returning HTTP
5xx for customer traffic. It is not one region or one product. It is the
core proxy, everywhere.

The error rate does not climb and stay up. It **spikes, recovers, and spikes
again** every few minutes. Workers KV is throwing errors. Cloudflare's own
dashboard logins fail. Then, by coincidence, Cloudflare's status page, which
is hosted entirely off Cloudflare's infrastructure, also goes down.

An intermittent, global failure plus a dead status page looks like an attack.
The first hypothesis on the call is a hyper-scale DDoS. It is wrong. The cause
is a file the company generates itself, every five minutes, that just got
twice as long.

## Context

| Property | Value |
|---|---|
| System | Cloudflare global edge network, core proxy ("FL"), in mid-migration to a Rust rewrite ("FL2") |
| Failing component | **Bot Management** module inside the core proxy |
| Its input | A *feature file*: the list of features the bot-scoring ML model uses |
| How the file is made | A query against a **ClickHouse** cluster, re-run **every five minutes** |
| How it is shipped | Pushed to every proxy machine across the network, quickly by design |
| Why so fast | Bot traffic changes quickly; the model has to keep up with new attacks |
| Normal size | About **60** features |
| Hard limit | **200** features, memory preallocated at startup for performance |
| Database layout | Distributed tables in the `default` database; the underlying shard tables in a database named `r0` |

Two things in that table carry the whole incident. The file is **internal,
machine-generated and trusted**, so it never went through the scrutiny a
customer config would. And it is shipped **everywhere at once**, on purpose,
because slow propagation would defeat the point of the feature.

## Symptoms

What the people on the incident call saw, in the order it became visible:

- **Global 5xx from the core proxy.** Customers behind Cloudflare served
  Cloudflare-branded error pages.
- **Oscillation.** Errors rose and fell on roughly a five-minute rhythm before
  settling into a steady failure.
- **Workers KV elevated 5xx.** KV depends on the core proxy, so it failed too,
  and its errors were loud enough to look like the origin of the problem.
- **Dashboard logins failing.** The login page uses Turnstile, which also failed.
- **Cloudflare Access authentication failures** for new logins.
- **Latency up across the CDN.** Debugging and observability systems were
  burning CPU adding context to the flood of uncaught errors.
- **The status page went down.** Unrelated, and hosted elsewhere, but at that
  moment it read as evidence of a coordinated attack.

## Impact

**Technical impact** (from Cloudflare's post-mortem):

| Service | What happened |
|---|---|
| Core CDN and security services | HTTP 5xx for customer traffic |
| Turnstile | Failed to load |
| Workers KV | Significantly elevated 5xx, because requests to KV's front end pass through the core proxy |
| Dashboard | Mostly up, but most users could not log in because Turnstile was down |
| Email Security | Mail kept flowing; one IP-reputation source was temporarily lost, reducing spam-detection accuracy |
| Access | Widespread authentication failures for new sessions until the 13:05 bypass; existing sessions were unaffected |
| Customers still on the old proxy (FL) | **No errors, but every request got a bot score of zero**, so customer rules that block bots started blocking real users |

**Business impact.** Cloudflare described it as its worst outage since 2019.
Core traffic was largely failing for about three hours, and full recovery took
almost six. The outage was felt far beyond Cloudflare's own customers, because
the sites and APIs it fronts went down for their users too. Cloudflare has not
published a revenue figure, and this page does not invent one.

## Requirements

What any remediation, short-term or long-term, has to achieve:

1. Restore core proxy traffic globally, as the first priority over root-causing.
2. Stop the bad file being **regenerated** every five minutes, or recovery will
   undo itself.
3. Restore a **known-good** feature file everywhere.
4. Make a malformed or oversized internal config file a **handled error**, never
   a process crash.
5. Be able to switch a single feature off **globally**, in minutes, without a
   code deploy.
6. Stop error reporting from consuming the CPU the proxy needs to serve traffic.

## Constraints

- **Freshness is a feature.** The file exists to react to new bot traffic in
  minutes. "Ship config slowly" is not free; it weakens bot protection.
- **The limit is real.** The 200-feature ceiling was preallocated memory for
  speed, on the request hot path, on every machine. Making it unbounded costs
  latency.
- **Two proxies at once.** FL and FL2 behaved differently on the same input, so
  one fix and one test was not enough.
- **Dependent services.** KV, Access, Turnstile and the dashboard all sat
  downstream of the core proxy, so recovering them meant ordering the restarts.
- **Global blast radius by design.** There is no "one region first" for a file
  whose whole job is to be everywhere fast.

## Initial Architecture

```text
                   every 5 minutes
 ┌───────────────────────┐   query    ┌─────────────────────────────────┐
 │  Feature file job     │──────────▶ │  ClickHouse cluster             │
 │  (generator)          │◀────────── │  default.http_requests_features │ (distributed)
 └──────────┬────────────┘   rows     │  r0.http_requests_features      │ (shards)
            │                         └─────────────────────────────────┘
            │ feature file (~60 features)
            ▼
 ┌───────────────────────┐
 │  Global config        │   seconds, to every machine, no canary
 │  distribution         │─────────────────────────────────────────┐
 └───────────────────────┘                                         │
                                                                   ▼
 ┌──────────────────────────── each edge machine ────────────────────────────┐
 │  request ─▶ core proxy (FL / FL2) ─▶ Bot Management module ─▶ ... ─▶ origin │
 │                                       │                                    │
 │                                       └─ loads feature file into a         │
 │                                          preallocated table (max 200)      │
 └────────────────────────────────────────────────────────────────────────────┘
        ▲                ▲               ▲
        │                │               │
   Workers KV         Access         Turnstile ─▶ Dashboard login
   (front end goes through the core proxy)
```

## Investigation

> [!TIP] Reconstruction
> This is the path an SRE would walk with what was visible at each step. The
> real call's timeline is in [Postmortem](#postmortem). Commands use generic
> tooling and are illustrations, not Cloudflare's internal tools.

**Step 1 — Is it us or the origin?** A global 5xx from the edge, across
unrelated customers, rules out any single origin. The proxy itself is failing.

**Step 2 — Is it an attack?** This is the hypothesis the real team started with,
and it was reasonable: the failure was global, it oscillated, and the status
page went down. What argues against it:

- Request volume at the edge is not abnormally high; it is the *error ratio*
  that changed.
- A DDoS degrades in proportion to load. This failure flips between "fine" and
  "broken" on a fixed cadence.
- The status page is on separate infrastructure. Treat a coincidence as a
  coincidence until something links them.

The lesson here is not "never suspect an attack". It is **test the hypothesis
against the cheapest disconfirming signal first**, which here is request
volume.

**Step 3 — What has a five-minute period?** Oscillation on a fixed rhythm almost
always means something periodic: a cron job, a cache TTL, a config refresh.
List everything that runs on that period and pushes to the edge.

```bash
# Illustrative: correlate error spikes with config pushes.
# Error ratio per minute from proxy logs:
zcat proxy-*.log.gz | awk '$9 >= 500 {e[substr($4,2,17)]++} {t[substr($4,2,17)]++}
  END {for (m in t) printf "%s %.3f\n", m, e[m]/t[m]}' | sort

# Config pushes per minute from the distribution system's audit log:
grep 'feature_file' config-push-audit.log | awk '{print $1, $2, $5}'
```

If error onset lines up with the minutes a new feature file landed, and recovery
lines up with the next file, the file is your suspect.

**Step 4 — What does the crashing process say?** On FL2 the logs showed a
panic, not an error response:

```text
thread fl2_worker_thread panicked: called Result::unwrap() on an Err value
```

A panic at a config load site means the input violated an assumption that the
code turned into a crash.

**Step 5 — Compare a good file with a bad file.**

```bash
# Illustrative. Keep the last N feature files; diff a good one against a bad one.
wc -l feature-file.good feature-file.bad
sort feature-file.bad | uniq -d | head      # duplicated feature names
```

The bad file has more than twice the rows, and the extra rows are
**duplicates** of existing feature names. Over 200 entries trips the limit.

**Step 6 — Why duplicates, and why only sometimes?** The generator query reads
column metadata:

```sql
SELECT name, type
FROM system.columns
WHERE table = 'http_requests_features'
ORDER BY name;
```

It filters by **table name only**, not by database. That was harmless while the
querying account could see only the `default` database. At 11:05 a permissions
change started rolling out across the ClickHouse cluster that made the account's
access to the underlying `r0` tables explicit. From then on, `system.columns`
also returned the `r0` copy of every column.

The rollout was **gradual**. The job got a bad result only when it happened to
run on an already-updated node. So every five minutes the network got either a
good file or a bad one, which is exactly the oscillation. Once every node was
updated, every file was bad and the failure became steady.

## Root Cause

**Trigger:** a ClickHouse access-control change (11:05 UTC) that made metadata
for tables in the `r0` database visible to the account that builds the feature
file.

**Root cause:** the feature-file query assumed `system.columns` would only ever
return columns from one database, and did not say so (`WHERE table = …` with no
`AND database = …`). When that assumption broke, the query returned each feature
twice, more than doubling the file.

**Why it became an outage, not a bug:**

| Layer | Assumption that failed |
|---|---|
| Generator | The metadata query returns one database's columns |
| Pipeline | An internally generated file is trustworthy; no size or duplicate check before shipping |
| Distribution | Ship to everywhere at once; no canary, no automatic halt |
| FL2 proxy | The file never exceeds 200 features, so `.unwrap()` on the load result is safe |
| Failure handling | No fallback to the last-known-good file |

**Distinguishing evidence**, in the order that rules things out:

- Request volume normal → not a volumetric attack.
- Five-minute oscillation → a periodic producer, not a hardware or network fault.
- Panic in the config load path → the input broke an invariant.
- Bad file has duplicate rows → the producer emitted the same data twice.
- Duplicates match the `r0` database → the permissions change is the trigger.

## Solution

Immediate mitigation, in the order that mattered on the day:

1. **Contain the blast radius you can.** Bypass the failing path for the most
   critical dependents. Cloudflare moved Workers KV and Access onto a fallback
   path to an earlier version of the core proxy at 13:05.
2. **Stop the producer.** Halt generation *and* propagation of new feature files
   (14:24). Without this, any manual fix is overwritten five minutes later.
3. **Roll forward to last-known-good.** Put a known-good file into the
   distribution queue and force the proxy to pick it up (main impact resolved at
   14:30).
4. **Recover the long tail.** Restart downstream services that had wedged, and
   work through the backlog of failures (all services back by 17:06).

Durable fix, per Cloudflare's corrective actions:

- Treat **internally generated config the same as user input**: validate it on
  ingestion.
- Add **more global kill switches** for features.
- Stop **core dumps and error reports from consuming** the resources the proxy
  needs.
- **Review failure modes** for error conditions across every core proxy module.

## Architecture

The remediated design, as a reconstruction of those actions into a pipeline:

```text
 ┌──────────────┐  query scoped to   ┌──────────────┐
 │ Feature job  │  database='default'│  ClickHouse  │
 └──────┬───────┘ ─────────────────▶ └──────────────┘
        │
        ▼
 ┌─────────────────────────────────────────────┐
 │ Validation gate (producer side)             │  reject + alert + keep
 │  • count ≤ limit with margin                │  serving the previous file
 │  • no duplicate names                       │
 │  • change vs. previous file within bounds   │
 └──────┬──────────────────────────────────────┘
        ▼
 ┌─────────────────────────────────────────────┐
 │ Staged distribution                         │
 │  canary PoPs ─▶ health check ─▶ rest        │  auto-halt on error ratio
 │  global kill switch: "freeze feature file"  │
 └──────┬──────────────────────────────────────┘
        ▼
 ┌──────────────────── each edge machine ───────────────────────┐
 │ Bot module loader (consumer side)                            │
 │  parse → validate → swap   on any error: keep last-known-good │
 │  never panic on bad input; emit metric + rate-limited log    │
 │  bot module itself has a kill switch (fail open/closed policy)│
 └──────────────────────────────────────────────────────────────┘
```

Validation happens **twice**, on purpose. The producer check stops a bad file
leaving the building. The consumer check means a bad file that gets out anyway,
through a bug in the producer check, a manual push or a corrupted transfer,
still cannot crash the proxy.

## Implementation

> [!WARNING] Illustrative code
> Cloudflare's file format and loader are not public. The format below (one
> `name<TAB>type` per line) is invented for the example. The patterns are the
> point, and the code runs as written.

**1. Make the query say what it assumes.**

```sql
SELECT name, type
FROM system.columns
WHERE database = 'default'
  AND table = 'http_requests_features'
ORDER BY name;
```

A query against a metadata table that does not name its database depends on
the permissions of whoever runs it. Write it so the result does not change when
grants change.

**2. Producer-side gate** — runs before a file is published. Fails closed: if it
exits non-zero, the previous file stays live.

```python
#!/usr/bin/env python3
"""Validate a generated feature file before it is distributed.

Exit 0: publish. Exit 1: do not publish; keep serving the previous file.
"""
import sys

HARD_LIMIT = 200        # what the consumer has preallocated
SAFE_LIMIT = 150        # alert well before the hard limit
MAX_GROWTH = 0.25       # >25% change in one cycle is suspicious, not normal


def load(path):
    feats = []
    with open(path, encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            line = line.rstrip("\n")
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) != 2 or not parts[0]:
                raise ValueError(f"{path}:{n}: malformed line {line!r}")
            feats.append(parts[0])
    return feats


def main(new_path, prev_path):
    new, prev = load(new_path), load(prev_path)
    errors = []

    dupes = sorted({x for x in new if new.count(x) > 1})
    if dupes:
        errors.append(f"{len(dupes)} duplicate feature names, e.g. {dupes[:5]}")
    if len(new) > SAFE_LIMIT:
        errors.append(f"{len(new)} features exceeds safe limit {SAFE_LIMIT} (hard {HARD_LIMIT})")
    if prev and abs(len(new) - len(prev)) / len(prev) > MAX_GROWTH:
        errors.append(f"size changed {len(prev)} -> {len(new)} in one cycle")

    for e in errors:
        print(f"REJECT: {e}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
```

The bad file from 18 November would have failed all three checks: duplicate
names, more than 150 features, and more than doubling in one cycle.

**3. Consumer-side loader** — the part that turned a bad file into an outage.
The fix is not "raise the limit". It is "a bad file is an error you handle".

```rust
use std::collections::HashSet;
use std::sync::{Arc, RwLock};

pub const MAX_FEATURES: usize = 200;

#[derive(Debug)]
pub enum FeatureFileError {
    Malformed { line: usize },
    Duplicate(String),
    TooMany { got: usize, max: usize },
}

#[derive(Debug)]
pub struct FeatureSet {
    pub names: Vec<String>,
}

impl FeatureSet {
    pub fn parse(raw: &str) -> Result<Self, FeatureFileError> {
        let mut names = Vec::new();
        let mut seen = HashSet::new();
        for (i, line) in raw.lines().enumerate().filter(|(_, l)| !l.is_empty()) {
            let name = line
                .split('\t')
                .next()
                .filter(|n| !n.is_empty())
                .ok_or(FeatureFileError::Malformed { line: i + 1 })?;
            if !seen.insert(name) {
                return Err(FeatureFileError::Duplicate(name.to_string()));
            }
            names.push(name.to_string());
            if names.len() > MAX_FEATURES {
                return Err(FeatureFileError::TooMany { got: names.len(), max: MAX_FEATURES });
            }
        }
        Ok(FeatureSet { names })
    }
}

/// Holds the active feature set. A new file replaces it only if it is valid.
pub struct BotFeatures {
    active: RwLock<Arc<FeatureSet>>,
}

impl BotFeatures {
    pub fn new(initial: FeatureSet) -> Self {
        BotFeatures { active: RwLock::new(Arc::new(initial)) }
    }

    /// Called on every config push. Never panics on bad input.
    /// Returns false when the file was rejected and the old one kept.
    pub fn on_new_file(&self, raw: &str) -> bool {
        match FeatureSet::parse(raw) {
            Ok(set) => {
                *self.active.write().unwrap_or_else(|p| p.into_inner()) = Arc::new(set);
                true
            }
            Err(e) => {
                // In production: increment a counter and log at a rate limit.
                eprintln!("feature file rejected, keeping last-known-good: {e:?}");
                false
            }
        }
    }

    pub fn current(&self) -> Arc<FeatureSet> {
        self.active.read().unwrap_or_else(|p| p.into_inner()).clone()
    }
}

fn main() {
    let good = "bot_a\tf32\nbot_b\tf32\n";
    let bad = "bot_a\tf32\nbot_b\tf32\nbot_a\tf32\n"; // duplicate, as on 18 Nov
    let features = BotFeatures::new(FeatureSet::parse(good).expect("seed file is valid"));
    assert!(!features.on_new_file(bad));
    assert_eq!(features.current().names.len(), 2); // still serving the good file
    println!("ok: bad file rejected, {} features active", features.current().names.len());
}
```

The difference from the failing code is one decision: the `Result` from loading
goes to a `match` that keeps the old value, not to `.unwrap()`. The
`expect` that remains is at startup with a seed file, where failing fast is
correct. In a hot reload path, failing fast takes down the fleet.

**4. Kill switch** — a flag read on every push, flipped by a human:

```yaml
# Illustrative global flag, distributed separately from the feature file.
bot_management:
  feature_file:
    frozen: true          # ignore new files; keep the current one
  module:
    enabled: true         # false = skip bot scoring entirely
    on_disabled: allow    # allow (fail open) | challenge (fail closed)
```

`frozen` is what "stop propagation" should be: a flag, not an emergency code
change. It must travel on a **different channel** from the thing it controls,
or the broken pipeline cannot deliver the fix.

## Observability

Signals that would have pointed at the file in minutes rather than hours.
PromQL, with metric names this example assumes you export.

```promql
# 1. The proxy is failing, not the origins: edge-generated 5xx ratio.
sum(rate(edge_responses_total{code=~"5..", source="proxy"}[1m]))
  / sum(rate(edge_responses_total[1m])) > 0.01

# 2. Config loads are failing on the fleet.
sum(rate(config_load_failures_total{config="bot_feature_file"}[5m])) > 0

# 3. Feature-file size is approaching the consumer limit.
max(bot_feature_file_features) > 150

# 4. Process crashes, by reason, across the fleet.
sum by (reason) (increase(proxy_worker_panics_total[5m])) > 0

# 5. The quieter failure on the old proxy: bot scores collapsed to zero.
histogram_quantile(0.5, sum by (le) (rate(bot_score_bucket[5m]))) < 1
```

Alert 5 matters as much as the others. On FL nothing errored: every request
simply scored as a bot. A system that **fails silently with a plausible
default** needs a distribution check, because no error counter will move.

Also record the **config version with every error**. "Errors started with file
version N and stopped with N+1" turns hours of hypothesis into one query.

## Security

- **The trigger was a security improvement.** The permissions change was meant
  to make access explicit and tighten how distributed queries run. Security
  changes are changes; they need the same blast-radius review.
- **The attack hypothesis cost time but was not wrong to raise.** Have a fast
  disconfirming check (request volume, source spread) so it can be dropped
  quickly.
- **Fail-open vs fail-closed for a security module.** Crashing is the worst
  option: it fails closed for *everyone*. Deciding ahead of time whether an
  unscored request is allowed or challenged is a security decision. It should
  be written down, not discovered during an outage.
- **Internal inputs are inputs.** "We generate it, so it's trusted" is how one
  compromised or buggy generator reaches every machine. Validate on ingestion.

## Reliability

| Concern | Before | After |
|---|---|---|
| Bad config | Crash (FL2) or silent zero scores (FL) | Rejected, last-known-good kept, alert fires |
| Propagation | Global, immediate | Canary first, auto-halt on error ratio |
| Stop button | Required engineering work under pressure | Global `frozen` flag on a separate channel |
| Error handling cost | Error reporting consumed CPU, adding latency | Rate-limited, bounded error reporting |
| Dependents | KV, Access, Turnstile share the core proxy's fate | Pre-built bypass paths for critical dependents |

The general rule this incident teaches: **every hot-reloaded config needs a
last-known-good, and loading a new one must be able to fail without taking the
process with it.**

## Cost Considerations

No invented prices. Cost drivers:

- **Outage cost** scales with traffic share × duration. At this scale, minutes
  matter, so time to *stop the producer* is the biggest lever.
- **Canarying costs freshness.** Holding a file at canary PoPs for a few minutes
  delays bot defences. Size the canary window against how fast bot patterns
  actually change, not against comfort.
- **Validation is cheap.** Counting lines and checking duplicates on a
  60-line file costs nothing next to the downtime it prevents.
- **Error-reporting overhead** is a capacity cost that shows up only during
  incidents, which is exactly when you can't afford it. Budget for it.

## Trade-offs

| Option | Gain | Cost |
|---|---|---|
| Raise the 200 limit | Survives this exact file | Doesn't fix duplicates; more hot-path memory; the next bug just needs a bigger file |
| Unbounded, dynamically sized table | No limit to hit | Allocation and latency on the hot path; unbounded memory from a bad producer |
| Validate on producer only | Simple | One bug in the validator and the fleet is exposed again |
| Validate on producer and consumer (chosen) | Defence in depth | Two places to keep in sync |
| Slow rollout for all config | Smaller blast radius | Slower bot defences; not acceptable for this file without a canary design |
| Canary + auto-halt (chosen) | Small blast radius, still fast | Pipeline complexity; needs a clean health signal |
| Fail open on bad config | Traffic keeps flowing | Bot protection silently off; must be visible |
| Fail closed on bad config | Protection stays strict | Real users blocked; can be as bad as an outage |

The deep trade-off is **freshness against safety**. The answer is not to pick
one; it is to make bad input non-fatal so that speed stops being dangerous.

## Failure Scenarios

What can still break after the fixes:

1. **A file that is valid but wrong.** 60 well-formed features with the wrong
   types pass every structural check. The canary health signal has to measure
   *behaviour* (score distribution), not only errors.
2. **The canary signal is too slow or too noisy** and lets a bad file through,
   or blocks every good one until someone disables the canary.
3. **The kill switch shares a dependency** with what it controls, and is down
   when it is needed.
4. **Last-known-good is stale.** After hours of rejected files, the model runs
   on old features. Alert on age of the active file.
5. **Two proxies, two behaviours.** A fix tested only on FL2 does nothing for
   FL's silent zero scores.
6. **Another unscoped metadata query** elsewhere, broken by the next grant change.

## Runbook

*Bot feature file rejected or suspected bad — for the on-call engineer.*

1. **Confirm scope.** Is the 5xx ratio elevated from the proxy, not origins,
   across many PoPs? (Alert 1.) If one PoP only, this is not your runbook.
2. **Check volume.** Is request rate normal? If yes, drop the attack hypothesis
   for now and continue.
3. **Check config correlation.** Did errors start within one push cycle of a new
   feature-file version? Note the version.
4. **Freeze.** Set `bot_management.feature_file.frozen: true`. Confirm on three
   PoPs that the active version stops changing.
5. **Roll back.** Push the last version that passed validation and served
   cleanly. Confirm the active version on the fleet.
6. **Watch for 10 minutes.** 5xx ratio back to baseline? Bot-score median back
   to normal?
7. **If no recovery:** set `module.enabled: false` with the documented
   `on_disabled` policy. Announce that bot protection is reduced.
8. **Recover dependents.** Check KV, Access, Turnstile and dashboard login in that
   order; restart anything still wedged.
9. **Leave it frozen.** Do not unfreeze until the producer is fixed and a new
   file passes validation in canary.
10. **Hand off** with: bad version, good version, times of freeze and rollback.

## Prevention

- Scope every metadata query by database **and** table.
- Gate every generated config with size, duplicate and growth checks.
- Validate again at load. Any parse or limit error keeps the old config.
- Ban `.unwrap()` / `.expect()` on hot-reload paths with a lint, for example
  Clippy's `unwrap_used` and `expect_used` scoped to those modules.
- Canary internal config like code, with an automatic halt.
- Ship kill switches on an independent channel and exercise them in game days.
- Load-test the error path: what does the fleet's CPU do when every request
  logs an error?
- Treat permission and grant changes as deploys: staged, observable, reversible.

## Postmortem

**Timeline** (UTC, 18 November 2025, from Cloudflare's post-mortem):

| Time | Event |
|---|---|
| 11:05 | Database access-control change deployed (gradual rollout across the ClickHouse cluster) |
| 11:20–11:28 | Network starts failing to deliver core traffic; first errors on customer HTTP traffic. *Sources give 11:20 for the start of significant failures and 11:28 for the first customer errors.* |
| 11:32–13:05 | Team investigates elevated traffic and errors on Workers KV, initially as KV degradation; traffic manipulation and account limiting tried |
| 13:05 | Workers KV and Access bypassed to an earlier version of the core proxy; their impact reduced |
| 13:37 | Work focuses on rolling the Bot Management feature file back to a last-known-good version |
| 14:24 | Creation and propagation of new feature files stopped; old file tested successfully |
| 14:30 | Main impact resolved: correct file deployed globally, core traffic largely normal |
| 17:06 | All services resolved; downstream services restarted |

**Root cause.** The feature-file query read `system.columns` filtered by table
name only. After the permissions change, it also returned the `r0` copies,
duplicating every feature and pushing the file past the 200-feature limit.

**Contributing factors.**

- Internally generated config was not validated before or after distribution.
- FL2 converted the limit violation into a panic via `.unwrap()`.
- No canary or automatic halt on feature-file distribution.
- The gradual database rollout made the failure intermittent, which disguised a
  config problem as a possible attack.
- The unrelated status-page outage reinforced the attack hypothesis.
- Error reporting consumed CPU, adding latency on top of the failures.

**Detection.** Automated monitoring caught the errors quickly. **Diagnosis** is
where the time went: roughly two hours from first errors to focusing on the
feature file.

**Corrective actions** (Cloudflare's stated list):

| Action | Kind |
|---|---|
| Harden ingestion of Cloudflare-generated config files as if they were user input | Prevent |
| Enable more global kill switches for features | Mitigate |
| Stop core dumps and other error reports from overwhelming system resources | Mitigate |
| Review failure modes for error conditions across all core proxy modules | Prevent |

Owners and dates are internal to Cloudflare and not in the public post-mortem.

## Interview Questions

1. Your error rate oscillates on a fixed five-minute cycle across every region.
   What does the period tell you, and what do you check first?
2. A global outage coincides with your status page going down. How do you decide
   whether it's an attack, and how quickly can you rule it out?
3. Why is a metadata query like `SELECT … FROM system.columns WHERE table = 'x'`
   dangerous, and how would you make it robust to permission changes?
4. Explain the difference between producer-side and consumer-side config
   validation. Why have both?
5. A hot-reload path uses `.unwrap()` on the parse result. What does it cost when
   the input is bad, and what should it do instead?
6. The old proxy didn't crash; it returned a bot score of zero for everyone.
   Is that better or worse than crashing? How would you detect it?
7. How do you canary a config whose whole value is propagating in seconds?
8. Where should a kill switch live so that it still works when the config
   pipeline is the thing that's broken?
9. Should a security module fail open or fail closed on bad configuration?
   Defend your answer for a CDN's bot scoring.
10. Mitigation took about three hours and full recovery about six. Where would
    you expect those minutes went, and which one change shortens it most?

## Key Takeaways

- **Internal config is input.** Generated by you does not mean correct.
- **A hard limit plus a crash is an outage waiting for a big enough file.** Keep
  limits; handle violations.
- **Every hot-reloaded config needs a last-known-good** and a load path that can
  fail without killing the process.
- **Periodic symptoms point at periodic producers.** Look at what runs on that
  cadence before you look at attackers.
- **Silent wrong defaults need behavioural alerts.** Nothing errored on FL; bot
  scores just went to zero.
- **The stop button must not share fate with what it stops.**
- **Security hardening is a change.** Stage it, observe it, be ready to undo it.

## Related Projects

- [KubeRescue](https://github.com/sameeralam3127/KubeRescue) — policy-driven
  auto-remediation. The "halt on error ratio, roll back to last-known-good"
  loop here is the same shape as a remediation policy.
- [Monitoring](https://github.com/sameeralam3127/Monitoring) — a Prometheus and
  Grafana stack to try the PromQL alerts above against your own services.
- Related on this site: [CrashLoopBackOff After a
  Release](../04-kubernetes/crashloopbackoff-after-release.md), the same failure
  shape (a bad input crashes the process on start) at the scale of one
  deployment.

## References

- Cloudflare, *Cloudflare outage on November 18, 2025*, Matthew Prince —
  <https://blog.cloudflare.com/18-november-2025-outage/> (primary source for every
  fact on this page).
- Cloudflare Status, incident history for 18 November 2025 —
  <https://www.cloudflarestatus.com/history>.
- ClickHouse documentation, `system.columns` —
  <https://clickhouse.com/docs/operations/system-tables/columns>.
- Clippy lints `unwrap_used` and `expect_used` —
  <https://rust-lang.github.io/rust-clippy/master/>.
