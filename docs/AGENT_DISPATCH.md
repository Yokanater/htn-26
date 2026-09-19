# Dispatching Claude or Codex

Use the same task contract for either agent. Start the session in a prepared worktree rooted at
the current integrated bootstrap. Check [status](BOOTSTRAP_STATUS.md), [team split](TEAM_WORK_SPLIT.md)
and [milestones](milestones/README.md) before assigning work. Do not dispatch archived M-cards.

## First assignments

| Lane | First useful card | Can proceed offline | Human prerequisite for live completion |
| --- | --- | --- | --- |
| L1 | S1-L1-1 media UI, then S2-L1-1 catalog adapter | media UI and recorded-shape parser tests | decoder integration; real catalog records from both domains |
| L2 | S2-L2-1 constrained collection engine | yes, both-domain fixtures already exist | relevance/coherence review, optional Baseten spike |
| L3 | S1-L3-1 intent interpreter/editor | fake outputs + editor and text flow | vision response recording on one image per domain |
| L4 | S1-L4-1 session/assets/brief API and shell | fake interpreter + owner/revision tests | installed decoder validation, deploy/session review |

L2 is intentionally working on S2 while others complete S1. L1 may prepare S4 profiling during S3.
L4 builds the merchant UI from fixtures while L2/L3 finish opportunity services. Avoid two tasks on
the same Edit paths; respect explicit dependencies even when agents could write the code quickly.

## Copy/paste implementation prompt

```text
Implement card <CARD-ID> from docs/milestones/<ACTIVE-CARD-FILE>.md.
Read AGENTS.md and docs/AGENT_IMPLEMENTATION_GUIDE.md, then the card's cited design sections.
You are in the assigned worktree on <BRANCH>; record current HEAD as the card baseline.
Inspect existing changes first and preserve them. Edit only the card's Edit paths.
Use current @sei/contracts and @sei/core exports; implement both outfit and setup behavior.
Use fake/recorded provider responses only. No live API calls or dependency-file changes.
If a shared contract is missing, describe the smallest additive contract change for its owner;
continue independent work against an injected fake instead of inventing a private DTO.
Run the card's tests, pnpm typecheck, relevant fixture/integration checks, pnpm format and
pnpm format:check. A missing milestone test is a failure, not a successful check.
Return the playbook handoff with exact command results, remaining mocks and human checks.
Do not commit/push unless the assignment explicitly authorizes it.
```

## Copy/paste review prompt

```text
Review <CARD-ID> against <BASE-SHA> without editing implementation files.
Read the active card, design sections and current contracts. Check both domains, effective flags,
owner/revision boundaries, product constraints, private-data leakage and provenance as applicable.
Inspect whether tests prove behavior rather than simply reproduce fixtures. Cite exact file/line
and concrete failure scenarios. Distinguish confirmed defects from questions requiring a human spike.
Do not run live providers or treat archived evaluation scores as current validation.
```

## Copy/paste integration prompt

```text
Integrate the completed cards for <S-MILESTONE> in the assigned integration checkout.
Inspect the card handoffs and actual changes. Wire existing exports through the composition root;
do not rewrite another lane's implementation or change package boundaries to resolve a mismatch.
Verify fake-backed end-to-end flows in both domains, plus timeout/revision/provenance failures.
Run the named non-vacuous milestone suite, pnpm test, pnpm fixtures:check, pnpm typecheck,
pnpm format and pnpm format:check. Report pending live human checks separately.
Only report the milestone green after those human results are supplied and reviewed.
```

Keep one source of rules: edit AGENTS.md/playbook rather than duplicating them into tool-specific
settings. `CLAUDE.md` imports the shared rules; Codex uses `AGENTS.md`. `CODEX.md` explains launch
behavior but is not assumed to be automatically loaded. No unrequested global settings changes.
