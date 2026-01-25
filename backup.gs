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
var BACKUP_CONFIG = {
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
 * Main function to create a backup spreadsheet of all Gmail labels and threads
 * Creates a new spreadsheet in your Google Drive with complete email inventory
 *
 * @return {string} URL of the created spreadsheet
 */
function createBackup() {
  var startTime = new Date().getTime();

  log('Starting Gmail backup...');

  // Create the spreadsheet
  var dateStr = new Date().toISOString().split('T')[0];
  var ss = SpreadsheetApp.create(BACKUP_CONFIG.BACKUP_NAME_PREFIX + ' - ' + dateStr);
  var sheet = ss.getActiveSheet();
  sheet.setName('Email Inventory');

  // Set up headers
  var headers = ['Thread ID', 'Subject', 'From', 'Date', 'Labels', 'Message Count', 'Is Unread'];
  if (BACKUP_CONFIG.INCLUDE_BODY_PREVIEW) {
    headers.push('Body Preview');
  }

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  var labels = GmailApp.getUserLabels();
  var processedThreadIds = {};
  var row = 2;
  var skippedCount = 0;

  log('Found ' + labels.length + ' labels to process');

  // Process each label
  for (var i = 0; i < labels.length; i++) {
    // Check time remaining
    if (!hasTimeRemaining(startTime, BACKUP_CONFIG.MAX_RUNTIME_MS)) {
      logWarning('Time limit approaching. Processed ' + (row - 2) + ' threads. Run again to continue.');
      break;
    }

    var label = labels[i];
    var labelName = label.getName();

    log('Processing label ' + (i + 1) + '/' + labels.length + ': ' + labelName);

    var threads;
    try {
      threads = getAllThreadsFromLabel(label);
    } catch (e) {
      logError('Error getting threads from "' + labelName + '": ' + e.message);
      continue;
    }

    for (var j = 0; j < threads.length; j++) {
      var thread = threads[j];
      var threadId = thread.getId();

      // Skip if we've already processed this thread
      if (processedThreadIds[threadId]) {
        skippedCount++;
        continue;
      }

      processedThreadIds[threadId] = true;

      try {
        var rowData = extractThreadData(thread);
        sheet.getRange(row, 1, 1, rowData.length).setValues([rowData]);
        row++;
      } catch (e) {
        logError('Error processing thread ' + threadId + ': ' + e.message);
      }

      // Flush periodically to prevent timeout
      if (row % BACKUP_CONFIG.FLUSH_INTERVAL === 0) {
        SpreadsheetApp.flush();
        log('Progress: ' + (row - 2) + ' threads backed up...');
      }
    }
  }

  // Format the sheet
  formatBackupSheet(sheet, headers.length);

  var totalThreads = row - 2;
  log('Backup complete!');
  log('Total unique threads: ' + totalThreads);
  log('Duplicate threads skipped: ' + skippedCount);
  log('Spreadsheet URL: ' + ss.getUrl());

  return ss.getUrl();
}

/**
 * Extract data from a thread for backup
 * @param {GmailThread} thread - The thread to extract data from
 * @return {Array} Row data array
 */
function extractThreadData(thread) {
  var firstMessage = thread.getMessages()[0];
  var allLabels = thread.getLabels().map(function(l) { return l.getName(); }).join(', ');

  var rowData = [
    thread.getId(),
    thread.getFirstMessageSubject() || '(no subject)',
    firstMessage.getFrom(),
    thread.getLastMessageDate(),
    allLabels,
    thread.getMessageCount(),
    thread.isUnread()
  ];

  if (BACKUP_CONFIG.INCLUDE_BODY_PREVIEW) {
    var body = firstMessage.getPlainBody() || '';
    var preview = body.substring(0, BACKUP_CONFIG.BODY_PREVIEW_LENGTH).replace(/\n/g, ' ');
    rowData.push(preview);
  }

  return rowData;
}

/**
 * Format the backup spreadsheet for readability
 * @param {Sheet} sheet - The sheet to format
 * @param {number} numColumns - Number of columns
 */
function formatBackupSheet(sheet, numColumns) {
  try {
    sheet.autoResizeColumns(1, numColumns);

    // Set column widths for better readability
    sheet.setColumnWidth(2, 300); // Subject column
    sheet.setColumnWidth(3, 200); // From column
    sheet.setColumnWidth(5, 250); // Labels column
  } catch (e) {
    logWarning('Could not auto-format sheet: ' + e.message);
  }
}

// ============================================================================
// LABEL SUMMARY FUNCTIONS
// ============================================================================

/**
 * Create a summary report of label usage
 * More efficient than full backup - just shows label statistics
 *
 * @return {string} URL of the created spreadsheet
 */
function createLabelSummary() {
  log('Creating label summary...');

  var dateStr = new Date().toISOString().split('T')[0];
  var ss = SpreadsheetApp.create('Gmail Label Summary - ' + dateStr);
  var sheet = ss.getActiveSheet();
  sheet.setName('Label Summary');

  var headers = ['Label Name', 'Thread Count', 'Nesting Level', 'Parent Label'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  var labels = GmailApp.getUserLabels();
  var row = 2;
  var totalThreads = 0;

  for (var i = 0; i < labels.length; i++) {
    var label = labels[i];
    var name = label.getName();
    var threadCount = getThreadCountForLabel(label);
    var level = (name.match(/\//g) || []).length;
    var parent = name.indexOf('/') > -1 ? name.substring(0, name.lastIndexOf('/')) : '';

    totalThreads += threadCount;

    var rowData = [name, threadCount, level, parent];
    sheet.getRange(row, 1, 1, rowData.length).setValues([rowData]);
    row++;
  }

  // Add summary row
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
 * Create a backup of only unread emails
 * Useful for quick backups of new mail
 *
 * @return {string} URL of the created spreadsheet
 */
function backupUnreadEmails() {
  log('Backing up unread emails...');

  var dateStr = new Date().toISOString().split('T')[0];
  var ss = SpreadsheetApp.create('Gmail Unread Backup - ' + dateStr);
  var sheet = ss.getActiveSheet();
  sheet.setName('Unread Emails');

  var headers = ['Thread ID', 'Subject', 'From', 'Date', 'Labels'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  var threads = GmailApp.search('is:unread');
  var row = 2;

  log('Found ' + threads.length + ' unread threads');

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var firstMessage = thread.getMessages()[0];
    var allLabels = thread.getLabels().map(function(l) { return l.getName(); }).join(', ');

    var rowData = [
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
 * Backup emails from a specific date range
 *
 * @param {Date} startDate - Start of date range
 * @param {Date} endDate - End of date range
 * @return {string} URL of the created spreadsheet
 */
function backupDateRange(startDate, endDate) {
  if (!startDate || !endDate) {
    logError('Both startDate and endDate are required');
    return null;
  }

  var startStr = Utilities.formatDate(startDate, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  var endStr = Utilities.formatDate(endDate, Session.getScriptTimeZone(), 'yyyy/MM/dd');

  log('Backing up emails from ' + startStr + ' to ' + endStr);

  var query = 'after:' + startStr + ' before:' + endStr;
  var threads = GmailApp.search(query);

  var dateStr = new Date().toISOString().split('T')[0];
  var ss = SpreadsheetApp.create('Gmail Backup (' + startStr + ' to ' + endStr + ') - ' + dateStr);
  var sheet = ss.getActiveSheet();
  sheet.setName('Email Backup');

  var headers = ['Thread ID', 'Subject', 'From', 'Date', 'Labels', 'Message Count'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  var row = 2;
  log('Found ' + threads.length + ' threads in date range');

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var firstMessage = thread.getMessages()[0];
    var allLabels = thread.getLabels().map(function(l) { return l.getName(); }).join(', ');

    var rowData = [
      thread.getId(),
      thread.getFirstMessageSubject() || '(no subject)',
      firstMessage.getFrom(),
      thread.getLastMessageDate(),
      allLabels,
      thread.getMessageCount()
    ];

    sheet.getRange(row, 1, 1, rowData.length).setValues([rowData]);
    row++;

    if (row % BACKUP_CONFIG.FLUSH_INTERVAL === 0) {
      SpreadsheetApp.flush();
      log('Progress: ' + (row - 2) + ' threads...');
    }
  }

  sheet.autoResizeColumns(1, headers.length);

  log('Date range backup complete: ' + ss.getUrl());
  return ss.getUrl();
}
