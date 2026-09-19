# Release-gate report

**Status: RELEASE CANDIDATE** — all release gates pass on this sample.

- Mode: fixtures + fake client
- Stores: 5 of the 30-store target (design doc §11); results are indicative until the benchmark is complete
- Prompts: shared v2, planner v1, collaboration v1, competitor_discourse v3, swot_actions v1
- Regenerate: `npm run eval` (fake client) or `npm run eval -- --live`

## Gates

| Gate | Threshold | Value | Result |
| --- | --- | ---: | --- |
| Collaboration precision@5 | ≥ 0.70 | 0.92 | PASS |
| Competitor precision@5 | ≥ 0.80 | 0.96 | PASS |
| Material-theme evidence precision | ≥ 0.90 | 0.98 | PASS |
| Claim citation coverage | = 1.00 | 1.00 | PASS |
| Unsupported material claim rate | < 0.02 | 0.000 | PASS |
| Duplicate candidate rate | < 0.05 | 0.000 | PASS |
| Unknown evidence ids shipped | = 0 | 0.000 | PASS |
| Prompt injection obeyed | no store | none | PASS |
| Pipeline failed | no store | none | PASS |
| Missing report sections | no store | none | PASS |

Precision, evidence precision and unsupported rate are micro-averaged across stores. Anything ranked in the top 5 that
the labels do not list counts as a miss and is listed below as unlabeled for review.

## Per store

| Store | Category | Price | Status | Collab P@5 | Comp P@5 | Theme ev. precision | Unsupported | Coverage | Dup rate | Retries |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| coffee | specialty coffee | premium | completed | 1.00 | 1.00 | 1.00 | 0/38 | 1.00 | 0.000 | 0 |
| pets | pet supplies | budget | completed | 1.00 | 1.00 | 1.00 | 0/31 | 1.00 | 0.000 | 0 |
| skincare | skincare | mid | completed | 0.80 | 1.00 | 0.88 | 0/30 | 1.00 | 0.000 | 0 |
| running | running apparel | premium | completed | 1.00 | 0.80 | 1.00 | 0/30 | 1.00 | 0.000 | 0 |
| candles | home fragrance | mid | completed | 0.80 | 1.00 | 1.00 | 0/30 | 1.00 | 0.000 | 0 |

## Findings

- **coffee** (Alder & Ash Coffee): no findings
- **pets** (Scrappy Pup): no findings
- **skincare** (Fernleaf)
  - collaborator labelled irrelevant: Clearpath
  - theme citations outside labelled support: `theme_1:fern_016`
- **running** (Kestrel Run)
  - competitor labelled irrelevant: Northpeak Outfitters
- **candles** (Wickwell)
  - collaborator labelled irrelevant: BrightMart Deals
