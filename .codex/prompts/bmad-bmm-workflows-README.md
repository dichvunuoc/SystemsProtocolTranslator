# BMM Workflows

## Available Workflows in bmm

**create-product-brief**
- Path: `undefined`
- Create comprehensive product briefs through collaborative step-by-step discovery as creative Business Analyst working with the user as peers.

**research**
- Path: `undefined`
- Conduct comprehensive research across multiple domains using current web data and verified sources - Market, Technical, Domain and other research types.

**create-ux-design**
- Path: `undefined`
- Work with a peer UX Design expert to plan your applications UX patterns, look and feel.

**prd**
- Path: `undefined`
- PRD tri-modal workflow - Create, Validate, or Edit comprehensive PRDs

**check-implementation-readiness**
- Path: `undefined`
- Critical validation workflow that assesses PRD, Architecture, and Epics & Stories for completeness and alignment before implementation. Uses adversarial review approach to find gaps and issues.

**create-architecture**
- Path: `undefined`
- Collaborative architectural decision facilitation for AI-agent consistency. Replaces template-driven architecture with intelligent, adaptive conversation that produces a decision-focused architecture document optimized for preventing agent conflicts.

**create-epics-and-stories**
- Path: `undefined`
- Transform PRD requirements and Architecture decisions into comprehensive stories organized by user value. This workflow requires completed PRD + Architecture documents (UX recommended if UI exists) and breaks down requirements into implementation-ready epics and user stories that incorporate all available technical and design context. Creates detailed, actionable stories with complete acceptance criteria for development teams.

**code-review**
- Path: `undefined`
- Perform an ADVERSARIAL Senior Developer code review that finds 3-10 specific problems in every story. Challenges everything: code quality, test coverage, architecture compliance, security, performance. NEVER accepts `looks good` - must find minimum issues and can auto-fix with user approval.

**correct-course**
- Path: `undefined`
- Navigate significant changes during sprint execution by analyzing impact, proposing solutions, and routing for implementation

**create-story**
- Path: `undefined`
- Create the next user story from epics+stories with enhanced context analysis and direct ready-for-dev marking

**dev-story**
- Path: `undefined`
- Execute a story by implementing tasks/subtasks, writing tests, validating, and updating the story file per acceptance criteria

**retrospective**
- Path: `undefined`
- Run after epic completion to review overall success, extract lessons learned, and explore if new information emerged that might impact the next epic

**sprint-planning**
- Path: `undefined`
- Generate and manage the sprint status tracking file for Phase 4 implementation, extracting all epics and stories from epic files and tracking their status through the development lifecycle

**sprint-status**
- Path: `undefined`
- Summarize sprint-status.yaml, surface risks, and route to the right implementation workflow.

**beads-sync**
- Path: `undefined`
- Sync BMAD epics, stories, and tasks to Beads issue tracker for enhanced context management and recovery

**quick-dev**
- Path: `undefined`
- Flexible development - execute tech-specs OR direct instructions with optional planning.

**quick-spec**
- Path: `undefined`
- Conversational spec engineering - ask questions, investigate code, produce implementation-ready tech-spec.

**document-project**
- Path: `undefined`
- Analyzes and documents brownfield projects by scanning codebase, architecture, and patterns to create comprehensive reference documentation for AI-assisted development

**create-excalidraw-dataflow**
- Path: `undefined`
- Create data flow diagrams (DFD) in Excalidraw format

**create-excalidraw-diagram**
- Path: `undefined`
- Create system architecture diagrams, ERDs, UML diagrams, or general technical diagrams in Excalidraw format

**create-excalidraw-flowchart**
- Path: `undefined`
- Create a flowchart visualization in Excalidraw format for processes, pipelines, or logic flows

**create-excalidraw-wireframe**
- Path: `undefined`
- Create website or app wireframes in Excalidraw format

**generate-project-context**
- Path: `undefined`
- Creates a concise project-context.md file with critical rules and patterns that AI agents must follow when implementing code. Optimized for LLM context efficiency.

**testarch-atdd**
- Path: `undefined`
- Generate failing acceptance tests before implementation using TDD red-green-refactor cycle

**testarch-automate**
- Path: `undefined`
- Expand test automation coverage after implementation or analyze existing codebase to generate comprehensive test suite

**testarch-ci**
- Path: `undefined`
- Scaffold CI/CD quality pipeline with test execution, burn-in loops, and artifact collection

**testarch-framework**
- Path: `undefined`
- Initialize production-ready test framework architecture (Playwright or Cypress) with fixtures, helpers, and configuration

**testarch-nfr**
- Path: `undefined`
- Assess non-functional requirements (performance, security, reliability, maintainability) before release with evidence-based validation

**testarch-test-design**
- Path: `undefined`
- Dual-mode workflow: (1) System-level testability review in Solutioning phase, or (2) Epic-level test planning in Implementation phase. Auto-detects mode based on project phase.

**testarch-test-review**
- Path: `undefined`
- Review test quality using comprehensive knowledge base and best practices validation

**testarch-trace**
- Path: `undefined`
- Generate requirements-to-tests traceability matrix, analyze coverage, and make quality gate decision (PASS/CONCERNS/FAIL/WAIVED)

**workflow-init**
- Path: `undefined`
- Initialize a new BMM project by determining level, type, and creating workflow path

**workflow-status**
- Path: `undefined`
- Lightweight status checker - answers ""what should I do now?"" for any agent. Reads YAML status file for workflow tracking. Use workflow-init for new projects.


## Execution

When running any workflow:
1. LOAD {project-root}/_bmad/core/tasks/workflow.xml
2. Pass the workflow path as 'workflow-config' parameter
3. Follow workflow.xml instructions EXACTLY
4. Save outputs after EACH section

## Modes
- Normal: Full interaction
- #yolo: Skip optional steps
