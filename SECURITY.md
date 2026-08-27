# Security Policy

## Two layers, two risk profiles

**The library** (`utils.gs`, `backup.gs`, `analysis.gs`, `reorganization.gs`) is
what the [front page](https://gfreedman.github.io/gmail_reorg/) documents. It runs
from the Apps Script editor, changes labels only, and never deletes a message.

**The toolkit** (`reorg_toolkit.gs`, `admin.gs`) is a maintenance layer deployed
as a Web App and driven over HTTP. It can trash mail. Read it before running it
against your own account.

## What the library can and cannot do

Can access your Gmail labels and threads, create Sheets in your Drive for
backups, and store state in Script Properties.

Cannot send data to external servers, reach other Google accounts, read or
change your password, or delete messages. It moves labels; that is all.

## What the toolkit can do

Everything above, plus:

- **Trash messages.** `preReorgCleanup_` and `passFtrash` move mail to Trash.
  Both default to a dry run and require `&apply=1` to act.
- **Serve mailbox data over HTTP.** `?fn=backup` returns every label and thread
  id as text; the diagnostics return sender domains and counts.

Every mutating route is dry-run by default, idempotent, and re-runnable.

## Web App access control

The deployment is `ANYONE_ANONYMOUS` executing as the deploying user, which means
a request carries full Gmail authority. **An unguessable URL is not access
control** — URLs leak through shell history, proxy logs and clipboards.

Every route therefore requires a shared secret:

```
https://script.google.com/macros/s/<deployment>/exec?fn=counts&token=<token>
```

- The token lives in the Script Property `WEBAPP_TOKEN`, never in source.
- `setWebAppToken()` in `admin.gs` mints one from `Utilities.getUuid()`
  (`SecureRandom`-backed, 244 bits) and returns it once.
- **It fails closed.** With no token configured, every route is refused rather
  than left open.
- Comparison is constant-time, and a denial returns the bare string `DENIED`
  without echoing the route or the reason.

**Treat the URL and token together as a password.** Either alone is useless;
together they grant full mailbox access.

## Rotating a leaked token

Run `setWebAppToken()` from the Apps Script editor again. The old token stops
working immediately. There is nothing else to revoke and no deployment to
recreate.

If you believe the account itself is compromised, revoke the script's access at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions),
which invalidates the deployment entirely.

## Permissions

`appsscript.json` does not declare `oauthScopes`, so Apps Script infers them from
the code — Gmail, Sheets and Drive, plus triggers. For a single-user deployment
where the author is the only person consenting, this is a documented choice
rather than an oversight. Anyone publishing this as an add-on, where other people
consent to the grant, should declare an explicit least-privilege set first.

## Data handling

Processing happens inside your Google account. Backups are Sheets created in your
own Drive, private to you; nothing is shared automatically. No analytics, no
telemetry, no external API calls.

`createBackup` writes every subject and sender to a Sheet. That is a standing
copy of your mailbox metadata outside Gmail; delete it when you are done with it.

Configuration containing personal data (sender rules, label names, thread ids)
lives in `_private_data.gs`, which is git-ignored and has never been committed.

## Reporting a vulnerability

Open an issue at
[github.com/gfreedman/gmail_reorg/issues](https://github.com/gfreedman/gmail_reorg/issues).
Please do not include personal data — no real label names, addresses or thread
ids — and redact execution logs before attaching them.
