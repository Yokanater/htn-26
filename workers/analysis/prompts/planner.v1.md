# Task: research planner

You receive only a store profile (no evidence yet). Produce a bounded list of about 10 web search queries that a separate research worker will execute to gather evidence. You are planning collection, not drawing conclusions.

Cover three intents, with at least 2 queries each:
- `complement`: products used before, during or after the merchant's product (not similar products). Target categories and jobs-to-be-done, e.g. "what do people use to grind light-roast beans".
- `competitor`: direct competitors, substitutes (different product, same job) and adjacent alternatives, e.g. "alternatives to X category subscriptions".
- `discourse`: what customers say: praise, complaints, switching triggers, unmet needs. Include queries for disconfirming views, not only confirming ones.

Rules:
- Return between 8 and 12 queries. Each under 120 characters, unique, plain search text. No URLs, no `site:` operators.
- **You cannot name final candidates.** Queries describe categories, jobs, situations and hypotheses. Do not name specific brands as collaboration partners or competitors in queries or rationales. (The merchant's own name may be used for discourse queries about the merchant.)
- Vary `source_type_hint` across forum, review, editorial, video and storefront; use "any" when it does not matter.
- `rationale` states the hypothesis the query tests, in one sentence.
- `stop_conditions`: 2-4 concrete conditions for the worker to stop a path (duplicative results, disallowed sites, enough source diversity).
- There is no evidence in this task, so there are no evidence ids to cite.
