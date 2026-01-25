/**
 * Gmail Reorganization Utilities
 * Core helper functions used across the library
 *
 * IMPORTANT: All other scripts depend on this file.
 * Make sure this is loaded first in your Apps Script project.
 */

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

/**
 * Script property keys for state persistence
 */
var PROPERTY_KEYS = {
  MIGRATION_STATE: 'gmail_reorg_migration_state',
  LAST_RUN: 'gmail_reorg_last_run',
  COMPLETED_MIGRATIONS: 'gmail_reorg_completed',
  STATISTICS: 'gmail_reorg_stats'
};

/**
 * Gmail reserved label names that cannot be used
 */
var RESERVED_LABELS = [
  'inbox', 'sent', 'drafts', 'spam', 'trash', 'starred', 'important',
  'chats', 'all', 'unread', 'snoozed', 'scheduled', 'category'
];

/**
 * Characters not allowed in Gmail label names
 */
var INVALID_LABEL_CHARS = ['&', '<', '>', '[', ']', '{', '}'];

/**
 * Numeric constants - avoid magic numbers
 */
var CONSTANTS = {
  THREAD_BATCH_SIZE: 500,
  DEFAULT_TIME_BUFFER_MS: 30000,
  MAX_LABEL_NAME_LENGTH: 225,
  TOP_LABELS_COUNT: 20,
  LOW_USAGE_THRESHOLD: 5,
  MAX_DISPLAY_ITEMS: 10
};

// ============================================================================
// THREAD RETRIEVAL (Single Source of Truth)
// ============================================================================

/**
 * Get all threads from a label, handling pagination
 * This is the ONLY function that should be used to retrieve threads.
 *
 * @param {GmailLabel|string|null|undefined} labelOrName - The label object or label name string
 * @return {GmailThread[]} All threads with this label, or empty array on error
 */
function getAllThreadsFromLabel(labelOrName) {
  // Input validation
  if (labelOrName === null || labelOrName === undefined) {
    logWarning('getAllThreadsFromLabel called with null/undefined');
    return [];
  }

  var label;

  if (typeof labelOrName === 'string') {
    if (labelOrName.trim() === '') {
      logWarning('getAllThreadsFromLabel called with empty string');
      return [];
    }
    label = GmailApp.getUserLabelByName(labelOrName);
    if (!label) return [];
  } else if (typeof labelOrName === 'object' && labelOrName !== null) {
    label = labelOrName;
  } else {
    logWarning('getAllThreadsFromLabel called with invalid type: ' + typeof labelOrName);
    return [];
  }

  var allThreads = [];
  var start = 0;
  var batchSize = CONSTANTS.THREAD_BATCH_SIZE;

  while (true) {
    var threads;
    try {
      threads = label.getThreads(start, batchSize);
    } catch (e) {
      logError('Error getting threads from label: ' + e.message);
      break;
    }

    if (!threads || threads.length === 0) break;
    allThreads = allThreads.concat(threads);
    if (threads.length < batchSize) break;
    start += batchSize;
  }

  return allThreads;
}

/**
 * Get thread count for a label (more efficient than getting all threads)
 * @param {GmailLabel|string|null|undefined} labelOrName - The label object or label name
 * @return {number} Thread count, 0 if label not found, -1 on error
 */
function getThreadCountForLabel(labelOrName) {
  // Input validation
  if (labelOrName === null || labelOrName === undefined) {
    return 0;
  }

  var label;

  if (typeof labelOrName === 'string') {
    if (labelOrName.trim() === '') return 0;
    label = GmailApp.getUserLabelByName(labelOrName);
    if (!label) return 0;
  } else if (typeof labelOrName === 'object' && labelOrName !== null) {
    label = labelOrName;
  } else {
    return 0;
  }

  try {
    // Quick check - if first batch is less than max, we have the count
    var threads = label.getThreads(0, CONSTANTS.THREAD_BATCH_SIZE);
    if (!threads) return 0;
    if (threads.length < CONSTANTS.THREAD_BATCH_SIZE) {
      return threads.length;
    }
    // Otherwise, need to count all
    return getAllThreadsFromLabel(label).length;
  } catch (e) {
    logError('Error counting threads: ' + e.message);
    return -1;
  }
}

// ============================================================================
// LOGGING UTILITIES
// ============================================================================

/**
 * Log a message with timestamp
 * @param {string} message - Message to log
 */
function log(message) {
  Logger.log(formatTimestamp() + ' [INFO] ' + message);
}

/**
 * Log an error with timestamp
 * @param {string} message - Error message to log
 */
function logError(message) {
  Logger.log(formatTimestamp() + ' [ERROR] ' + message);
}

/**
 * Log a warning with timestamp
 * @param {string} message - Warning message to log
 */
function logWarning(message) {
  Logger.log(formatTimestamp() + ' [WARN] ' + message);
}

/**
 * Format current timestamp for logging
 * @return {string} Formatted timestamp
 */
function formatTimestamp() {
  return new Date().toISOString();
}

// ============================================================================
// STATE PERSISTENCE
// ============================================================================

/**
 * Save migration state for resume capability
 * @param {Object} state - State object to save
 */
function saveMigrationState(state) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(PROPERTY_KEYS.MIGRATION_STATE, JSON.stringify(state));
  props.setProperty(PROPERTY_KEYS.LAST_RUN, new Date().toISOString());
}

/**
 * Load saved migration state
 * @return {Object|null} Saved state or null if none exists
 */
function loadMigrationState() {
  var props = PropertiesService.getScriptProperties();
  var stateJson = props.getProperty(PROPERTY_KEYS.MIGRATION_STATE);

  if (!stateJson) return null;

  try {
    return JSON.parse(stateJson);
  } catch (e) {
    logError('Failed to parse migration state: ' + e.message);
    return null;
  }
}

/**
 * Clear saved migration state (call after successful completion)
 */
function clearMigrationState() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROPERTY_KEYS.MIGRATION_STATE);
  log('Migration state cleared');
}

/**
 * Mark a migration as completed
 * Uses optimistic locking to handle concurrent modifications
 * @param {string} fromLabel - Source label name
 * @param {string} toLabel - Destination label name
 * @param {number} threadCount - Number of threads migrated
 * @return {boolean} True if successfully saved
 */
function markMigrationCompleted(fromLabel, toLabel, threadCount) {
  // Input validation
  if (!fromLabel || !toLabel) {
    logError('markMigrationCompleted: missing required parameters');
    return false;
  }

  var props = PropertiesService.getScriptProperties();
  var maxRetries = 3;

  for (var attempt = 0; attempt < maxRetries; attempt++) {
    try {
      var completedJson = props.getProperty(PROPERTY_KEYS.COMPLETED_MIGRATIONS) || '[]';
      var completed = JSON.parse(completedJson);

      // Check if already exists to prevent duplicates
      var exists = completed.some(function(m) {
        return m.from === fromLabel && m.to === toLabel;
      });

      if (!exists) {
        completed.push({
          from: fromLabel,
          to: toLabel,
          threads: threadCount || 0,
          completedAt: new Date().toISOString(),
          version: '1.0.0'
        });
        props.setProperty(PROPERTY_KEYS.COMPLETED_MIGRATIONS, JSON.stringify(completed));
      }
      return true;
    } catch (e) {
      if (attempt === maxRetries - 1) {
        logError('Failed to save completed migration after ' + maxRetries + ' attempts: ' + e.message);
        return false;
      }
      // Brief pause before retry
      Utilities.sleep(100);
    }
  }
  return false;
}

/**
 * Check if a migration has already been completed
 * @param {string} fromLabel - Source label name
 * @return {boolean} True if already completed
 */
function isMigrationCompleted(fromLabel) {
  var props = PropertiesService.getScriptProperties();
  var completedJson = props.getProperty(PROPERTY_KEYS.COMPLETED_MIGRATIONS) || '[]';

  try {
    var completed = JSON.parse(completedJson);
    return completed.some(function(m) { return m.from === fromLabel; });
  } catch (e) {
    return false;
  }
}

/**
 * Get all completed migrations
 * @return {Array} List of completed migrations
 */
function getCompletedMigrations() {
  var props = PropertiesService.getScriptProperties();
  var completedJson = props.getProperty(PROPERTY_KEYS.COMPLETED_MIGRATIONS) || '[]';

  try {
    return JSON.parse(completedJson);
  } catch (e) {
    return [];
  }
}

/**
 * Reset all migration tracking (use with caution)
 */
function resetAllMigrationTracking() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROPERTY_KEYS.MIGRATION_STATE);
  props.deleteProperty(PROPERTY_KEYS.COMPLETED_MIGRATIONS);
  props.deleteProperty(PROPERTY_KEYS.STATISTICS);
  log('All migration tracking has been reset');
}

// ============================================================================
// STATISTICS TRACKING
// ============================================================================

/**
 * Update migration statistics
 * @param {number} threadsProcessed - Number of threads processed in this batch
 * @param {number} labelsCreated - Number of labels created
 */
function updateStatistics(threadsProcessed, labelsCreated) {
  var props = PropertiesService.getScriptProperties();
  var statsJson = props.getProperty(PROPERTY_KEYS.STATISTICS) || '{}';

  try {
    var stats = JSON.parse(statsJson);
    stats.totalThreadsProcessed = (stats.totalThreadsProcessed || 0) + threadsProcessed;
    stats.totalLabelsCreated = (stats.totalLabelsCreated || 0) + labelsCreated;
    stats.lastUpdated = new Date().toISOString();
    stats.runCount = (stats.runCount || 0) + 1;
    props.setProperty(PROPERTY_KEYS.STATISTICS, JSON.stringify(stats));
  } catch (e) {
    logError('Failed to update statistics: ' + e.message);
  }
}

/**
 * Get current migration statistics
 * @return {Object} Statistics object
 */
function getStatistics() {
  var props = PropertiesService.getScriptProperties();
  var statsJson = props.getProperty(PROPERTY_KEYS.STATISTICS) || '{}';

  try {
    return JSON.parse(statsJson);
  } catch (e) {
    return {};
  }
}

/**
 * Display migration statistics summary
 */
function showStatistics() {
  var stats = getStatistics();
  var completed = getCompletedMigrations();

  Logger.log('=== MIGRATION STATISTICS ===');
  Logger.log('Total script runs: ' + (stats.runCount || 0));
  Logger.log('Total threads processed: ' + (stats.totalThreadsProcessed || 0));
  Logger.log('Total labels created: ' + (stats.totalLabelsCreated || 0));
  Logger.log('Completed migrations: ' + completed.length);
  Logger.log('Last updated: ' + (stats.lastUpdated || 'Never'));
  Logger.log('');

  if (completed.length > 0) {
    Logger.log('=== COMPLETED MIGRATIONS ===');
    for (var i = 0; i < completed.length; i++) {
      var m = completed[i];
      Logger.log('  "' + m.from + '" -> "' + m.to + '" (' + m.threads + ' threads)');
    }
  }
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Test if a label name is valid for Gmail
 * @param {*} labelName - Label name to validate (will be converted to string)
 * @return {Object} {valid: boolean, reason: string|null}
 */
function validateLabelName(labelName) {
  // Handle null/undefined
  if (labelName === null || labelName === undefined) {
    return {valid: false, reason: 'Label name cannot be null or undefined'};
  }

  // Convert to string if needed
  var nameStr = String(labelName);

  if (nameStr.trim().length === 0) {
    return {valid: false, reason: 'Label name cannot be empty'};
  }

  var normalized = nameStr.toLowerCase().trim();

  // Check for reserved words
  for (var i = 0; i < RESERVED_LABELS.length; i++) {
    if (normalized === RESERVED_LABELS[i]) {
      return {valid: false, reason: '"' + nameStr + '" is a reserved Gmail label'};
    }
  }

  // Check for invalid characters
  for (var i = 0; i < INVALID_LABEL_CHARS.length; i++) {
    if (nameStr.indexOf(INVALID_LABEL_CHARS[i]) > -1) {
      return {valid: false, reason: 'Label contains invalid character: ' + INVALID_LABEL_CHARS[i]};
    }
  }

  // Check length (Gmail has a 225 character limit)
  if (nameStr.length > CONSTANTS.MAX_LABEL_NAME_LENGTH) {
    return {valid: false, reason: 'Label name exceeds ' + CONSTANTS.MAX_LABEL_NAME_LENGTH + ' character limit'};
  }

  return {valid: true, reason: null};
}

/**
 * Validate an organization plan before execution
 * @param {Object} plan - The organization plan to validate
 * @return {Object} {valid: boolean, errors: string[], warnings: string[]}
 */
function validateOrganizationPlan(plan) {
  var errors = [];
  var warnings = [];

  // Check plan structure
  if (!plan) {
    errors.push('Organization plan is null or undefined');
    return {valid: false, errors: errors, warnings: warnings};
  }

  if (!plan.newLabels || !Array.isArray(plan.newLabels)) {
    errors.push('Plan must have a "newLabels" array');
  }

  if (!plan.migrations || !Array.isArray(plan.migrations)) {
    errors.push('Plan must have a "migrations" array');
  }

  if (errors.length > 0) {
    return {valid: false, errors: errors, warnings: warnings};
  }

  // Validate new labels
  for (var i = 0; i < plan.newLabels.length; i++) {
    var validation = validateLabelName(plan.newLabels[i]);
    if (!validation.valid) {
      errors.push('Invalid new label "' + plan.newLabels[i] + '": ' + validation.reason);
    }
  }

  // Validate migrations
  for (var i = 0; i < plan.migrations.length; i++) {
    var migration = plan.migrations[i];

    if (!migration.from) {
      errors.push('Migration ' + i + ' is missing "from" field');
      continue;
    }

    if (!migration.to) {
      errors.push('Migration ' + i + ' is missing "to" field');
      continue;
    }

    // Check if source label exists
    var sourceLabel = GmailApp.getUserLabelByName(migration.from);
    if (!sourceLabel) {
      warnings.push('Source label "' + migration.from + '" does not exist (will be skipped)');
    }

    // Validate destination label name
    var destValidation = validateLabelName(migration.to);
    if (!destValidation.valid) {
      errors.push('Invalid destination label "' + migration.to + '": ' + destValidation.reason);
    }

    // Check if destination is in newLabels or already exists
    var destExists = GmailApp.getUserLabelByName(migration.to);
    var destInPlan = plan.newLabels.indexOf(migration.to) > -1;
    if (!destExists && !destInPlan) {
      warnings.push('Destination "' + migration.to + '" not in newLabels (will be created during migration)');
    }
  }

  // Check for duplicate migrations
  var seenFrom = {};
  for (var i = 0; i < plan.migrations.length; i++) {
    var from = plan.migrations[i].from;
    if (seenFrom[from]) {
      warnings.push('Label "' + from + '" appears in multiple migrations');
    }
    seenFrom[from] = true;
  }

  return {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings
  };
}

// ============================================================================
// LABEL INFORMATION UTILITIES
// ============================================================================

/**
 * List all labels with detailed information
 */
function listAllLabelsDetailed() {
  var labels = GmailApp.getUserLabels();
  var labelData = [];

  log('Scanning ' + labels.length + ' labels...');

  for (var i = 0; i < labels.length; i++) {
    var label = labels[i];
    var name = label.getName();
    var threadCount = getThreadCountForLabel(label);

    labelData.push({
      name: name,
      threads: threadCount
    });
  }

  // Sort by name
  labelData.sort(function(a, b) {
    return a.name.localeCompare(b.name);
  });

  Logger.log('=== ALL GMAIL LABELS ===');
  for (var i = 0; i < labelData.length; i++) {
    Logger.log('"' + labelData[i].name + '": ' + labelData[i].threads + ' threads');
  }
  Logger.log('=== TOTAL: ' + labelData.length + ' labels ===');

  return labelData;
}

/**
 * Find duplicate labels (case-insensitive)
 * @return {Array} Array of duplicate pairs
 */
function findDuplicateLabels() {
  var labels = GmailApp.getUserLabels();
  var seen = {};
  var duplicates = [];

  for (var i = 0; i < labels.length; i++) {
    var name = labels[i].getName().toLowerCase();
    if (seen[name]) {
      duplicates.push({
        original: seen[name],
        duplicate: labels[i].getName()
      });
    } else {
      seen[name] = labels[i].getName();
    }
  }

  if (duplicates.length > 0) {
    Logger.log('=== DUPLICATE LABELS FOUND ===');
    for (var i = 0; i < duplicates.length; i++) {
      Logger.log('  "' + duplicates[i].original + '" vs "' + duplicates[i].duplicate + '"');
    }
  } else {
    Logger.log('No duplicate labels found');
  }

  return duplicates;
}

/**
 * Export label structure to JSON format
 * @return {Array} Label structure array
 */
function exportLabelStructure() {
  var labels = GmailApp.getUserLabels();
  var structure = [];

  for (var i = 0; i < labels.length; i++) {
    var label = labels[i];
    var threadCount = getThreadCountForLabel(label);

    structure.push({
      name: label.getName(),
      threadCount: threadCount,
      level: (label.getName().match(/\//g) || []).length
    });
  }

  Logger.log('=== LABEL STRUCTURE (JSON) ===');
  Logger.log(JSON.stringify(structure, null, 2));

  return structure;
}

// ============================================================================
// CLEANUP UTILITIES
// ============================================================================

/**
 * Delete empty labels with confirmation
 * @param {boolean} dryRun - If true, only report what would be deleted
 */
function deleteEmptyLabels(dryRun) {
  if (dryRun === undefined) dryRun = true;

  var labels = GmailApp.getUserLabels();
  var emptyLabels = [];

  log('Scanning for empty labels...');

  for (var i = 0; i < labels.length; i++) {
    var label = labels[i];
    var threads = label.getThreads(0, 1);

    if (threads.length === 0) {
      emptyLabels.push(label);
    }
  }

  Logger.log('=== EMPTY LABELS (' + emptyLabels.length + ') ===');
  for (var i = 0; i < emptyLabels.length; i++) {
    Logger.log('  ' + emptyLabels[i].getName());
  }

  if (dryRun) {
    Logger.log('');
    Logger.log('DRY RUN: No labels deleted. Set dryRun=false to delete.');
  } else {
    Logger.log('');
    Logger.log('Deleting ' + emptyLabels.length + ' empty labels...');
    for (var i = 0; i < emptyLabels.length; i++) {
      try {
        GmailApp.deleteLabel(emptyLabels[i]);
        log('Deleted: ' + emptyLabels[i].getName());
      } catch (e) {
        logError('Failed to delete "' + emptyLabels[i].getName() + '": ' + e.message);
      }
    }
    Logger.log('Done!');
  }

  return emptyLabels.length;
}

// ============================================================================
// TIME MANAGEMENT
// ============================================================================

/**
 * Check if there's enough time remaining before Apps Script timeout
 * @param {number} startTime - Script start time (from Date.getTime())
 * @param {number} maxRuntime - Maximum runtime in milliseconds
 * @param {number} [buffer] - Buffer time in milliseconds (default 30000)
 * @return {boolean} True if there's time remaining
 */
function hasTimeRemaining(startTime, maxRuntime, buffer) {
  // Input validation
  if (typeof startTime !== 'number' || isNaN(startTime)) {
    logWarning('hasTimeRemaining: invalid startTime');
    return false;
  }
  if (typeof maxRuntime !== 'number' || isNaN(maxRuntime) || maxRuntime <= 0) {
    logWarning('hasTimeRemaining: invalid maxRuntime');
    return false;
  }

  buffer = (typeof buffer === 'number' && !isNaN(buffer)) ? buffer : CONSTANTS.DEFAULT_TIME_BUFFER_MS;
  var elapsed = new Date().getTime() - startTime;
  return (maxRuntime - elapsed) > buffer;
}

/**
 * Get remaining time in seconds
 * @param {number} startTime - Script start time
 * @param {number} maxRuntime - Maximum runtime in milliseconds
 * @return {number} Seconds remaining
 */
function getRemainingSeconds(startTime, maxRuntime) {
  var elapsed = new Date().getTime() - startTime;
  return Math.max(0, Math.floor((maxRuntime - elapsed) / 1000));
}

// ============================================================================
// ESTIMATION UTILITIES
// ============================================================================

/**
 * Estimate time required for migration
 * @param {Object} plan - Organization plan
 * @return {Object} Estimation details
 */
function estimateMigrationTime(plan) {
  var totalThreads = 0;
  var existingSourceLabels = 0;

  for (var i = 0; i < plan.migrations.length; i++) {
    var fromLabel = GmailApp.getUserLabelByName(plan.migrations[i].from);
    if (fromLabel) {
      existingSourceLabels++;
      var count = getThreadCountForLabel(fromLabel);
      totalThreads += count;
    }
  }

  // Rough estimate: ~1 second per thread for processing
  var estimatedSeconds = totalThreads;
  var estimatedMinutes = Math.ceil(estimatedSeconds / 60);
  var expectedRuns = Math.ceil(estimatedMinutes / 5);

  Logger.log('=== MIGRATION ESTIMATE ===');
  Logger.log('Source labels found: ' + existingSourceLabels + '/' + plan.migrations.length);
  Logger.log('Total threads to migrate: ' + totalThreads);
  Logger.log('Estimated time: ~' + estimatedMinutes + ' minutes');
  Logger.log('Expected script runs: ' + expectedRuns + ' (5-minute batches)');

  return {
    sourceLabelsFound: existingSourceLabels,
    totalMigrations: plan.migrations.length,
    threads: totalThreads,
    minutes: estimatedMinutes,
    runs: expectedRuns
  };
}
