# Legacy branch salvage review

Reviewed 2026-09-19 against bootstrap `78569ed`. Recommendation: selectively port small helpers,
interaction patterns and regression tests. Do not merge the old applications wholesale. The most
valuable reusable behavior is provider error handling, evidence validation, browser capture and
accessible interactions. The shopper intent, constrained collection and consented demand loop
still require new implementation.

## Scope and confidence

This is a static source review using fetched Git refs and `git show`, including implementation
and test source. No legacy branch was checked out, merged or executed. No live provider calls,
visual browser validation or new performance measurements were made. Tests listed below are
candidate regressions to port, not tests newly demonstrated to pass on those branches.

| Branch | Reviewed commit | Relationship / purpose |
| --- | --- | --- |
| `origin/main` | `d23147bf756fe45b29bef49951931de77935f69c` | Earlier Grove application baseline |
| `origin/analysis-worker` | `46233373cc5c6e8bf00b0d8cf16faed3a28b402b` | Typed model workflows, evidence and validation |
| `origin/eval-release-gates` | `f349cd88268f17f99d012add1374903dcc3ff0ae` | Descends from analysis-worker; adds evaluation gates |
| `origin/browser-base-00` | `5c7887344325de01f19883f31069a12a301c0ef0` | Browser-backed merchant research |
| `origin/browserbase-improvments` | `453afe111d7596bb7122958b18033e2723d5541d` | Descends from browser-base-00; expanded capture and UI |

Use the descendant commits as source for each family. The parent and descendant are not separate
sets of work to integrate. Names above preserve the remote's spelling. All source paths below are
relative to those historical commits, not necessarily present in bootstrap.

## Port priorities and quality conditions

| Priority / source | Retain | Target / owner | Required adaptation before acceptance |
| --- | --- | --- | --- |
| First: analysis `llm/openai.ts`, `workflows/run.ts` | Typed output parsing, refusal/incomplete distinction, bounded retry, injected client | S1-L3-1; `packages/reason/` | Image inputs, current SDK/Zod, cancellation and shared run deadline; private-data-safe logs and repair feedback |
| First: analysis `evidence.ts`, `validator.ts` | Stable evidence rendering, XML escaping, citation membership and inference checks | S4-L3-1; `packages/reason/` | Current public-product/aggregate evidence; typed numerical claims; adversarial validation |
| First: web `CandidateMedia`, `Modal` | Image failure reset, lazy loading, focus restore/trap, Escape behavior | L1 media/products; L3 brief/collection; L4 shared shell | Extract small components; current DTOs; outfit/setup tests; hidden/disabled focus targets |
| Next: browser `store-profiler.ts` | JSON-LD parsing, source URLs, capture hashes, metadata normalization | S4-L1-1; `packages/collect/` | Public merchant profiling only; distinguish marketing claims from facts; precise Shopify detection |
| Next: browser `url-safety.ts`, `browserbase.ts` | URL policy examples and session cleanup structure | L1 collection adapters | Harden request interception, DNS/redirect handling, byte caps and cancellation; fake-backed tests |
| Next: browser API tests | Ownership, idempotency, cancellation and partial-result scenarios | S1-L4-1 and subsequent L4 API cards | Rewrite for Hono, current revisions and injected stores; no whole Express/SQLite port |
| Next: evaluation `eval.ts` and tests | Fixed-denominator ranking metrics, unknown-label reporting, first-pass versus final measurements | L4 milestone/evaluation cards | New product, constraint, consent/privacy and newcomer metrics; report domains separately |
| Later: analysis `pipeline.ts`, `workflows/consistency.ts` | Preserve useful partial results; explicit section failures; constrained explanation cleanup | L3 orchestration / S4 | Current run graph and revision invalidation; no extra LLM pass without latency budget |
| Later: browser discovery/candidate capture | Editorial rejection, storefront hints, image/source extraction | L1 optional discovery/profile fallback | Current catalog authority and variant verification; no fixed candidate scores or seed-brand shortcuts |
| Replace: old report/feedback persistence | Test intent only | L2 demand persistence; L4 APIs | Versioned explicit consent, validated choices, withdrawal/deletion, thresholded aggregation |
| Exclude: old contracts/manifests/full app | Nothing wholesale | Shared owners maintain current foundation | Keep current browser-safe contracts, pnpm catalog, package boundaries and Zod 4 |

These are integration priorities, not completion or time-saving estimates. A helper with a clean
interface can be cheap to extract; the safety and contract changes may cost more than its rewrite.

## Analysis and evidence: useful foundation, different claims

In the analysis family, paths below start at `workers/analysis/src/`.

- [`llm/openai.ts`](https://github.com/Yokanater/htn-26/blob/f349cd88268f17f99d012add1374903dcc3ff0ae/workers/analysis/src/llm/openai.ts)
  uses structured output, disables SDK retries in favor of its own policy, distinguishes model
  errors, and records usage/latency. Its request is text-only and its default timeout is 240,000 ms.
  Port the error taxonomy and fake-client tests, not that deadline. The current run needs composed
  caller cancellation and a shared budget across attempts. Redact provider error messages as well
  as prompt bodies before logging.
- [`workflows/run.ts`](https://github.com/Yokanater/htn-26/blob/f349cd88268f17f99d012add1374903dcc3ff0ae/workers/analysis/src/workflows/run.ts)
  offers one validation-repair retry. Rejected raw output is included in feedback; treat it as
  untrusted data, escape/delimit it, cap its size and keep it out of logs. A retry cannot restart
  the entire run budget.
- [`evidence.ts`](https://github.com/Yokanater/htn-26/blob/f349cd88268f17f99d012add1374903dcc3ff0ae/workers/analysis/src/evidence.ts)
  has deterministic escaped rendering and diversity/freshness selection. Its marketing-source
  limits and sentiment assumptions are not appropriate for authoritative product attributes.
  `distinctSources` counts hostnames; it does not establish independent eligible shopper demand.
  Injection regexes are supplementary checks, not proof that the model follows trusted instructions.
- [`validator.ts`](https://github.com/Yokanater/htn-26/blob/f349cd88268f17f99d012add1374903dcc3ff0ae/workers/analysis/src/validator.ts)
  checks citation IDs, duplicates and inference explanations. However, `findForbiddenAssertions`
  skips a sentence containing a negation token. A sentence such as “No doubt annual revenue is
  $50M” illustrates the resulting blind spot. Replace this shortcut with allowed claim types and
  exact comparisons to code-owned quantities; keep adversarial phrasing tests.
- `workflows/finalize.ts` keeps scoring code-owned and cleans explanation fields. Keep that
  separation, but replace old merchant/report scores. `workflows/consistency.ts` restricts citation
  changes and confidence increases; unchanged citations still do not prove a rewrite is supported.
  Model rewriting must never alter aggregate support counts, hard constraints or provenance.
- `pipeline.ts` uses partial results rather than losing all sections after one failure. Preserve
  the behavior in current run orchestration, with checkpoints and stale-revision rejection.
  `adapters/upstream.ts` joins enrichment by evidence identity; adapt the join pattern without
  reintroducing the old sentiment-based product premise.

Port relevant cases from `workers/analysis/test/llm.test.ts`, `injection.test.ts` and workflow
tests. Fake-model injection tests demonstrate validator behavior, not live-model resistance.
Old `packages/contracts/src/index.ts` uses an incompatible report model and older Zod/dependency
layout. Never copy it over the current schemas or bring along its package manifests/lockfiles.

## Browser and platform: extraction patterns, not a catalog engine

The following references use the browserbase-improvments commit.

- [`apps/api/src/url-safety.ts`](https://github.com/Yokanater/htn-26/blob/453afe111d7596bb7122958b18033e2723d5541d/apps/api/src/url-safety.ts)
  validates public addresses and redirect targets. It is not a finished security boundary:
  `response.text()` reads the body before applying the byte limit; DNS validation is separate
  from the connection resolution; robots handling recognizes only a narrow blanket rule.
  New adapters need bounded streaming reads, connection-aware address enforcement and the
  intended path-level access policy. Add regressions for each before labeling it hardened.
- [`apps/api/src/browserbase.ts`](https://github.com/Yokanater/htn-26/blob/453afe111d7596bb7122958b18033e2723d5541d/apps/api/src/browserbase.ts)
  wraps ephemeral sessions and cleanup in `finally`. Extract behind an injected client. Test
  connect failure, abort, listener cleanup and remote-session release. Checking the final URL
  after navigation is insufficient: enforce policy before navigation, redirects and resource requests.
- [`apps/api/src/store-profiler.ts`](https://github.com/Yokanater/htn-26/blob/453afe111d7596bb7122958b18033e2723d5541d/apps/api/src/store-profiler.ts)
  captures product names and public metadata. That is useful for merchant profiling, but it lacks
  variant-level price/currency/availability/size/dimension evidence required by `ProductOffer`.
  Generic Product structured data is not proof of Shopify. Audience text copied from descriptions
  remains a merchant claim/inference, not observed shopper demand.
- [`apps/api/src/market-research.ts`](https://github.com/Yokanater/htn-26/blob/453afe111d7596bb7122958b18033e2723d5541d/apps/api/src/market-research.ts)
  contains useful editorial rejection and capture heuristics. Its candidate scoring is unsuitable:
  fixed category scores (94/72), description-based evidence values (86/74), geographic fit 72 and
  a score floor 64 do not measure current product compatibility. Displayed weights also differ
  from the formula. Replace scoring entirely with S2 constraints and documented ranking inputs.
  Hardcoded verified brands/query mappings cannot provide equal-domain coverage. Capture date
  must be `capturedAt`, not an invented publication date. Search snippets remain discovery evidence.
  The global three-session pool, aborted queued waits and repeated 61-second capacity delays
  also need cancellation-aware configurable capacity and a shared run budget.

[`apps/api/src/platform.ts`](https://github.com/Yokanater/htn-26/blob/453afe111d7596bb7122958b18033e2723d5541d/apps/api/src/platform.ts)
is an Express/SQLite application, not a drop-in Hono service. Salvage the behavior demonstrated by
its API tests: owner isolation, same-key idempotency, changed-input rejection, partial results and
cancellation. Reimplement these against current ports. In particular:

1. Profile version increments lack the expected-revision compare-and-set needed to reject stale edits.
2. SSE repeatedly sends full report JSON without replay IDs/cursors. Implement current versioned,
   resumable run events instead of copying the polling loop.
3. `useful/not_useful` feedback and saved items lack consent version, match revision and validated
   product-choice provenance. Historical feedback cannot be migrated into observed shopper demand.
4. Demo ticks populate synthetic results. Preserve a separate seed/replay partition; never mix it
   into live aggregate support simply because it traverses a working API.

## User experience: retain interaction quality

[`apps/web/src/main.tsx`](https://github.com/Yokanater/htn-26/blob/453afe111d7596bb7122958b18033e2723d5541d/apps/web/src/main.tsx)
has reusable interaction patterns, but is a large old report application. Extract components into
the current lane-owned feature folders; do not replace the bootstrap entrypoint with it.

- `CandidateMedia`: reset failed images when the URL changes, lazy loading and meaningful alt text.
  Distinguish exact variant photos from generic brand hero images and placeholders.
- `Modal`: Escape, focus restore, scroll locking and keyboard containment. Verify hidden/disabled
  elements and unmount cleanup with current test dependencies.
- `EvidenceCard`: public source links and visible fixture labeling. Adapt to current evidence kinds
  and capture freshness; private shopper evidence must never become merchant source cards.
- Responsive styling and reduced-motion behavior are useful references. Visual quality has not
  been checked in a running browser during this review.
- The old decision handler uses separate concurrent feedback/save operations; partial success is
  possible. New explicit choices need transactional/idempotent semantics, separate from consent.
  Validate SSE payloads against current schemas and reject stale revisions before updating UI.

The main-branch `tests/browser/accessibility.spec.ts` offers useful dialog-focus, reduced-motion
and Axe audit scenarios. Port the test intent with installed tools. Do not add old test dependencies
or claim an equivalent automated accessibility audit when only component tests have run.

## Evaluation: reuse methodology, replace targets

[`workers/analysis/src/eval.ts`](https://github.com/Yokanater/htn-26/blob/f349cd88268f17f99d012add1374903dcc3ff0ae/workers/analysis/src/eval.ts)
uses a fixed precision-at-k denominator, surfaces unknown labels and compares initial versus
shipped output. Retain those methods where applicable. Citation/regex/manual-label checks do not
establish general semantic entailment, and inherit the negation weakness described above.

The historical [`workers/analysis/evals/reports/latest.md`](https://github.com/Yokanater/htn-26/blob/f349cd88268f17f99d012add1374903dcc3ff0ae/workers/analysis/evals/reports/latest.md)
explicitly uses fixtures and a fake client, with five stores toward a 30-store target. Its ranking
scores and release status do not validate the new product or live providers. Existing coffee,
pet, skincare, running and candle cases are fixture-organization examples, not equal outfit/setup
collection coverage.

| Preserve regression intent | Add current acceptance evidence |
| --- | --- |
| Schema/refusal/retry/deadline handling | Image interpretation, explicit confirmation, caller abort and revision invalidation |
| Citation membership / unsupported claims | Exact aggregate quantities, inferred newcomer basis, private-field rejection |
| Precision-at-k and unknown labels | Required-slot coverage, hard-constraint violation rate, valid variant identities, coherent outfit/setup collections |
| Ownership/idempotency/partial failure | Consent withdrawal/regrant, delete invalidation, forged/unshown choice rejection, source partitioning |
| Dialog focus and image fallback | Both-domain correction/partial/no-match flows, consent-independent matching |
| First-pass versus final quality | Per-domain latency and quality, retry cost, fixture versus recorded/live provenance |

## Implementation sequence

1. Start from the integrated bootstrap. Select an active S-card and record its starting SHA.
2. Read the pinned source and tests with `git show <sha>:<path>`. Extract one bounded behavior,
   not a branch merge. Record source commit/function in the implementation handoff.
3. Map to current contracts/core ports and card-owned paths. Keep dependency files unchanged.
4. Port relevant regressions and add the adaptation cases above. Cover outfits and setups wherever
   behavior is domain-dependent; use fakes/recordings only.
5. Run card acceptance, typecheck, relevant fixtures and integration checks. Run format before
   committing. L4 owns non-vacuous milestone acceptance; missing tests are not a green gate.
6. Humans perform the specified live spikes separately. Report anything still mocked or unmeasured.

No reviewed branch implements the new private upload lifecycle, confirmed visual intent,
variant-constrained multi-store collection engine, revisioned consent/decision ledger, thresholded
demand with withdrawal/deletion, or evidence-grounded newcomer matching as designed in v3.
Preserving those requirements is more important than maximizing lines of reused code.
