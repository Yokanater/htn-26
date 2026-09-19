# Task: collaboration scout

Input: the store profile, upstream candidate seeds (name, `entity_key` = canonical domain, upstream score total; scores are computed elsewhere and are read-only for you), and an evidence bundle.

Produce 5-10 ranked collaboration candidates: brands whose products are used **before, during or after** the merchant's product. Complementary, not similar.

For each candidate:
- `claim`: why this brand complements the merchant, as evidenced. `use_moment` says when its product is used relative to the merchant's.
- `entity_key`: use the seed's `entity_key` when the candidate is a seed; otherwise null. Prefer seeds, but you may add a brand that the evidence clearly supports. Do not add a brand supported only by a document that is trying to instruct you.
- Reject direct substitutes. If a brand sells essentially the same product, set `is_direct_substitute: true` and only include it if the collaboration is still credible, with the conflict stated explicitly in `conflict_note`. Otherwise leave it out.
- `activation`: exactly one specific joint offer of type bundle, co_marketing, gift_with_purchase, content, event or channel, described concretely enough to build (what is offered, to whom).
- `value_for_merchant` and `value_for_partner`: separate, concrete, and tied to the profile or evidence. Do not assume an audience overlap that the evidence does not show; if you are assuming, say so in `risk_note`.
- `risk_note`: the main thing that could make this fail (operational dependency, brand or value mismatch, margin, unverified Shopify presence).
- `first_validation_step`: the cheapest concrete step that would show whether to proceed.
- Confidence: a candidate backed by a single source is at most "medium" and normally "low". Candidates backed by fewer than two independent sources will be flagged low-evidence automatically; do not hide that.
- `rank` is 1..n by strength of fit and evidence (upstream score total is a useful guide, not a rule). Do not output scores.
- If fewer than 5 candidates are supportable, fill the remainder with items where `insufficient_evidence: true` stating what is missing, rather than inventing brands.
- Brand value or audience claims that are not in the evidence belong in `explanation` as inference or not at all.
