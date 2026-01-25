# Security Policy

## Overview

The Gmail Reorganization Library runs entirely within your Google account using Google Apps Script. No data is transmitted externally.

## Security Model

### What the script CAN access:
- Your Gmail labels and threads (required for functionality)
- Google Sheets (for backup creation)
- Script Properties (for state persistence)

### What the script CANNOT do:
- Send data to external servers
- Access other Google accounts
- Modify emails (only labels are changed)
- Delete emails (only reorganizes labels)
- Access your Google password

## Data Handling

### Local Processing
All data processing happens within Google's infrastructure in your account. The script:
- Reads label and thread metadata
- Creates spreadsheets in YOUR Google Drive
- Stores state in YOUR script properties

### No External Communication
This library contains no:
- External API calls
- Analytics or tracking
- Data exfiltration
- Network requests outside Google services

## Permissions Explained

When you authorize the script, Google requests these permissions:

| Permission | Why It's Needed |
|------------|-----------------|
| Gmail (read/write labels) | To reorganize your labels |
| Google Sheets | To create backup spreadsheets |
| Script Properties | To save migration progress |

## Best Practices

1. **Review the code** before running - it's all open source
2. **Run backups first** using `createBackup()`
3. **Use dry run mode** before live execution
4. **Don't share** your Apps Script project (it has access to your Gmail)

## Reporting Security Issues

If you discover a security vulnerability:

1. **Do NOT** open a public GitHub issue
2. Email the maintainer directly (see repository)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact

We will respond within 48 hours and work to address the issue promptly.

## Responsible Disclosure

We follow responsible disclosure practices:
- Security issues are prioritized
- Fixes are released as soon as possible
- Credit is given to reporters (if desired)

## Audit Trail

The script logs all operations to the Apps Script execution log, which you can review:
1. Open your Apps Script project
2. Click "Executions" in the left sidebar
3. Review the logs for any function run

## Third-Party Dependencies

This library has **zero external dependencies**. It uses only:
- Google Apps Script built-in services
- Gmail API (via GmailApp)
- Spreadsheet API (via SpreadsheetApp)
- Properties Service (via PropertiesService)
