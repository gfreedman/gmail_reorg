# Changelog

All notable changes to the Gmail Reorganization Library will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Transient-error retry helper** (`withRetry`, `isTransientError` in `utils.gs`)
  - Exponential backoff with jitter for 503/500/429/rate-limit/timeout errors
  - Time-budget aware: aborts a retry instead of pushing past `MAX_RUNTIME_MS`
  - `onRetry` callback hook for telemetry; isolates callback failures from request flow
  - New `CONFIG.MAX_RETRIES` (default 4) and `CONFIG.RETRY_BASE_DELAY_MS` (default 1000) knobs
- **Retry telemetry** surfaced in batch summary as `Transient errors retried: N`
- Test suite `testRetryHelpers` in `tests.gs` covering classification, success/failure paths, budget enforcement, and telemetry
- **`reorg_toolkit.gs`** — Web App toolkit for one-off maintenance sweeps, exposed through a `doGet` router. Every mutating route is dry-run by default and takes `&apply=1`, and all of them are idempotent, checkpointed and time-budgeted
- **Injectable Gmail gateway** (`_GW`, `_dep_`, `_depGw_`) so the mutating routes can be tested against a fake without touching a mailbox. `_depGw_` throws if a caller supplies `deps` without a gateway, rather than silently falling through to live Gmail
- **Static filter-conflict detection** — Gmail runs every matching filter, so overlapping criteria double-label. `_specConflicts_` catches that before anything is written and aborts an `&apply=1` run
- **Hand-edit protection** — `rebuildfilters` never overwrites a filter someone edited by hand; `&force=1` overrides
- Test suites `testFilterSpec` and `testMutatingPaths` in `tests.gs` (40 cases), using injected fixtures so they run without the private configuration file
- `test/mutation_test.js` — mutation runner that breaks one guard at a time and asserts a test catches it
- `?fn=selftest` route to run the whole suite over HTTP
- `.claspignore` to keep `test/` out of the Apps Script push
- **Web App authentication** — every route requires a shared secret held in the `WEBAPP_TOKEN` Script Property. Fails closed: with no token configured every route is refused rather than left open. Constant-time comparison; denials return a bare `DENIED` that echoes neither route nor reason
- **`admin.gs`** — the functions you run by hand (`setWebAppToken`, `authorize`, `installMaintenanceTrigger`, `removeMaintenanceTrigger`), separated out because the Apps Script Run menu only lists functions from the selected file
- **Scheduled maintenance** — `runMaintenance` labels inbox threads carrying no plan label, on a daily time-based trigger. Runs inside the project, so it needs no token and no machine awake. Labels only; never archives or trashes. Installing the trigger twice replaces rather than stacks
- **`SECURITY.md`** describing the two layers, the token model, rotation, and what the toolkit can reach
- CI (`.github/workflows/tests.yml`) running the unit and mutation suites on push and pull request

### Changed
- `applyLabelToThreads` and `removeOldLabel` now accept `batchStats` and route through `withRetry`
- `createBatchStats()` includes a `retries` counter
- Toolkit configuration (sender rules, label taxonomy, thread IDs) is separated into a git-ignored `_private_data.gs`, so the logic is reviewable. A missing configuration file raises rather than degrading into an empty run
- `reorg_toolkit.gs` converted to the house style: Allman braces, no single-line blocks, JSDoc on every function
- Repeated literals replaced with named constants (`_PAGE_SIZE`, `_DRAIN_MAX_PASSES`, the runtime budgets). `MAX_RUNTIME` had been declared 10 times at three different values while `CONFIG.MAX_RUNTIME_MS` already existed

### Fixed
- **`backup_` silently reported success after a failed read.** A swallowed exception left the thread list empty, which is indistinguishable from a label that genuinely has no threads, and the run still printed `BACKUP COMPLETE`. Failed labels are now marked `READ FAILED` and the run refuses to claim success
- **`_safeCall` made the retry knobs inert.** It passed hardcoded values to `withRetry`, so `CONFIG.MAX_RETRIES` and `CONFIG.RETRY_BASE_DELAY_MS` had no effect on any toolkit route
- **Web App tokens were minted with `Math.random()`**, a non-cryptographic PRNG whose state is recoverable from its outputs. Now built from `Utilities.getUuid()`, which is `SecureRandom`-backed
- **Maps keyed on message headers used plain object literals.** A sender whose domain is `__proto__` corrupted the tally; twelve such maps now use `Object.create(null)`
- Stack traces are no longer returned to Web App callers; they go to the execution log

### Planned
- Google Sheets UI for configuration
- Email notification on completion
- Formal undo/rollback command (reverse migrations are already supported manually)
- Import/export migration plans

## [1.0.0] - 2026-01-24

### Added
- **Backup System**
  - `createBackup()` - Full email inventory to Google Spreadsheet
  - `createLabelSummary()` - Quick label statistics
  - `backupUnreadEmails()` - Backup only unread emails
  - `backupDateRange()` - Backup specific date range

- **Analysis Engine**
  - `analyzeLabelStructure()` - Comprehensive label analysis
  - Category detection (work, finance, personal, shopping, travel, learning, newsletters)
  - Duplicate label detection
  - Consolidation suggestions
  - `visualizeLabelHierarchy()` - Tree view of labels
  - `generateMigrationTemplate()` - Auto-generate migration plans
  - `quickStats()` - Fast overview

- **Migration System**
  - `main()` - Execute migrations with auto-resume
  - Batch processing to handle large mailboxes
  - State persistence using PropertiesService
  - `validatePlan()` - Pre-flight validation
  - `previewMigrations()` - Preview without executing
  - `showProgress()` - Track migration progress
  - `resetMigrations()` - Start fresh

- **Safety Features**
  - Dry run mode (enabled by default)
  - Comprehensive validation before execution
  - Automatic timeout handling (5-minute batches)
  - Resume capability for interrupted migrations
  - Statistics tracking

- **Utilities**
  - Centralized `getAllThreadsFromLabel()` function
  - Logging with timestamps and levels
  - `deleteEmptyLabels()` with dry run support
  - `findDuplicateLabels()`
  - `exportLabelStructure()` to JSON
  - Label name validation

- **Documentation**
  - Comprehensive README with usage guide
  - Example organization plans (Minimal, Standard, GTD, Business)
  - Troubleshooting guide
  - Contributing guidelines

### Security
- No personal data in codebase
- All processing happens in user's Google account
- No external data transmission
