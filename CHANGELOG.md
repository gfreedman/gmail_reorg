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
- **Web App authentication** - every route requires a shared secret in the `WEBAPP_TOKEN` Script Property. Fails closed: with no token set, every route is refused. Constant-time comparison, and denials return a bare `DENIED`
- **`admin.gs`** - the hand-run functions (`setWebAppToken`, `authorize`, `installMaintenanceTrigger`, `removeMaintenanceTrigger`), split out because the Run menu only lists the selected file
- **Scheduled maintenance** - `runMaintenance` labels inbox threads carrying no plan label, on a daily trigger. Runs inside the project, so it needs no token and no machine left awake. Labels only. Installing twice replaces the trigger
- **`SECURITY.md`** - the two layers, the token model, rotation, and what the toolkit can reach
- **CI** - `.github/workflows/tests.yml` runs the unit and mutation suites on push and pull request

### Changed
- `applyLabelToThreads` and `removeOldLabel` now accept `batchStats` and route through `withRetry`
- `createBatchStats()` includes a `retries` counter
- Toolkit configuration (sender rules, label taxonomy, thread IDs) is separated into a git-ignored `_private_data.gs`, so the logic is reviewable. A missing configuration file raises rather than degrading into an empty run
- `reorg_toolkit.gs` converted to the house style: Allman braces, no single-line blocks, JSDoc on every function
- Repeated literals replaced with named constants (`_PAGE_SIZE`, `_DRAIN_MAX_PASSES`, the runtime budgets). `MAX_RUNTIME` had been declared 10 times at three different values while `CONFIG.MAX_RUNTIME_MS` already existed

### Fixed
- **Silent backup failure** - a swallowed exception left the thread list empty, which reads the same as a label with no threads, and the run still printed `BACKUP COMPLETE`. Failed labels are now marked `READ FAILED` and the run reports itself incomplete
- **Inert retry settings** - `_safeCall` passed hardcoded values to `withRetry`, so `CONFIG.MAX_RETRIES` and `CONFIG.RETRY_BASE_DELAY_MS` had no effect on any toolkit route
- **Weak token generation** - Web App tokens came from `Math.random()`, whose state is recoverable from its outputs. Now built from `Utilities.getUuid()`, backed by `SecureRandom`
- **Prototype pollution in tallies** - a sender whose domain is `__proto__` corrupted counts keyed on message headers. Twelve such maps now use `Object.create(null)`
- **Stack traces in HTTP responses** - these now go to the execution log instead

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
