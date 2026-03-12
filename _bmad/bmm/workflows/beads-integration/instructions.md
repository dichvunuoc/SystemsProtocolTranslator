# Beads Integration Workflow Instructions

## Purpose

This workflow syncs BMAD artifacts (epics, stories, tasks) to Beads issue tracker, enabling:
- **Fast context queries** via `bd ready --json` instead of reading entire files
- **Progress tracking** with detailed notes that survive context compaction
- **Dependency management** that automatically blocks/unblocks tasks
- **Multi-agent coordination** without file conflicts

## Source of Truth (Beads-Primary)

This integration treats **Beads as the source of truth**. BMAD files are derived artifacts for full-spec reading and checklists.

- **Primary edits happen in Beads** (status, dependencies, notes).
- **BMAD files are updated from Beads** when drift is detected.
- **Conflict policy**: Beads wins, BMAD is corrected.

## Prerequisites

1. **Beads CLI installed**: `bd --version` should work
2. **Beads initialized**: `.beads/` directory exists or will be created
3. **Optional (daemon mode)**: If you use Beads daemon mode and commands feel stale, start the daemon per Beads docs

## Workflow Steps

### Step 1: Initialize Beads (if needed)

Check if Beads is already initialized:

```bash
bd where
```

If not initialized, choose a short **project-specific prefix** (2-5 chars) derived from the repo name, and allow a user override:

```bash
# Default: take the first segment of the repo name (e.g., cdx-auth-api -> cdx)
bd init --prefix <project-prefix>
```

> **IMPORTANT**: Use a short prefix (2-5 chars) to keep issue IDs readable (e.g., `cdx-a1b2`).
> If the default prefix is not desired, prompt the user to override it once at init time.

### Step 2: Sync Epics from Planning Artifacts

For each epic file in `{planning_artifacts}/epic*.md`:

1. **Read epic metadata** (title, description, stories list)
2. **Create or update Beads epic**:

```bash
# Create new epic
bd create "Epic: [Epic Title]" -t epic -p 1

# Or update existing epic notes
bd update [epic-id] --notes "
BMAD_FILE: {planning_artifacts}/epic-1.md
STORIES: 1-1, 1-2, 1-3
STATUS: [current status]
"
```

### Step 3: Sync Stories from Implementation Artifacts

For each story file in `{implementation_artifacts}/*.md`:

1. **Extract story metadata**:
   - Story key (e.g., `1-2-user-authentication`)
   - Status (backlog, ready-for-dev, in-progress, review, done)
   - Tasks with checkboxes

2. **Create Beads issue for story**:

```bash
bd create "Story [key]: [title]" -t feature -p [priority] --parent [epic-id]
```

3. **Set story status**:

| BMAD Status | Beads Status |
|-------------|--------------|
| backlog | open |
| ready-for-dev | open (priority raised) |
| in-progress | in_progress |
| review | in_progress (notes: "Under review") |
| done | closed |

```bash
bd update [story-id] --status [beads-status]
```

### Step 3b: Map Dependencies from sprint-status.yaml (if present)

If `{implementation_artifacts}/sprint-status.yaml` exists, use the **order of stories** in `development_status` to set dependencies:

1. Group stories by epic (e.g., `7-1-*`, `7-2-*`, `7-3-*`)
2. For each epic, add a dependency from each story to the previous story in that epic
3. Skip dependencies for the first story in each epic

```bash
# Example: story 7-2 depends on story 7-1
bd dep add [story-7-2-id] [story-7-1-id]
```

### Step 4: Sync Tasks from Story Files

For each task in story's "Tasks/Subtasks" section:

1. **Parse task**:
   - `[ ]` = open
   - `[x]` = closed

2. **Create Beads task**:

```bash
bd create "Task: [task description]" -t task -p [priority] --parent [story-id]
```

3. **Set dependencies** between tasks:

```bash
# If task 2 depends on task 1
bd dep add [task-2-id] [task-1-id]
```

### Step 5: Bidirectional Sync Strategy

#### Beads → BMAD (Primary)

When Beads issues change:
- Status changes → Update BMAD story status/checklists
- Notes updated → Reflect in BMAD story progress sections
- Dependencies updated → Update BMAD references

> If BMAD files drift, correct them using Beads data, not the other way around.

#### BMAD → Beads (Secondary / Initial Import)

Use BMAD → Beads only for:
- Initial import from existing BMAD artifacts
- Explicit manual correction when Beads data is missing

#### Beads → BMAD (Context Recovery)

When agent needs context after compact:

```bash
# 1. Check what's in progress
bd list --status in_progress --json

# 2. Get full context of current task
bd show [task-id]

# 3. Read notes to understand progress
# Notes contain: COMPLETED, IN_PROGRESS, NEXT, FILES_CHANGED
```

### Step 6: Writing Effective Notes (Critical!)

When updating task progress, write notes as **letters to future agent**:

```bash
bd update [task-id] --notes "
BMAD_FILE: {implementation_artifacts}/1-2-user-auth.md
COMPLETED:
- OAuth provider configured (Google)
- Login endpoint created at /api/auth/login
- JWT token generation working

IN_PROGRESS:
- Writing unit tests for login endpoint
- Test file: tests/auth/login.test.ts

NEXT:
- Complete error handling tests
- Add GitHub OAuth provider
- Update story file checkboxes

FILES_CHANGED:
- src/auth/oauth.ts (new)
- src/auth/login.ts (new)
- config/providers.json (modified)

KEY_DECISIONS:
- Using PKCE flow for security
- Token expiry set to 1 hour

BLOCKERS: None
"
```

### Step 7: Dependency Setup for BMAD Workflow

```
Epic
├── Story 1 (depends on: nothing)
│   ├── Task 1.1 (depends on: nothing)
│   ├── Task 1.2 (depends on: 1.1)
│   └── Task 1.3 (depends on: 1.1)
├── Story 2 (depends on: Story 1)
│   ├── Task 2.1 ...
```

```bash
# Story dependencies
bd dep add [story-2-id] [story-1-id]

# Task dependencies (within story)
bd dep add [task-1-2-id] [task-1-1-id]
bd dep add [task-1-3-id] [task-1-1-id]
```

## Integration Points

### 1. After Sprint Planning

Run this workflow to create Beads issues for all stories and tasks.

### 2. During Dev Story Workflow

Agent should:
1. `bd ready --json` to find next task
2. `bd update [id] --status in_progress` to claim task
3. `bd show [id]` to load primary context (issue body + notes)
4. Optional: `bd prime` to load workflow context (~1-2k tokens)
5. Write progress notes during implementation
6. `bd close [id] --reason "Done"` when complete

### 3. Before Context Compact

Ensure current progress is saved:

```bash
bd sync
git add .beads/
git commit -m "chore: sync beads progress"
```

### 4. After Context Compact

Agent can recover context:

```bash
# What was I working on?
bd list --status in_progress

# Full context of current task
bd show [task-id]
```

## Beads Commands Quick Reference

| Command | Purpose |
|---------|---------|
| `bd init --prefix <project-prefix>` | Initialize Beads |
| `bd create "title" -t type -p priority` | Create issue |
| `bd ready --json` | List ready tasks |
| `bd update ID --status STATUS` | Update status |
| `bd update ID --notes "..."` | Add notes |
| `bd dep add CHILD PARENT` | Set dependency |
| `bd close ID --reason "..."` | Close issue |
| `bd show ID` | View issue details |
| `bd sync` | Sync with git |

## Troubleshooting

### "BMAD and Beads drifted"

Policy: **Beads wins**. Use Beads issue data to update BMAD files.

Suggested manual fix:
1. `bd show [issue-id]`
2. Update the related BMAD file (from `BMAD_FILE` in notes)
3. Re-run Beads Sync workflow to align artifacts

### "bd: command not found"

Install Beads CLI:
```bash
curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash
```

### "No .beads directory"

Initialize Beads in project root:
```bash
cd {project-root}
bd init --prefix <project-prefix>
```

### "Prefix too long"

Rename prefix:
```bash
bd rename-prefix bmad --dry-run  # Preview
bd rename-prefix bmad            # Apply
```
