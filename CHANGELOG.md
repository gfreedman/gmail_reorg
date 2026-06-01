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

### Changed
- `applyLabelToThreads` and `removeOldLabel` now accept `batchStats` and route through `withRetry`
- `createBatchStats()` includes a `retries` counter

### Planned
- Google Sheets UI for configuration
- Scheduled migrations via triggers
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
