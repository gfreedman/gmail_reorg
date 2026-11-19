# Gmail Reorganization Library

**[→ Documentation & overview site](https://gfreedman.github.io/gmail_reorg/)**

A Google Apps Script library for backing up, analyzing, and reorganizing Gmail labels. Moves labels in batches, resumes automatically if interrupted, and never touches the emails themselves.

## Quick Start

### 1. Create the project

1. Go to [Google Apps Script](https://script.google.com)
2. Click **New Project** and name it "Gmail Reorganization"

### 2. Add the script files

In the editor, click **+** next to **Files**, choose **Script**, and create these files. Paste the contents from this repo into each one.

| File | Purpose |
|------|---------|
| `utils.gs` | Core utilities — load first |
| `backup.gs` | Backup functions |
| `analysis.gs` | Label analysis |
| `reorganization.gs` | Migration execution |
| `examples.gs` | Ready-to-run example scripts (optional) |
| `tests.gs` | Test suite (optional; three of its suites test the toolkit, so they need the toolkit files) |
| `reorg_toolkit.gs` | Toolkit: shared settings and helpers (optional, with the four `toolkit_*.gs` files) |
| `toolkit_webapp.gs` | Toolkit: Web App entry points and the token check |
| `toolkit_filters.gs` | Toolkit: rebuilds and lists Gmail delivery filters |
| `toolkit_filing.gs` | Toolkit: the daily inbox sweep and `passF` |
| `toolkit_reports.gs` | Toolkit: read-only reports and the restore backup |
| `admin.gs` | Toolkit setup functions you run by hand (optional, needs the toolkit files) |
| `appsscript.json` | Project manifest: turns on the Gmail advanced service the toolkit uses, and the Web App settings. Paste it over the project's own manifest (Project Settings > Show "appsscript.json") |

`utils.gs` must be the first file listed in your project.

The toolkit (`reorg_toolkit.gs` and the four `toolkit_*.gs` files) is a separate
layer: a POST-only Web App router exposing maintenance and diagnostic routes
over HTTP. Its configuration lives in `_private_data.gs`, which holds personal
sender rules and label names and so is not in this repo.
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
const ORGANIZATION_PLAN = {
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

Skip this unless you are deploying the toolkit as a Web App. The library
does not need any of it.

The toolkit runs behind a shared secret and fails closed: until you mint a token,
every route returns `DENIED`. The setup functions live in `admin.gs`.

**0. Add your configuration.** Create `_private_data.gs` with your sender rules
and label names. Without it, most routes stop with a `ReferenceError` naming
the missing constant.

**1. Deploy.** Make sure `appsscript.json` from this repo is in the project, then
choose **Deploy > New deployment**, type **Web app**, execute as **Me**, access
**Anyone**. Copy the deployment URL. After a code change, publish it as a new
version of the same deployment (**Deploy > Manage deployments**, edit, **Version:
New version**) to keep the URL. Each deployment keeps running the code it was
given, so archive any you no longer use.

**2. Grant filter access.** Select `admin.gs` and run `authorize()` once,
approving the consent screen. The `listfilters` and `rebuildfilters` routes need
it; the Web App cannot ask for that permission itself.

**3. Mint a token.** Select `admin.gs` in the editor, run `setWebAppToken()`, and
copy the token from the execution log. The editor's Run button discards return
values, so the log is the only place it appears.

```
read -s TOKEN    # paste the token; nothing is echoed or saved to shell history
curl -sL "https://script.google.com/macros/s/<deployment>/exec" \
  --data-urlencode "fn=counts" --data-urlencode "token=$TOKEN"
```

Requests are POST only, with `fn` and `token` in the body. `--data-urlencode`
already makes curl send a POST; don't add `-X POST`, which makes curl repeat
the POST after Apps Script's redirect and get an error page. A GET is always
refused, and so is a token in the URL, because URLs end up in browser history,
proxy logs and copied links. Mutating routes stay dry runs until you add
`apply=1`. To rotate, run the same function again; the old token stops working
immediately.

**4. Schedule the upkeep.** Run `installMaintenanceTrigger()` once. It installs a
daily trigger that labels inbox threads that have no filing label yet, and
leaves suspected spam alone. The trigger runs
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
| `fn=selftest` (POST) | Deployed Web App; returns a pass/fail summary |
| `node test/mutation_test.js` | A clone; no Apps Script needed |
| `node test/lint.js` | A clone; checks every `.gs` file for undefined names and duplicate declarations |

The first two run every suite in `tests.gs`. The third, which is what CI
runs, runs three suites (filter rules, the toolkit's write paths, and the
inbox sweep and backups), then disables each safety check in turn to confirm
a test catches it, and prints `SURVIVED` for any guard that nothing covers.
Run it after touching a guard. It loads the `.gs` files into a sandboxed scope
with the Apps Script globals stubbed, so it never reaches Gmail, and it stubs
the private configuration when `_private_data.gs` is absent. CI also runs the
fourth, a static check that needs network access once for `npx` to fetch ESLint.

## Configuration

Edit `CONFIG` in `reorganization.gs`:

```javascript
const CONFIG = {
  DRY_RUN: true,            // set false only when ready to run live
  BATCH_SIZE: 100,          // threads per batch — reduce if hitting rate limits
  MAX_RUNTIME_MS: 300000,   // stops before the 6-minute Apps Script limit
  SKIP_COMPLETED: true,     // skips migrations already done
  VERBOSE: true,            // detailed logging
  MAX_RETRIES: 4,           // attempts per batch for 503/429/timeouts, first try included
  RETRY_BASE_DELAY_MS: 1000 // first backoff; doubles each retry, plus jitter
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
  'Work', 'Work/Projects',
  'Finance', 'Finance/Taxes',
  'Archive'
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

## Label colors

Colors are optional and cosmetic: they change how labels look, never which mail
they hold. Gmail offers a fixed set of preset tiles; there is no custom color.

- **One hue per top-level group.** Sub-labels take their parent's color, so a
  group reads as one block in the sidebar and on message chips.
- **Seven or eight hues at most.** Past that the eye stops telling them apart.
  Check neighbors: orange beside yellow and red beside brown blur together.
- **Reserve red for conflict.** If red appears on ordinary labels it stops meaning
  anything.
- **Gray for low-attention buckets** such as a catch-all `Misc`.
- **Leave tool-managed labels alone.** Labels owned by another tool keep whatever
  color that tool gave them.

Gmail only nests `Foo/Bar` under `Foo` in the sidebar if a label named exactly
`Foo` exists. Without one, the sidebar shows the full `Foo/Bar` text flat. Create
an empty parent label for each group.

A preset color cannot be cleared through the API; the nearest is the White preset.
To remove a color completely, use "Remove color" in the Gmail label menu.

## Troubleshooting

**"Exceeded maximum execution time"** — Normal for large mailboxes. Run `main()` again and it will resume automatically.

**"Service invoked too many times"** — Gmail rate limit. The library auto-retries transient errors (503/500/429/rate-limit/timeout) with exponential backoff, making up to `CONFIG.MAX_RETRIES` attempts per batch, and aborts a retry if the backoff would exceed the runtime budget. If a batch still exhausts retries, the failed migration isn't marked complete — re-running `main()` will retry it. Reducing `BATCH_SIZE` helps if it keeps happening. The batch summary reports `Transient errors retried: N` so you can see how busy the retry path was.

**"Label not found"** — The source label doesn't exist or the name is slightly off. Run `listAllLabelsDetailed()` to see exact names.

**Migration seems stuck** — Run `showProgress()` to check status. If something is wrong, `resetMigrations()` starts fresh.

**Want to undo** — The library only adds and removes labels, so emails are never deleted. To reverse a migration, swap `from` and `to` in your plan and run again.

## Design notes

**Dry runs by default.** Mutating operations report what they would do and need
an explicit flag to act. The exception is the scheduled maintenance, which only
adds labels. Migrations are idempotent and checkpointed, so hitting the 6-minute
limit mid-migration is not a problem: run it again.

**Filing belongs in Gmail, not a mail client.** An earlier version of this setup
used client-side rules in a desktop mail app. Those only run while that machine
is awake, so filing stopped whenever the laptop closed and resumed days later,
leaving labels that looked maintained but had gaps in them. Delivery-time filters
in Gmail run regardless of what else is on.

**Archive on arrival only when no human wrote to you.** Newsletters and
notifications are filed and hidden. Anything a person typed is filed and left in
the inbox. Burying a message from a person costs far more than leaving a
newsletter visible, so the rule is asymmetric.

**Logic is committed, configuration is not.** Sender rules and label names
live in a git-ignored file; the code that reads them is in the repo.
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
- This library refuses label names containing `&`, `<`, `>`, `[`, `]`, `{` or `}`.

## Privacy

All code runs inside your Google account, and nothing is sent to a third-party server. The only thing written outside Gmail is the optional backup spreadsheet, which goes to your own Google Drive.

If you deploy the optional toolkit as a Web App, it answers HTTP requests that carry a valid token — see [SECURITY.md](SECURITY.md) for that access model.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Never commit personal Gmail data (label names, email addresses, etc.).

## License

MIT — see [LICENSE](LICENSE)
