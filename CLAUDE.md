@AGENTS.md

# Claude Code entry point

Use the shared [implementation playbook](docs/AGENT_IMPLEMENTATION_GUIDE.md) before starting a card.
Read the assigned S1–S5 card and its cited design sections, then inspect the actual source and tests.
The bootstrap is a foundation, not an implemented shopper/merchant application.

Work in the repository/worktree root, never its `.git` directory. Confirm branch, worktree, base
commit and Edit paths before modifying files. Preserve other people's work. Do not import old
branch contracts, dependency files or full applications to save time.

At handoff, give the card ID, changed paths, exports/fixtures, actual check output, pending human
spikes and next integration step. Do not mark a milestone complete from preset/schema tests alone.
After compaction, recheck the handoff and git diff before continuing; do not repeat completed work.

`AGENTS.md` is the shared rule source. This file intentionally imports it rather than maintaining
another copy. [Claude's documented import mechanism](https://code.claude.com/docs/en/memory).
