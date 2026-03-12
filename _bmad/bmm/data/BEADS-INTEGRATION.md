# Beads Integration with BMAD-METHOD

## Overview

**Beads** is a lightweight, git-based issue tracker designed for AI coding agents. When integrated with BMAD-METHOD, it provides:

- **Fast context queries** - `bd ready --json` instead of reading entire files
- **Progress tracking** - Notes that survive context compaction
- **Dependency management** - Auto-blocks tasks waiting on dependencies
- **Context recovery** - Recover state after compact or new session

This integration is **Beads-primary**:
- Beads is the source of truth
- BMAD files are derived artifacts for full-spec reading
- Conflicts resolve in favor of Beads
- **Status is canonical in Beads**; update status in Beads first, then sync BMAD status fields (`sprint-status.yaml` and story Status)

## How BMAD + Beads Work Together (Beads-Primary)

```
┌─────────────────────────────────────────────────────────┐
│               BEADS-PRIMARY MODE                          │
│                                                          │
│   Beads (Source of Truth)     BMAD (Derived Files)      │
│   ─────────────────────       ─────────────────         │
│   • Epic issues            →  • Epic .md files          │
│   • Story issues           →  • Story .md files         │
│   • Task issues + notes    →  • Task checkboxes         │
│   • bd ready/bd show       →  • sprint-status.yaml      │
│                                                          │
│   Human reads: BMAD files (full context)                │
│   Agent queries/updates: Beads (fast, filtered)         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Install Beads CLI

```bash
curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash
```

### 2. Initialize in Project

```bash
cd your-project
bd init --prefix <project-prefix>
```

**Important:** Use a short prefix (2-5 chars) derived from the repo name (e.g., `cdx-auth-api` → `cdx`) for readable IDs like `cdx-a1b2`.
If the default prefix is not desired, override it once at init time.

### 3. Sync BMAD to Beads

Run the Beads Sync workflow for initial import, then treat Beads as primary:

```bash
# Create epic
bd create "Epic 1: User Authentication" -t epic -p 1
# → bmad-e1a2

# Create stories under epic
bd create "Story 1.1: Login API" -t feature -p 1 --parent bmad-e1a2
# → bmad-e1a2.1

# Set dependencies
bd dep add bmad-e1a2.2 bmad-e1a2.1  # Story 2 depends on Story 1
```

## Agent Workflow with Beads

### Starting Work

```bash
# Query ready tasks (much faster than reading files)
bd ready --json
# Output: [{"id":"bmad-e1a2.1","title":"Login API","priority":1}]

# Claim task
bd update bmad-e1a2.1 --status in_progress
```

### Context First (Beads-First)

Use Beads as the primary context source, then open the story file only for tracking:

```bash
# Load issue context (description + notes)
bd show bmad-e1a2.1

# Optional: prime workflow context (1-2k tokens)
bd prime
```

### During Implementation

```bash
# Update progress notes (critical for context recovery!)
bd update bmad-e1a2.1 --notes "
BMAD_FILE: _bmad-output/implementation-artifacts/1-1-login-api.md
COMPLETED:
- OAuth config done
- Login endpoint created

IN_PROGRESS:
- Writing unit tests

NEXT:
- Error handling
- GitHub OAuth

FILES_CHANGED:
- src/auth/login.ts (new)
- src/auth/oauth.ts (new)

KEY_DECISIONS:
- Using PKCE flow for security
"
```

### Completing Task

```bash
# Close in Beads
bd close bmad-e1a2.1 --reason "All tests passing, ready for review"

# Update BMAD story file from Beads notes if needed
```

## Story Header Metadata

Add a Beads ID to the story header to enable fast two-way sync:

```
Beads ID: bmad-xxxx
```

When present, workflows should use this ID instead of scanning `bd list`.

## Context Recovery (After Compact)

When context is lost:

```bash
# 1. Find in-progress work
bd list --status in_progress --json
# → [{"id":"bmad-e1a2.1","status":"in_progress"}]

# 2. Get full context
bd show bmad-e1a2.1
# → Shows title, status, notes (with COMPLETED, IN_PROGRESS, etc.)

# 3. Load BMAD file from notes
# Read BMAD_FILE path from notes
# Continue from IN_PROGRESS items
```

## Writing Effective Notes

Notes are **letters to your future self (or another agent)**. Include:

| Section | Purpose | Example |
|---------|---------|---------|
| `BMAD_FILE` | Link to BMAD story | `_bmad-output/impl/1-1-login.md` |
| `COMPLETED` | What's done | `- OAuth configured` |
| `IN_PROGRESS` | Current work | `- Writing login tests` |
| `NEXT` | What comes after | `- Add GitHub OAuth` |
| `FILES_CHANGED` | Modified files | `- src/auth/login.ts (new)` |
| `KEY_DECISIONS` | Important choices | `- Using PKCE flow` |
| `BLOCKERS` | What's blocking | `- Need API keys` |

## BMAD Menu Commands

| Command | Trigger | Description |
|---------|---------|-------------|
| Beads Sync | `BS` or `beads-sync` | Sync BMAD artifacts to Beads |
| Beads Context | `BC` or `beads-context` | Recover context from Beads |

## Mapping: BMAD Status ↔ Beads Status

| BMAD Status | Beads Status | Notes |
|-------------|--------------|-------|
| backlog | open | P3-P4 priority |
| ready-for-dev | open | P1-P2 priority |
| in-progress | in_progress | Agent claimed |
| review | in_progress | Notes: "Under review" |
| done | closed | With completion reason |

## Dependency Examples

### Epic → Story → Task Hierarchy

```bash
# Epic
bd create "Auth System" -t epic -p 1
# → bmad-auth

# Stories (auto-suffix .1, .2)
bd create "Login API" --parent bmad-auth
# → bmad-auth.1

bd create "JWT Middleware" --parent bmad-auth
# → bmad-auth.2

# Story dependency
bd dep add bmad-auth.2 bmad-auth.1  # JWT needs Login first
```

### Task Dependencies

```bash
# Tasks under story
bd create "Setup OAuth" --parent bmad-auth.1
# → bmad-auth.1.1

bd create "Create endpoint" --parent bmad-auth.1
# → bmad-auth.1.2

bd dep add bmad-auth.1.2 bmad-auth.1.1  # endpoint needs OAuth first
```

### Query Ready Work

```bash
bd ready --json
# Only returns tasks with ALL dependencies satisfied
# Won't show bmad-auth.1.2 until bmad-auth.1.1 is closed
```

## Best Practices

### DO

- Use Beads for all updates, BMAD files for full requirements
- Write detailed notes BEFORE context might compact
- Update BMAD from Beads (not the other way around)
- If a story file is edited after `create-story`, re-sync the Beads issue body (`bd update {story-id} --body-file {story_file}` or run `beads-sync`)
- Use short prefix when initializing (e.g., `cdx`, not full repo name)

### DON'T

- Don't rely on BMAD files as source of truth
- Don't skip writing notes - they're critical for context recovery
- Don't use long prefixes - IDs become unreadable

## Conflict Policy (Beads Wins)

If BMAD and Beads drift:
1. `bd show [issue-id]`
2. Update the linked BMAD file (see `BMAD_FILE` in notes)
3. Re-run Beads Sync workflow to reconcile artifacts

## Troubleshooting

### Beads Daemon (Optional)

If you are using Beads in daemon mode and commands feel slow or stale, check that the daemon is running and restart it per Beads docs.

### "bd: command not found"

```bash
curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash
```

### "No .beads directory"

```bash
bd init --prefix <project-prefix>
```

### "Prefix too long"

```bash
bd rename-prefix <project-prefix> --dry-run  # Preview
bd rename-prefix <project-prefix>            # Apply
```

### "Beads and BMAD out of sync"

Run Beads Sync workflow (`BS` command) to reconcile.

## Health Check (Drift Detection)

Use a quick check to detect drift between Beads and BMAD artifacts:

1. `bd list --status in_progress --json` (current working issues)
2. `bd show [id]` (confirm body + notes)
3. Open the story file from `BMAD_FILE` and compare:
   - Status field
   - Tasks/Subtasks completion
   - File List
4. If mismatched, update Beads first, then re-run `beads-sync`

## Resources

- [Beads GitHub](https://github.com/steveyegge/beads)
- [Beads UI](https://github.com/mantoni/beads-ui) - Visual board view
- [Beads FAQ](https://github.com/steveyegge/beads/blob/main/docs/FAQ.md)
