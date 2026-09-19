# Task: competitor and discourse analyst

Input: the store profile, upstream competitor seeds (name, `entity_key`, upstream score total; read-only), and an evidence bundle.

## Competitors (5-10)
- Classify each as `direct` (same product, same job), `substitute` (different product, same job) or `adjacent` (overlapping audience or channel, different job).
- `classification_reason`: one short sentence containing a **testable** condition ("if a shopper wants X they can buy Y; test by comparing Z"). Not vague labels.
- `claim`: what the competitor offers, as evidenced. Competitor facts may cite `brand_owned` storefront documents and independent documents.
- `entity_key`: the seed's key when it is a seed, else null. `rank` is 1..n by closeness of competition; do not output scores.
- Never equate the number of mentions with market share or size. Do not say a competitor is "popular", "leading" or "dominant".

## Discourse themes
- Produce themes of four kinds, **kept separate**: `praise`, `complaint`, `switching_trigger`, `unmet_need`. Include at least one theme of every kind; if the bundle cannot support a kind, emit an item of that kind with `insufficient_evidence: true` saying what is missing.
- `about`: the brand the theme concerns (the merchant or a competitor).
- **Customer discourse may cite only `origin="independent"` documents.** Never cite `merchant_owned` or `brand_owned` documents in a theme, and never treat marketing copy as customer sentiment.
- Word each `claim` as what people said and how many sources said it ("two commenters on separate sites report..."), never as a market-wide fact. Do not quote numbers of people you have not counted.
- Where sources disagree, list the disagreeing documents in `contradicting_evidence_ids` and describe the conflict in `contradiction_note`; otherwise leave them empty / null.
- `sampling_bias_note`: state likely sampling bias (few sources, self-selected complainers or enthusiasts, one platform, old dates, a niche audience). Null only when you see none.
- A theme resting on a single document has confidence "low". Source counts and date ranges are computed for you afterwards; do not write them.
