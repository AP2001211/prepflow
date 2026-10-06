# PrepFlow

[Live app: prepflow.app.space](https://prepflow.app.space)

PrepFlow is an interview-preparation focus system built with DeepSpace. It connects preparation direction with daily decisions and actual work, rather than stopping at a list of interviews and tasks. A user can decide what matters, choose a manageable set of activities, focus on one activity, and preserve enough context to return intentionally.

## The core loop

```text
Prep Areas / Interviews
        ↓
Prep Plans — durable strategic preparation context
        ↓
Daily Plans — executable work for a calendar date
        ↓
Focus — execute one activity
        ↓
Complete / Stop / Switch / Report Difficulty
        ↓
Observed work context can inform later Daily AI planning
```

Prep Areas are reusable preparation categories. Interviews supply company, role, timing, stage, and user-entered context. A Prep Plan belongs to an Interview or a lightweight preparation goal and identifies a short strategic direction and relevant areas. It is not a roadmap, schedule, or collection of executable tasks.

A Daily Plan answers “What do I intend to work on on this date?” Users can review AI suggestions, select the activities they want, and add more work later as their preparation changes.

Focus reduces choices to one activity, its execution instructions, previous continuation context, and a notebook. Long-running sessions can trigger a lightweight check-in so PrepFlow can distinguish continued work from stopping or switching. Complete finishes the activity, while Stop and Switch preserve unfinished work and continuation context for a later attempt. Resume refers to the exact work item’s prior Focus history. Report Difficulty records observed friction during an interval; it is not a failure label, mastery score, or automatic scheduling command.

## Finding your way around

- **Home:** orientation and the next useful action, including current Focus, today’s plan, unfinished work to pick back up, and upcoming interviews.
- **Plans:** calendar navigation and executable work for the selected date, plus global unfinished work.
- **My Prep:** strategic Prep Plans and reusable Prep Areas.
- **Interviews:** Interview records and creation.
- **History:** a protected direct reader at `/history` for recent ended Focus intervals and their notes; it is not primary navigation or an analytics dashboard.

## DeepSpace capabilities

PrepFlow uses four distinct DeepSpace platform capabilities:

| Capability | Product role |
| --- | --- |
| Authentication | A private, authenticated preparation workspace, with verified identity at mutation and AI boundaries. |
| Records / RecordRoom, realtime synchronization, and ownership permissions | Persistent Prep Areas, Interviews, Prep Plans, Daily Plans, Plan Items, and Focus sessions, with subscribed views updating as records change. |
| Server Actions | Authoritative domain operations such as starting and ending Focus, saving continuation context, and accepting Daily recommendations. |
| Managed AI | Separate strategic Prep Plan generation and contextual Daily activity generation, followed by explicit user review. |

The implementation lives primarily in `worker.ts`, `src/schemas/`, `src/actions/`, `src/server/`, and `src/ai/`. Scaffold bindings without a corresponding product flow are not counted as integrations.

## AI and persistence boundaries

Prep Plan AI uses the selected Interview or preparation goal and existing Prep Areas to propose a concise title, short strategic summary, and relevant areas. Optional suggested area names are unsaved proposal metadata. Creating one requires explicit user confirmation; saving the Prep Plan is a separate action. Users can edit proposals, regenerate before saving, or continue manually.

Daily AI considers relevant preparation strategy alongside open work, recent Focus and completion evidence, Interviews, availability, the target date, and the user’s current priority and time budget. Strategy and difficulty inform judgment; neither commands the planner to repeat work or cover every area.

Generation itself writes nothing. Suggestions are persisted only after explicit acceptance, with retry-safe handling to avoid duplicating work or Plan membership. Existing work is reused rather than recreated.

Future planning keeps the target date separate from the actual observation time. `availableFrom` governs automatic planner eligibility; it does not prohibit deliberately visiting and starting future work early.

Managed AI depends on available DeepSpace AI credits and model availability. If generation is unavailable, saved work remains usable, Prep Plans can be created manually, and generation can be retried without changing saved data.

## Scope and tradeoffs

The five-day scope prioritized a finished preparation-to-execution loop over feature count. Prep Plans remain strategic instead of introducing milestones or a curriculum engine. Focus stays narrow instead of becoming another dashboard. Difficulty and switching are contextual evidence rather than scores assigned to the user.

Collaboration, analytics, and additional integrations were omitted because they did not materially improve this core loop. Historical undated executable Plan records retain quiet read compatibility; they are not automatically converted into strategic Prep Plans.

## What I’d explore next

A natural next step is lightweight accountability partners or shared Focus sessions. DeepSpace’s realtime primitives make that technically natural, but I deliberately kept the five-day submission centered on making the single-user preparation and execution loop coherent first.

## Implementation and verification

A coding agent assisted with implementation, targeted repository audits, regression tests, and debugging. I made the product and scope decisions, directed the agent’s work, performed manual QA, and verified the final production deployment.

Manual verification exercised Home, My Prep, Interviews, Plans, Focus, Stop/Resume, Switch, Complete, History, authentication, and refresh persistence. Automated coverage includes deterministic unit/component tests and browser/API tests for ownership, planning acceptance and recovery, date behavior, session persistence, and review/save boundaries. AI tests use deterministic mocks rather than live model requests.

## Local development

Use Node.js matching `package.json` (`22.15+` within Node 22, Node 24, or Node 26) and npm `11.6+`.

```sh
npm ci
npm run login
npm run dev
```

`login` authenticates the DeepSpace CLI; `dev` starts the DeepSpace local development environment. Use an account authorized for this app’s existing DeepSpace identity. Follow the URL printed by the development command and sign in to access private product routes. Secrets belong in the DeepSpace secrets store; local `.dev.vars` is ignored and is not the deployment secrets source.

Available validation commands:

```sh
npm run type-check
npm run lint
npm run test:unit
npm run test:smoke
npm run test:api
npm run test:e2e
npm run build
```

`npm run validate` combines TypeScript checking and deterministic tests. Browser/API commands use the DeepSpace test runner. Production deployment uses `npm run deploy`; local development records do not automatically seed the deployed app.