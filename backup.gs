/**
 * Gmail Backup Script
 * Creates a Google Spreadsheet inventory of all emails and their labels
 *
 * REQUIRES: utils.gs (must be loaded first)
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Configuration for backup operations
 * Modify these values to customize backup behavior
 */
const BACKUP_CONFIG =
{
  // Maximum threads to process before flushing to prevent timeout
  FLUSH_INTERVAL: 100,

  // Maximum runtime before graceful stop (5 minutes, leaving buffer)
  MAX_RUNTIME_MS: 300000,

  // Spreadsheet naming pattern (date will be appended)
  BACKUP_NAME_PREFIX: 'Gmail Backup',

  // Include message body preview in backup (increases processing time)
  INCLUDE_BODY_PREVIEW: false,

  // Body preview length if enabled
  BODY_PREVIEW_LENGTH: 100
};

// ============================================================================
// MAIN BACKUP FUNCTIONS
// ============================================================================

/**
 * Main function to create a backup spreadsheet of all Gmail labels and threads.
 * Creates a new spreadsheet in your Google Drive with complete email inventory.
 *
 * @return {string} URL of the created spreadsheet
 */
function createBackup()
{
  const startTime = new Date().getTime();

  log('Starting Gmail backup...');

  // Create the spreadsheet with today's date
  const dateStr = new Date().toISOString().split('T')[0];
  const ss = SpreadsheetApp.create(BACKUP_CONFIG.BACKUP_NAME_PREFIX + ' - ' + dateStr);
  const sheet = ss.getActiveSheet();
  sheet.setName('Email Inventory');

  // Set up headers
  const headers = ['Thread ID', 'Subject', 'From', 'Date', 'Labels', 'Message Count', 'Is Unread'];
  if (BACKUP_CONFIG.INCLUDE_BODY_PREVIEW)
  {
    headers.push('Body Preview');
  }

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  const labels = GmailApp.getUserLabels();
  const processedThreadIds = {};  // Track processed threads to avoid duplicates
  let row = 2;
  let skippedCount = 0;

  log('Found ' + labels.length + ' labels to process');

  // Process each label
  for (let i = 0; i < labels.length; i++)
  {
    // Check time remaining before processing each label
    if (!hasTimeRemaining(startTime, BACKUP_CONFIG.MAX_RUNTIME_MS))
    {
      logWarning('Time limit approaching. Processed ' + (row - 2) + ' threads. Run again to continue.');
      break;
    }

    const label = labels[i];
    const labelName = label.getName();

    log('Processing label ' + (i + 1) + '/' + labels.length + ': ' + labelName);

    let threads;
    try
    {
      threads = getAllThreadsFromLabel(label);
    }
    catch (e)
    {
      logError('Error getting threads from "' + labelName + '": ' + e.message);
      continue;
    }

    // Process each thread in this label
    for (let j = 0; j < threads.length; j++)
    {
      const thread = threads[j];
      const threadId = thread.getId();

      // Skip if we've already processed this thread (from another label)
      if (processedThreadIds[threadId])
      {
        skippedCount++;
        continue;
      }

      processedThreadIds[threadId] = true;

      try
      {
        const rowData = extractThreadData(thread);
        sheet.getRange(row, 1, 1, rowData.length).setValues([rowData]);
        row++;
      }
      catch (e)
      {
        logError('Error processing thread ' + threadId + ': ' + e.message);
      }

      // Flush periodically to prevent timeout and save progress
      if (row % BACKUP_CONFIG.FLUSH_INTERVAL === 0)
      {
        SpreadsheetApp.flush();
        log('Progress: ' + (row - 2) + ' threads backed up...');
      }
    }
  }

  // Format the sheet for readability
  formatBackupSheet(sheet, headers.length);

  const totalThreads = row - 2;
  log('Backup complete!');
  log('Total unique threads: ' + totalThreads);
  log('Duplicate threads skipped: ' + skippedCount);
  log('Spreadsheet URL: ' + ss.getUrl());

  return ss.getUrl();
}

/**
 * Extract data from a thread for backup.
 * Pulls subject, sender, date, labels, and optionally body preview.
 *
 * @param {GmailThread} thread - The thread to extract data from
 * @return {Array} Row data array
 * @throws {Error} If thread has no messages
 */
function extractThreadData(thread)
{
  const messages = thread.getMessages();

  // Safety check for empty threads
  if (!messages || messages.length === 0)
  {
    throw new Error('Thread has no messages');
  }

  const firstMessage = messages[0];
  const labels = thread.getLabels();

  // Join all label names with commas
  const allLabels = labels ? labels.map(function(l)
  {
    return l.getName();
  }).join(', ') : '';

  const rowData =
  [
    thread.getId(),
    thread.getFirstMessageSubject() || '(no subject)',
    firstMessage.getFrom(),
    thread.getLastMessageDate(),
    allLabels,
    thread.getMessageCount(),
    thread.isUnread()
  ];

  // Optionally add body preview
  if (BACKUP_CONFIG.INCLUDE_BODY_PREVIEW)
  {
    const body = firstMessage.getPlainBody() || '';
    const preview = body.substring(0, BACKUP_CONFIG.BODY_PREVIEW_LENGTH).replace(/\n/g, ' ');
    rowData.push(preview);
  }

  return rowData;
}

/**
 * Format the backup spreadsheet for readability.
 * Auto-resizes columns and sets reasonable widths.
 *
 * @param {Sheet} sheet - The sheet to format
 * @param {number} numColumns - Number of columns
 */
function formatBackupSheet(sheet, numColumns)
{
  try
  {
    sheet.autoResizeColumns(1, numColumns);

    // Set column widths for better readability
    sheet.setColumnWidth(2, 300);  // Subject column
    sheet.setColumnWidth(3, 200);  // From column
    sheet.setColumnWidth(5, 250);  // Labels column
  }
  catch (e)
  {
    logWarning('Could not auto-format sheet: ' + e.message);
  }
}

// ============================================================================
// LABEL SUMMARY FUNCTIONS
// ============================================================================

/**
 * Create a summary report of label usage.
 * More efficient than full backup - just shows label statistics.
 *
 * @return {string} URL of the created spreadsheet
 */
function createLabelSummary()
{
  log('Creating label summary...');

  const dateStr = new Date().toISOString().split('T')[0];
  const ss = SpreadsheetApp.create('Gmail Label Summary - ' + dateStr);
  const sheet = ss.getActiveSheet();
  sheet.setName('Label Summary');

  // Set up headers
  const headers = ['Label Name', 'Thread Count', 'Nesting Level', 'Parent Label'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  const labels = GmailApp.getUserLabels();
  let row = 2;
  let totalThreads = 0;

  // Process each label
  for (let i = 0; i < labels.length; i++)
  {
    const label = labels[i];
    const name = label.getName();
    const threadCount = getThreadCountForLabel(label);

    // Calculate nesting level (count slashes)
    const level = (name.match(/\//g) || []).length;

    // Extract parent label name
    const parent = name.indexOf('/') > -1 ? name.substring(0, name.lastIndexOf('/')) : '';

    totalThreads += threadCount;

    const rowData = [name, threadCount, level, parent];
    sheet.getRange(row, 1, 1, rowData.length).setValues([rowData]);
    row++;
  }

  // Add summary row at the bottom
  row++;
  sheet.getRange(row, 1, 1, 2).setValues([['TOTAL', totalThreads]]);
  sheet.getRange(row, 1, 1, 2).setFontWeight('bold');

  sheet.autoResizeColumns(1, headers.length);

  log('Label summary created: ' + ss.getUrl());
  log('Total labels: ' + labels.length);
  log('Total threads across all labels: ' + totalThreads);

  return ss.getUrl();
}

// ============================================================================
// INCREMENTAL BACKUP FUNCTIONS
// ============================================================================

/**
 * Create a backup of only unread emails.
 * Useful for quick backups of new mail.
 *
 * @return {string} URL of the created spreadsheet
 */
function backupUnreadEmails()
{
  log('Backing up unread emails...');

  const dateStr = new Date().toISOString().split('T')[0];
  const ss = SpreadsheetApp.create('Gmail Unread Backup - ' + dateStr);
  const sheet = ss.getActiveSheet();
  sheet.setName('Unread Emails');

  // Set up headers
  const headers = ['Thread ID', 'Subject', 'From', 'Date', 'Labels'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  // Search for unread threads
  const threads = GmailApp.search('is:unread');
  let row = 2;

  log('Found ' + threads.length + ' unread threads');

  // Process each unread thread
  for (let i = 0; i < threads.length; i++)
  {
    const thread = threads[i];
    const messages = thread.getMessages();

    // Safety check for empty threads
    if (!messages || messages.length === 0)
    {
      logWarning('Skipping thread with no messages: ' + thread.getId());
      continue;
    }

    const firstMessage = messages[0];
    const allLabels = thread.getLabels().map(function(l)
    {
      return l.getName();
    }).join(', ');

    const rowData =
    [
      thread.getId(),
      thread.getFirstMessageSubject() || '(no subject)',
      firstMessage.getFrom(),
      thread.getLastMessageDate(),
      allLabels
    ];

    sheet.getRange(row, 1, 1, rowData.length).setValues([rowData]);
    row++;
  }

  sheet.autoResizeColumns(1, headers.length);

  log('Unread backup complete: ' + ss.getUrl());
  return ss.getUrl();
}

/**
 * Backup emails from a specific date range.
 * Useful for archiving specific time periods.
 *
 * @param {Date} startDate - Start of date range
 * @param {Date} endDate - End of date range
 * @return {string} URL of the created spreadsheet
 */
function backupDateRange(startDate, endDate)
{
  // Validate required parameters
  if (!startDate || !endDate)
  {
    logError('Both startDate and endDate are required');
    return null;
  }

  // Format dates for Gmail search query
  const startStr = Utilities.formatDate(startDate, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  const endStr = Utilities.formatDate(endDate, Session.getScriptTimeZone(), 'yyyy/MM/dd');

  log('Backing up emails from ' + startStr + ' to ' + endStr);

  // Build Gmail search query
  const query = 'after:' + startStr + ' before:' + endStr;
  const threads = GmailApp.search(query);

  // Create the spreadsheet
  const dateStr = new Date().toISOString().split('T')[0];
  const ss = SpreadsheetApp.create('Gmail Backup (' + startStr + ' to ' + endStr + ') - ' + dateStr);
  const sheet = ss.getActiveSheet();
  sheet.setName('Email Backup');

  // Set up headers
  const headers = ['Thread ID', 'Subject', 'From', 'Date', 'Labels', 'Message Count'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  let row = 2;
  log('Found ' + threads.length + ' threads in date range');

  // Process each thread
  for (let i = 0; i < threads.length; i++)
  {
    const thread = threads[i];
    const messages = thread.getMessages();

    // Safety check for empty threads
    if (!messages || messages.length === 0)
    {
      logWarning('Skipping thread with no messages: ' + thread.getId());
      continue;
    }

    const firstMessage = messages[0];
    const allLabels = thread.getLabels().map(function(l)
    {
      return l.getName();
    }).join(', ');

    const rowData =
    [
      thread.getId(),
      thread.getFirstMessageSubject() || '(no subject)',
      firstMessage.getFrom(),
      thread.getLastMessageDate(),
      allLabels,
      thread.getMessageCount()
    ];

    sheet.getRange(row, 1, 1, rowData.length).setValues([rowData]);
    row++;

    // Flush periodically for long backups
    if (row % BACKUP_CONFIG.FLUSH_INTERVAL === 0)
    {
      SpreadsheetApp.flush();
      log('Progress: ' + (row - 2) + ' threads...');
    }
  }

  sheet.autoResizeColumns(1, headers.length);

  log('Date range backup complete: ' + ss.getUrl());
  return ss.getUrl();
}
