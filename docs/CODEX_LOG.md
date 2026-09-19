# Codex log

One row after every meaningful Codex assist (split §11.5, milestones README §4.5): time, lane, card
ID, what Codex did, and the outcome, including when it was wrong and how you caught it. L3 curates
this into the Devpost "How Codex helped" section. Confirm current prize requirements with the event guide; do not infer eligibility from this log.

| Time | Lane | Card | What Codex did | Outcome |
| 2026-09-19 | L4 integration | S2-L4-1 | Reconciled local fixes and remote live discovery/results with owner-scoped SSE, preserved L2/L3 fixes, tested offline composition and prepared main cleanup | 523 tests passed; 22 S1/S2 gate tests; 67 fixture tests; typecheck/format/build passed; macOS decoder tests skipped on Windows |
| --- | --- | --- | --- | --- |

| 2026-09-19 | All / L3 coordination | REVAMP-0 | Researched and rewrote the two-sided intent plan; balanced UI ownership; added equal-domain contracts, interfaces, fixtures, flags and bootstrap metadata. | Offline: 108 tests, typecheck, fixtures (66), bootstrap gate (3), format and web build passed; no live calls. S1–S5 implementation remains on cards. |
| 2026-09-19 | All / coordination | GUIDE-0 | Added shared Claude/Codex implementation guidance, dispatch prompts and a pinned legacy-branch salvage review. | Documentation only; reviewed source and historical test cases without executing legacy branches or live providers. |

| 2026-09-19 | L4 integration | S2-L4-1 | Connected confirmed briefs to bounded catalog search, collection matching, visual offers, evidence, and visit-local shortlists; expanded clothing size labels. | Offline integration covers both domains and privacy/revisions. Browser confirmation returned three real red-mug products and shortlist worked. Caught and fixed duplicate StrictMode searches; merchant demand persistence remains pending. |
| 2026-09-19 | L3 | S3-L3-1a | Claude added flag-gated accept/replace/reject with reasons, save/request-offer, stale-409 re-apply, and DemandEvent-derived decision DTO + typed handler in collection/** | 37 collection tests, typecheck/format/build green; undo is local-only until an item_cleared kind and idempotency key land in contracts |
| 2026-09-19 | L3 | S3-L3-1b | Claude added flag-gated ConsentPanel (opt-in, withdraw, delete confirm, version display) with callback-only API and full plain-language copy | 9 ConsentPanel tests, typecheck/format/build green; consent routes still mocked |
