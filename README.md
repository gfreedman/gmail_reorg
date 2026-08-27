# Gmail Reorganization Library

**[→ Documentation & overview site](https://gfreedman.github.io/gmail_reorg/)**

A Google Apps Script library for backing up, analyzing, and reorganizing Gmail labels. Moves labels in batches, resumes automatically if interrupted, and never touches the emails themselves.

## Quick Start

### 1. Create the project

1. Go to [Google Apps Script](https://script.google.com)
2. Click **New Project** and name it "Gmail Reorganization"

### 2. Add the script files

Go to File > New > Script and create these files. Paste the contents from this repo into each one.

| File | Purpose |
|------|---------|
| `utils.gs` | Core utilities — load first |
| `backup.gs` | Backup functions |
| `analysis.gs` | Label analysis |
| `reorganization.gs` | Migration execution |
| `tests.gs` | Test suite (optional) |
| `reorg_toolkit.gs` | Web App toolkit for one-off sweeps (optional) |

`utils.gs` must be the first file listed in your project.

`reorg_toolkit.gs` is a separate layer: a `doGet` router exposing one-off
maintenance routes over HTTP. Its configuration lives in `_private_data.gs`,
which holds personal sender rules and label names and so is not in this repo.
Without that file the toolkit raises a `ReferenceError` naming the missing
constant, so an absent configuration stops the run instead of quietly doing
nothing. The rest of the library works without it.

See [Toolkit setup](#toolkit-setup-optional) to deploy it, and
[SECURITY.md](SECURITY.md) for what it can reach.

### 3. Authorize

Run any function (e.g. `quickStats`). Google will prompt for Gmail access — click through and allow it.

## Usage

### Step 1: Back up first

```javascript
// Full inventory spreadsheet
createBackup();

// Or just label counts if you want something faster
createLabelSummary();
```

### Step 2: Analyze your labels

```javascript
analyzeLabelStructure();   // full report with suggestions
quickStats();              // quick overview
visualizeLabelHierarchy(); // tree view
```

The report shows label counts, empty labels, likely duplicates, and suggested groupings.

### Step 3: Write your migration plan

Edit `ORGANIZATION_PLAN` in `reorganization.gs`:

```javascript
var ORGANIZATION_PLAN = {
  newLabels: [
    'Personal',
    'Personal/Family',
    'Work',
    'Work/Projects',
    'Finance',
    'Archive'
  ],
  migrations: [
    {from: 'Family Stuff',    to: 'Personal/Family'},
    {from: 'Job/Acme Corp',   to: 'Work/Projects'},
    {from: 'Bank',            to: 'Finance'},
    {from: 'Old Work 2020',   to: 'Archive'}
  ]
};
```

### Step 4: Validate

```javascript
validatePlan();      // checks for errors
previewMigrations(); // shows what will move
```

Fix any errors before continuing.

### Step 5: Dry run

```javascript
// Keep DRY_RUN: true in CONFIG, then:
main();
```

Check the execution log. Nothing has moved yet.

### Step 6: Execute

```javascript
// Set DRY_RUN: false in CONFIG, then:
main();
```

Run `main()` as many times as needed — it picks up where it left off each time.

### Step 7: Check progress

```javascript
showStatistics();
showProgress();
```

## Functions

### backup.gs

| Function | What it does |
|----------|-------------|
| `createBackup()` | Full email inventory to a spreadsheet |
| `createLabelSummary()` | Label counts only |
| `backupUnreadEmails()` | Unread emails only |
| `backupDateRange(start, end)` | Specific date range |

### analysis.gs

| Function | What it does |
|----------|-------------|
| `analyzeLabelStructure()` | Full analysis with consolidation suggestions |
| `quickStats()` | Fast overview |
| `visualizeLabelHierarchy()` | Tree view of labels |
| `generateMigrationTemplate()` | Generates a migration plan to edit |

### reorganization.gs

| Function | What it does |
|----------|-------------|
| `main()` | Run or resume migration |
| `validatePlan()` | Check plan for errors |
| `previewMigrations()` | Preview what will move |
| `showProgress()` | Current migration status |
| `resetMigrations()` | Start over |

### utils.gs

| Function | What it does |
|----------|-------------|
| `showStatistics()` | Overall stats |
| `listAllLabelsDetailed()` | All labels with thread counts |
| `deleteEmptyLabels(dryRun)` | Remove empty labels |
| `findDuplicateLabels()` | Find similar-looking labels |
| `exportLabelStructure()` | Export label structure as JSON |

## Toolkit setup (optional)

Skip this unless you are deploying `reorg_toolkit.gs` as a Web App. The library
does not need any of it.

The toolkit runs behind a shared secret and fails closed: until you mint a token,
every route returns `DENIED`. Both setup functions live in `admin.gs`.

**1. Mint a token.** Select `admin.gs` in the editor, run `setWebAppToken()`, and
keep what it returns. It is shown once.

```
https://script.google.com/macros/s/<deployment>/exec?fn=counts&token=<token>
```

Every route needs `&token=`. Mutating routes stay dry runs until you add
`&apply=1`. To rotate, run the same function again; the old token stops working
immediately.

**2. Schedule the upkeep.** Run `installMaintenanceTrigger()` once. It installs a
daily trigger that labels inbox threads carrying no plan label. The trigger runs
inside the project rather than over HTTP, so it needs no token and no machine
left awake. It labels only, never archiving or trashing, and running it a second
time replaces the trigger instead of adding another.

`removeMaintenanceTrigger()` undoes it.

> The Apps Script editor does not refresh after a `clasp push`. If a file or
> function looks missing, hard-reload the tab.

## Tests

| How | Where |
|-----|-------|
| `runAllTests()` | Apps Script editor; results in the log |
| `?fn=selftest` | Deployed Web App; returns a pass/fail summary |
| `node test/mutation_test.js` | A clone; no Apps Script needed |

The first two run the suite in `tests.gs`. The third also disables each safety
check in turn to confirm a test catches it, and prints `SURVIVED` for any guard
that nothing covers. Run it after touching a guard. It loads the `.gs` files into
a sandboxed scope with the Apps Script globals stubbed, so it never reaches
Gmail, and it stubs the private configuration too.

## Configuration

Edit `CONFIG` in `reorganization.gs`:

```javascript
var CONFIG = {
  DRY_RUN: true,          // set false only when ready to run live
  BATCH_SIZE: 100,        // threads per batch — reduce if hitting rate limits
  MAX_RUNTIME_MS: 300000, // stops before the 6-minute Apps Script limit
  SKIP_COMPLETED: true,   // skips migrations already done
  VERBOSE: true           // detailed logging
};
```

## Organization plan examples

### Minimal
```javascript
newLabels: ['Personal', 'Work', 'Finance', 'Shopping', 'Archive']
```

### Standard
```javascript
newLabels: [
  'Personal', 'Personal/Family', 'Personal/Health',
  'Work', 'Work/Projects', 'Work/Clients',
  'Finance', 'Finance/Banking', 'Finance/Taxes',
  'Shopping', 'Shopping/Orders', 'Shopping/Receipts',
  'Travel', 'Learning', 'Newsletters', 'Archive'
]
```

### GTD
```javascript
newLabels: [
  'Action/Today', 'Action/This Week', 'Action/Someday',
  'Waiting For', 'Reference', 'Archive'
]
```

### Freelancer
```javascript
newLabels: [
  'Clients/Active', 'Clients/Past',
  'Projects/Active', 'Projects/Completed',
  'Admin/Invoices', 'Admin/Contracts', 'Admin/Taxes'
]
```

## Troubleshooting

**"Exceeded maximum execution time"** — Normal for large mailboxes. Run `main()` again and it will resume automatically.

**"Service invoked too many times"** — Gmail rate limit. The library auto-retries transient errors (503/500/429/rate-limit/timeout) with exponential backoff up to `CONFIG.MAX_RETRIES` times per batch, and aborts a retry if the backoff would exceed the runtime budget. If a batch still exhausts retries, the failed migration isn't marked complete — re-running `main()` will retry it. Reducing `BATCH_SIZE` helps if it keeps happening. The batch summary reports `Transient errors retried: N` so you can see how busy the retry path was.

**"Label not found"** — The source label doesn't exist or the name is slightly off. Run `listAllLabelsDetailed()` to see exact names.

**Migration seems stuck** — Run `showProgress()` to check status. If something is wrong, `resetMigrations()` starts fresh.

**Want to undo** — The library only adds and removes labels, so emails are never deleted. To reverse a migration, swap `from` and `to` in your plan and run again.

## Design notes

**Dry runs by default.** Every mutating operation reports what it would do and
needs an explicit flag to act. Runs are idempotent and checkpointed, so hitting
the 6-minute limit mid-migration is not a problem: run it again.

**Filing belongs in Gmail, not a mail client.** An earlier version of this setup
used client-side rules in a desktop mail app. Those only run while that machine
is awake, so filing stopped whenever the laptop closed and resumed days later,
leaving labels that looked maintained but had gaps in them. Delivery-time filters
in Gmail run regardless of what else is on.

**Archive on arrival only when no human wrote to you.** Newsletters and
notifications are filed and hidden. Anything a person typed is filed and left in
the inbox. Burying a message from a person costs far more than leaving a
newsletter visible, so the rule is asymmetric.

**Logic is committed, configuration is not.** Sender rules, label names and
thread ids live in a git-ignored file; the code that reads them is in the repo.
Personal data never enters git, and a missing configuration raises straight away
instead of producing a run that does nothing and reports success.

**Guards are mutation-tested.** A passing suite proves nothing unless it fails
when the code breaks, so `test/mutation_test.js` disables each safety check in
turn and confirms a test catches it. This caught two guards with no real
coverage, one of which was never wired in.

## Limitations

- Google Apps Script has a 6-minute execution limit. The script handles this automatically with batch processing and auto-resume.
- Gmail rate limits can slow things down on large mailboxes. Reduce `BATCH_SIZE` and rerun if needed.
- System labels (Inbox, Sent, Drafts, Spam) cannot be modified — Gmail doesn't expose them to Apps Script.
- Label names can't contain `<`, `>`, or `&`.

## Privacy

All code runs inside your Google account, and nothing is sent to a third-party server. The only thing written outside Gmail is the optional backup spreadsheet, which goes to your own Google Drive.

If you deploy the optional toolkit as a Web App, it answers HTTP requests that carry a valid token — see [SECURITY.md](SECURITY.md) for that access model.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Never commit personal Gmail data (label names, email addresses, etc.).

## License

MIT — see [LICENSE](LICENSE)
