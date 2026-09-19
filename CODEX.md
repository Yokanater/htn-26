# Codex implementation entry point

Codex discovers repository instructions through `AGENTS.md`; this file is a human-facing launch
guide, not a replacement automatic configuration file. No global Codex settings are required.

1. Open the repository or assigned worktree root containing `package.json`, not `.git`.
2. Read `AGENTS.md` and [the shared playbook](docs/AGENT_IMPLEMENTATION_GUIDE.md).
3. Select the explicitly assigned active S-card, check prerequisite contracts and local changes,
   and record the starting commit for the card-only diff.
4. Implement with fake/recorded providers, both domains, and the card's actual acceptance tests.
5. Report what exists, what is still mocked, measured checks and the pending human verification.

Use the copy/paste card prompt in [the dispatch guide](docs/AGENT_DISPATCH.md). Do not automatically
spawn more agents, create app tasks, change dependencies, run live provider calls, or push branches
unless that work is authorized. The presence of four lanes is not an instruction to launch them.

Codex assist entries go in `docs/CODEX_LOG.md` through its owner; provide a row in the handoff when
that file is outside your card scope. Preserve current user instructions through compaction and
re-read the current branch diff rather than treating old plans as new work.

Reference: [official instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
