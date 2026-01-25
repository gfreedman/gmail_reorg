# Gmail Reorganization Library

A Google Apps Script library for backing up, analyzing, and reorganizing Gmail labels into a clean structure. Safely migrate thousands of emails without data loss.

## Features

- **Backup**: Create spreadsheet inventories of all emails and labels
- **Analysis**: Analyze label chaos with smart category detection
- **Migration**: Safely reorganize labels with batch processing and auto-resume
- **No Data Loss**: Only moves labels, never deletes emails
- **Progress Tracking**: Resume interrupted migrations, track statistics

## Quick Start

### 1. Create the Project

1. Go to [Google Apps Script](https://script.google.com)
2. Click **New Project**
3. Name it "Gmail Reorganization"

### 2. Add the Script Files

Create these files in your project (File > New > Script):

| File | Purpose |
|------|---------|
| `utils.gs` | Core utilities (load first) |
| `backup.gs` | Backup functions |
| `analysis.gs` | Label analysis |
| `reorganization.gs` | Migration execution |

Copy the contents from this repository into each file.

**Important**: `utils.gs` must be the first file listed in your project.

### 3. Authorize the Script

1. Run any function (e.g., `quickStats`)
2. Click "Review Permissions"
3. Select your Google account
4. Click "Advanced" > "Go to Gmail Reorganization"
5. Click "Allow"

## Usage Guide

### Step 1: Backup Your Gmail (Recommended)

Before making any changes, create a backup:

```javascript
// Creates a spreadsheet with all your emails
createBackup();

// Or just get label statistics (faster)
createLabelSummary();
```

### Step 2: Analyze Your Labels

Understand your current label structure:

```javascript
// Full analysis with recommendations
analyzeLabelStructure();

// Quick stats overview
quickStats();

// Visual hierarchy tree
visualizeLabelHierarchy();
```

The analysis will:
- Show top labels by thread count
- Identify empty labels
- Find potential duplicates
- Suggest consolidations
- Auto-detect categories (work, finance, personal, etc.)

### Step 3: Plan Your Organization

Edit `ORGANIZATION_PLAN` in `reorganization.gs`:

```javascript
var ORGANIZATION_PLAN = {
  // Labels to create
  newLabels: [
    'Personal',
    'Personal/Family',
    'Work',
    'Work/Projects',
    'Finance',
    'Archive'
  ],

  // Migration rules
  migrations: [
    {from: 'Family Stuff', to: 'Personal/Family'},
    {from: 'Job/Acme Corp', to: 'Work/Projects'},
    {from: 'Bank', to: 'Finance'},
    {from: 'Old Work 2020', to: 'Archive'}
  ]
};
```

### Step 4: Validate Your Plan

```javascript
// Check for errors before running
validatePlan();

// Preview what will happen
previewMigrations();
```

### Step 5: Dry Run

Test without making changes:

```javascript
// In CONFIG, ensure:
var CONFIG = {
  DRY_RUN: true,  // Keep this true!
  // ...
};

// Run the migration
main();
```

Review the execution log to verify the plan looks correct.

### Step 6: Execute Migration

Once satisfied:

```javascript
// Change to false for live execution
var CONFIG = {
  DRY_RUN: false,
  // ...
};

main();
```

**Run `main()` multiple times** until all migrations are complete. The script automatically resumes where it left off.

### Step 7: Track Progress

```javascript
// See overall statistics
showStatistics();

// See migration progress
showProgress();
```

## Available Functions

### Backup Functions (`backup.gs`)

| Function | Description |
|----------|-------------|
| `createBackup()` | Full email inventory spreadsheet |
| `createLabelSummary()` | Quick label statistics |
| `backupUnreadEmails()` | Backup only unread emails |
| `backupDateRange(start, end)` | Backup specific date range |

### Analysis Functions (`analysis.gs`)

| Function | Description |
|----------|-------------|
| `analyzeLabelStructure()` | Full analysis with recommendations |
| `quickStats()` | Fast overview |
| `visualizeLabelHierarchy()` | Tree view of labels |
| `generateMigrationTemplate()` | Auto-generate migration plan |

### Migration Functions (`reorganization.gs`)

| Function | Description |
|----------|-------------|
| `main()` | Execute/resume migration |
| `validatePlan()` | Check plan for errors |
| `previewMigrations()` | Preview what will happen |
| `showProgress()` | View current progress |
| `resetMigrations()` | Start fresh |

### Utility Functions (`utils.gs`)

| Function | Description |
|----------|-------------|
| `showStatistics()` | Overall statistics |
| `deleteEmptyLabels(dryRun)` | Remove empty labels |
| `findDuplicateLabels()` | Find similar labels |
| `exportLabelStructure()` | Export as JSON |

## Configuration

Edit `CONFIG` in `reorganization.gs`:

```javascript
var CONFIG = {
  // Safety mode - set false only for live migration
  DRY_RUN: true,

  // Threads per batch (reduce if hitting quotas)
  BATCH_SIZE: 100,

  // Max runtime before auto-stop (ms)
  MAX_RUNTIME_MS: 300000,

  // Skip already-completed migrations
  SKIP_COMPLETED: true,

  // Show detailed progress
  VERBOSE: true
};
```

## Example Organization Plans

### Minimal (5 Categories)
```javascript
newLabels: ['Personal', 'Work', 'Finance', 'Shopping', 'Archive']
```

### Standard (8 Categories)
```javascript
newLabels: [
  'Personal', 'Personal/Family', 'Personal/Health',
  'Work', 'Work/Projects', 'Work/Clients',
  'Finance', 'Finance/Banking', 'Finance/Taxes',
  'Shopping', 'Shopping/Orders', 'Shopping/Receipts',
  'Travel', 'Learning', 'Newsletters', 'Archive'
]
```

### GTD Style
```javascript
newLabels: [
  'Action/Today', 'Action/This Week', 'Action/Someday',
  'Waiting For', 'Reference', 'Archive'
]
```

### Freelancer/Business
```javascript
newLabels: [
  'Clients/Active', 'Clients/Past',
  'Projects/Active', 'Projects/Completed',
  'Admin/Invoices', 'Admin/Contracts', 'Admin/Taxes'
]
```

## Safety Features

- **Dry Run Mode**: Test everything before executing
- **Validation**: Catches errors before they happen
- **Batch Processing**: Handles large mailboxes without timeout
- **Auto Resume**: Interrupted? Just run again
- **Progress Tracking**: Know exactly what's been done
- **No Deletion**: Only reorganizes labels, never deletes emails

## Troubleshooting

### "Exceeded maximum execution time"
This is normal for large mailboxes. Just run `main()` again - it will resume automatically.

### "Service invoked too many times"
You've hit Gmail's rate limits. Wait a few minutes and try again, or reduce `BATCH_SIZE`.

### "Label not found"
The source label doesn't exist. Check spelling and run `listAllLabelsDetailed()` to see exact names.

### Migration seems stuck
Run `showProgress()` to see status. If needed, run `resetMigrations()` to start fresh.

### Want to undo a migration
The library only adds/removes labels, never deletes emails. To "undo":
1. Add a reverse migration: `{from: 'New Label', to: 'Old Label'}`
2. Run with `DRY_RUN: false`

## Best Practices

1. **Always backup first** - Run `createBackup()` before major changes
2. **Start with dry run** - Never skip the dry run step
3. **Review validation** - Fix all errors, review warnings
4. **Migrate in batches** - Don't try to do everything at once
5. **Check progress** - Use `showProgress()` to monitor
6. **Keep it simple** - 5-10 top-level categories is ideal

## Limitations

- Google Apps Script has a 6-minute execution limit (script auto-handles this)
- Gmail API rate limits may slow large migrations
- Cannot access system labels (Inbox, Sent, etc.) directly
- Label names have Gmail restrictions (no `<`, `>`, `&`, etc.)

## Privacy & Security

- All code runs in YOUR Google account
- No data is sent anywhere external
- No personal information in this codebase
- You control all permissions

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Critical**: Never commit personal Gmail data (label names, email addresses, etc.)

## License

MIT License - See [LICENSE](LICENSE)

## Acknowledgments

Inspired by the need to organize years of email chaos into something manageable.
