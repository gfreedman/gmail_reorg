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
 * Used to store migration progress between script runs
 */
const PROPERTY_KEYS =
{
  MIGRATION_STATE: 'gmail_reorg_migration_state',
  LAST_RUN: 'gmail_reorg_last_run',
  COMPLETED_MIGRATIONS: 'gmail_reorg_completed',
  STATISTICS: 'gmail_reorg_stats'
};

/**
 * Gmail reserved label names that cannot be used
 * These are system labels that Gmail protects
 */
const RESERVED_LABELS =
[
  'inbox', 'sent', 'drafts', 'spam', 'trash', 'starred', 'important',
  'chats', 'all', 'unread', 'snoozed', 'scheduled', 'category'
];

/**
 * Characters not allowed in Gmail label names
 * Gmail will reject labels containing these
 */
const INVALID_LABEL_CHARS = ['&', '<', '>', '[', ']', '{', '}'];

/**
 * Numeric constants - avoid magic numbers throughout codebase
 */
const CONSTANTS =
{
  THREAD_BATCH_SIZE: 500,           // Max threads per API call
  DEFAULT_TIME_BUFFER_MS: 30000,    // 30 second safety buffer
  MAX_LABEL_NAME_LENGTH: 225,       // Gmail's limit
  TOP_LABELS_COUNT: 20,             // For display functions
  LOW_USAGE_THRESHOLD: 5,           // Labels with fewer threads
  MAX_DISPLAY_ITEMS: 10             // Limit log output
};

// ============================================================================
// THREAD RETRIEVAL (Single Source of Truth)
// ============================================================================

/**
 * Get all threads from a label, handling pagination automatically.
 * This is the ONLY function that should be used to retrieve threads.
 *
 * @param {GmailLabel|string|null|undefined} labelOrName - The label object or label name string
 * @return {GmailThread[]} All threads with this label, or empty array on error
 */
function getAllThreadsFromLabel(labelOrName)
{
  // Handle null/undefined input gracefully
  if (labelOrName === null || labelOrName === undefined)
  {
    logWarning('getAllThreadsFromLabel called with null/undefined');
    return [];
  }

  let label;

  // Accept either a label object or a string name
  if (typeof labelOrName === 'string')
  {
    if (labelOrName.trim() === '')
    {
      logWarning('getAllThreadsFromLabel called with empty string');
      return [];
    }
    label = GmailApp.getUserLabelByName(labelOrName);
    if (!label)
    {
      return [];
    }
  }
  else if (typeof labelOrName === 'object' && labelOrName !== null)
  {
    label = labelOrName;
  }
  else
  {
    logWarning('getAllThreadsFromLabel called with invalid type: ' + typeof labelOrName);
    return [];
  }

  // Paginate through all threads (Gmail returns max 500 per call)
  const allThreads = [];
  let start = 0;
  const batchSize = CONSTANTS.THREAD_BATCH_SIZE;

  while (true)
  {
    let threads;
    try
    {
      threads = label.getThreads(start, batchSize);
    }
    catch (e)
    {
      logError('Error getting threads from label: ' + e.message);
      break;
    }

    // Exit conditions: no threads returned or fewer than batch size
    if (!threads || threads.length === 0)
    {
      break;
    }
    allThreads.push(...threads);
    if (threads.length < batchSize)
    {
      break;
    }
    start += batchSize;
  }

  return allThreads;
}

/**
 * Get thread count for a label (more efficient than getting all threads).
 * Uses a shortcut: if first batch is small, we have the count.
 *
 * @param {GmailLabel|string|null|undefined} labelOrName - The label object or label name
 * @return {number} Thread count, 0 if label not found, -1 on error
 */
function getThreadCountForLabel(labelOrName)
{
  // Handle null/undefined
  if (labelOrName === null || labelOrName === undefined)
  {
    return 0;
  }

  let label;

  // Accept either label object or string name
  if (typeof labelOrName === 'string')
  {
    if (labelOrName.trim() === '')
    {
      return 0;
    }
    label = GmailApp.getUserLabelByName(labelOrName);
    if (!label)
    {
      return 0;
    }
  }
  else if (typeof labelOrName === 'object' && labelOrName !== null)
  {
    label = labelOrName;
  }
  else
  {
    return 0;
  }

  try
  {
    // Optimization: if first batch is smaller than max, that's the total
    const threads = label.getThreads(0, CONSTANTS.THREAD_BATCH_SIZE);
    if (!threads)
    {
      return 0;
    }
    if (threads.length < CONSTANTS.THREAD_BATCH_SIZE)
    {
      return threads.length;
    }
    // Otherwise, need to count all (slower path)
    return getAllThreadsFromLabel(label).length;
  }
  catch (e)
  {
    logError('Error counting threads: ' + e.message);
    return -1;
  }
}

// ============================================================================
// LOGGING UTILITIES
// ============================================================================

/**
 * Log an info message with timestamp
 * @param {string} message - Message to log
 */
function log(message)
{
  Logger.log(formatTimestamp() + ' [INFO] ' + message);
}

/**
 * Log an error message with timestamp
 * @param {string} message - Error message to log
 */
function logError(message)
{
  Logger.log(formatTimestamp() + ' [ERROR] ' + message);
}

/**
 * Log a warning message with timestamp
 * @param {string} message - Warning message to log
 */
function logWarning(message)
{
  Logger.log(formatTimestamp() + ' [WARN] ' + message);
}

/**
 * Format current timestamp for logging in ISO format
 * @return {string} Formatted timestamp
 */
function formatTimestamp()
{
  return new Date().toISOString();
}

// ============================================================================
// RETRY HELPERS
// ============================================================================

/**
 * Execute a function with retry on transient errors.
 * Exponential backoff with jitter: baseDelay, 2x, 4x, 8x... plus 0-500ms jitter.
 * Non-transient errors throw immediately; final transient error after exhausted
 * attempts also throws.
 *
 * When opts.runStartTime and opts.maxRuntimeMs are provided, the helper aborts
 * a retry (re-throws) if the next backoff would push past the runtime budget.
 * This prevents retries from silently eating the Apps Script execution buffer.
 *
 * @param {Function} fn - The operation to execute. May be called multiple times.
 * @param {string} description - Human-readable description for log messages.
 * @param {Object} [opts] - Optional configuration.
 * @param {number} [opts.maxAttempts] - Max attempts (default: CONFIG.MAX_RETRIES or 4).
 * @param {number} [opts.baseDelayMs] - Initial backoff delay (default: CONFIG.RETRY_BASE_DELAY_MS or 1000).
 * @param {number} [opts.runStartTime] - Run start timestamp (ms) for budget enforcement.
 * @param {number} [opts.maxRuntimeMs] - Run budget (ms) for budget enforcement.
 * @param {Function} [opts.onRetry] - Callback(attempt, error, delayMs) invoked before each backoff sleep.
 * @return {*} Return value of fn on success.
 */
function withRetry(fn, description, opts)
{
  opts = opts || {};
  const maxAttempts = opts.maxAttempts || (typeof CONFIG !== 'undefined' && CONFIG.MAX_RETRIES) || 4;
  const baseDelayMs = opts.baseDelayMs || (typeof CONFIG !== 'undefined' && CONFIG.RETRY_BASE_DELAY_MS) || 1000;
  const runStartTime = opts.runStartTime;
  const maxRuntimeMs = opts.maxRuntimeMs;
  const onRetry = opts.onRetry;

  for (let attempt = 1; attempt <= maxAttempts; attempt++)
  {
    try
    {
      return fn();
    }
    catch (e)
    {
      if (!isTransientError(e) || attempt === maxAttempts)
      {
        throw e;
      }

      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500);

      if (runStartTime && maxRuntimeMs)
      {
        const elapsed = new Date().getTime() - runStartTime;
        const remaining = maxRuntimeMs - elapsed;
        if (delay >= remaining)
        {
          logWarning('Aborting retry of ' + description +
                     ': backoff (' + delay + 'ms) exceeds remaining runtime (' + remaining + 'ms). ' +
                     'Re-run main() to continue.');
          throw e;
        }
      }

      logWarning('Transient error during ' + description +
                 ' (attempt ' + attempt + '/' + maxAttempts + '): ' +
                 e.message + '. Retrying in ' + delay + 'ms');

      if (onRetry)
      {
        try { onRetry(attempt, e, delay); } catch (_) { /* never let telemetry break flow */ }
      }

      Utilities.sleep(delay);
    }
  }

  // Defensive: loop body either returns or throws on every iteration. This is unreachable.
  throw new Error('withRetry: exhausted attempts without resolving — internal invariant violated');
}

/**
 * Detect whether an error is transient (worth retrying) versus permanent.
 * Matches common Gmail/Apps Script API failure signatures.
 *
 * @param {Error|Object} e - The thrown error.
 * @return {boolean} True if the error is retryable.
 */
function isTransientError(e)
{
  const msg = ((e && e.message) || '').toLowerCase();
  return msg.indexOf('503') !== -1 ||
         msg.indexOf('500') !== -1 ||
         msg.indexOf('429') !== -1 ||
         msg.indexOf('service invoked too many times') !== -1 ||
         msg.indexOf('rate limit') !== -1 ||
         msg.indexOf('backend error') !== -1 ||
         msg.indexOf('temporarily unavailable') !== -1 ||
         msg.indexOf('timed out') !== -1 ||
         msg.indexOf('timeout') !== -1;
}

// ============================================================================
// STATE PERSISTENCE
// ============================================================================

/**
 * Save migration state for resume capability.
 * Allows long migrations to continue after Apps Script timeout.
 *
 * @param {Object} state - State object to save
 */
function saveMigrationState(state)
{
  const props = PropertiesService.getScriptProperties();
  props.setProperty(PROPERTY_KEYS.MIGRATION_STATE, JSON.stringify(state));
  props.setProperty(PROPERTY_KEYS.LAST_RUN, new Date().toISOString());
}

/**
 * Load saved migration state from previous run.
 *
 * @return {Object|null} Saved state or null if none exists
 */
function loadMigrationState()
{
  const props = PropertiesService.getScriptProperties();
  const stateJson = props.getProperty(PROPERTY_KEYS.MIGRATION_STATE);

  if (!stateJson)
  {
    return null;
  }

  try
  {
    return JSON.parse(stateJson);
  }
  catch (e)
  {
    logError('Failed to parse migration state: ' + e.message);
    return null;
  }
}

/**
 * Clear saved migration state (call after successful completion)
 */
function clearMigrationState()
{
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROPERTY_KEYS.MIGRATION_STATE);
  log('Migration state cleared');
}

/**
 * Mark a migration as completed.
 * Uses retry logic to handle concurrent modifications.
 *
 * @param {string} fromLabel - Source label name
 * @param {string} toLabel - Destination label name
 * @param {number} threadCount - Number of threads migrated
 * @return {boolean} True if successfully saved
 */
function markMigrationCompleted(fromLabel, toLabel, threadCount)
{
  // Validate required parameters
  if (!fromLabel || !toLabel)
  {
    logError('markMigrationCompleted: missing required parameters');
    return false;
  }

  const props = PropertiesService.getScriptProperties();
  const maxRetries = 3;

  // Retry loop for concurrent modification handling
  for (let attempt = 0; attempt < maxRetries; attempt++)
  {
    try
    {
      const completedJson = props.getProperty(PROPERTY_KEYS.COMPLETED_MIGRATIONS) || '[]';
      const completed = JSON.parse(completedJson);

      // Check if already exists to prevent duplicates
      const exists = completed.some(function(m)
      {
        return m.from === fromLabel && m.to === toLabel;
      });

      if (!exists)
      {
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
    }
    catch (e)
    {
      if (attempt === maxRetries - 1)
      {
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
 * Check if a migration has already been completed.
 *
 * @param {string} fromLabel - Source label name
 * @return {boolean} True if already completed
 */
function isMigrationCompleted(fromLabel)
{
  const props = PropertiesService.getScriptProperties();
  const completedJson = props.getProperty(PROPERTY_KEYS.COMPLETED_MIGRATIONS) || '[]';

  try
  {
    const completed = JSON.parse(completedJson);
    return completed.some(function(m)
    {
      return m.from === fromLabel;
    });
  }
  catch (e)
  {
    return false;
  }
}

/**
 * Get all completed migrations.
 *
 * @return {Array} List of completed migrations
 */
function getCompletedMigrations()
{
  const props = PropertiesService.getScriptProperties();
  const completedJson = props.getProperty(PROPERTY_KEYS.COMPLETED_MIGRATIONS) || '[]';

  try
  {
    return JSON.parse(completedJson);
  }
  catch (e)
  {
    return [];
  }
}

/**
 * Reset all migration tracking (use with caution!)
 * This clears ALL progress and statistics.
 */
function resetAllMigrationTracking()
{
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROPERTY_KEYS.MIGRATION_STATE);
  props.deleteProperty(PROPERTY_KEYS.COMPLETED_MIGRATIONS);
  props.deleteProperty(PROPERTY_KEYS.STATISTICS);
  log('All migration tracking has been reset');
}

// ============================================================================
// STATISTICS TRACKING
// ============================================================================

/**
 * Update migration statistics after a batch run.
 *
 * @param {number} threadsProcessed - Number of threads processed in this batch
 * @param {number} labelsCreated - Number of labels created
 */
function updateStatistics(threadsProcessed, labelsCreated)
{
  const props = PropertiesService.getScriptProperties();
  const statsJson = props.getProperty(PROPERTY_KEYS.STATISTICS) || '{}';

  try
  {
    const stats = JSON.parse(statsJson);
    stats.totalThreadsProcessed = (stats.totalThreadsProcessed || 0) + threadsProcessed;
    stats.totalLabelsCreated = (stats.totalLabelsCreated || 0) + labelsCreated;
    stats.lastUpdated = new Date().toISOString();
    stats.runCount = (stats.runCount || 0) + 1;
    props.setProperty(PROPERTY_KEYS.STATISTICS, JSON.stringify(stats));
  }
  catch (e)
  {
    logError('Failed to update statistics: ' + e.message);
  }
}

/**
 * Get current migration statistics.
 *
 * @return {Object} Statistics object
 */
function getStatistics()
{
  const props = PropertiesService.getScriptProperties();
  const statsJson = props.getProperty(PROPERTY_KEYS.STATISTICS) || '{}';

  try
  {
    return JSON.parse(statsJson);
  }
  catch (e)
  {
    return {};
  }
}

/**
 * Display migration statistics summary to the log.
 */
function showStatistics()
{
  const stats = getStatistics();
  const completed = getCompletedMigrations();

  Logger.log('=== MIGRATION STATISTICS ===');
  Logger.log('Total script runs: ' + (stats.runCount || 0));
  Logger.log('Total threads processed: ' + (stats.totalThreadsProcessed || 0));
  Logger.log('Total labels created: ' + (stats.totalLabelsCreated || 0));
  Logger.log('Completed migrations: ' + completed.length);
  Logger.log('Last updated: ' + (stats.lastUpdated || 'Never'));
  Logger.log('');

  if (completed.length > 0)
  {
    Logger.log('=== COMPLETED MIGRATIONS ===');
    for (let i = 0; i < completed.length; i++)
    {
      const m = completed[i];
      Logger.log('  "' + m.from + '" -> "' + m.to + '" (' + m.threads + ' threads)');
    }
  }
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Test if a label name is valid for Gmail.
 * Checks for reserved words, invalid characters, and length limits.
 *
 * @param {*} labelName - Label name to validate (will be converted to string)
 * @return {Object} {valid: boolean, reason: string|null}
 */
function validateLabelName(labelName)
{
  // Handle null/undefined
  if (labelName === null || labelName === undefined)
  {
    return {valid: false, reason: 'Label name cannot be null or undefined'};
  }

  // Convert to string if needed
  const nameStr = String(labelName);

  // Check for empty string
  if (nameStr.trim().length === 0)
  {
    return {valid: false, reason: 'Label name cannot be empty'};
  }

  const normalized = nameStr.toLowerCase().trim();

  // Check for reserved words (case-insensitive)
  for (let i = 0; i < RESERVED_LABELS.length; i++)
  {
    if (normalized === RESERVED_LABELS[i])
    {
      return {valid: false, reason: '"' + nameStr + '" is a reserved Gmail label'};
    }
  }

  // Check for invalid characters
  for (let i = 0; i < INVALID_LABEL_CHARS.length; i++)
  {
    if (nameStr.indexOf(INVALID_LABEL_CHARS[i]) > -1)
    {
      return {valid: false, reason: 'Label contains invalid character: ' + INVALID_LABEL_CHARS[i]};
    }
  }

  // Check length limit (Gmail has a 225 character limit)
  if (nameStr.length > CONSTANTS.MAX_LABEL_NAME_LENGTH)
  {
    return {valid: false, reason: 'Label name exceeds ' + CONSTANTS.MAX_LABEL_NAME_LENGTH + ' character limit'};
  }

  return {valid: true, reason: null};
}

/**
 * Validate an organization plan before execution.
 * Checks structure, label names, and migration rules.
 *
 * @param {Object} plan - The organization plan to validate
 * @return {Object} {valid: boolean, errors: string[], warnings: string[]}
 */
function validateOrganizationPlan(plan)
{
  const errors = [];
  const warnings = [];

  // Check plan exists
  if (!plan)
  {
    errors.push('Organization plan is null or undefined');
    return {valid: false, errors: errors, warnings: warnings};
  }

  // Check required arrays exist
  if (!plan.newLabels || !Array.isArray(plan.newLabels))
  {
    errors.push('Plan must have a "newLabels" array');
  }

  if (!plan.migrations || !Array.isArray(plan.migrations))
  {
    errors.push('Plan must have a "migrations" array');
  }

  // Return early if structure is invalid
  if (errors.length > 0)
  {
    return {valid: false, errors: errors, warnings: warnings};
  }

  // Validate each new label name
  for (let i = 0; i < plan.newLabels.length; i++)
  {
    const validation = validateLabelName(plan.newLabels[i]);
    if (!validation.valid)
    {
      errors.push('Invalid new label "' + plan.newLabels[i] + '": ' + validation.reason);
    }
  }

  // Validate each migration rule
  for (let i = 0; i < plan.migrations.length; i++)
  {
    const migration = plan.migrations[i];

    // Check required fields
    if (!migration.from)
    {
      errors.push('Migration ' + i + ' is missing "from" field');
      continue;
    }

    if (!migration.to)
    {
      errors.push('Migration ' + i + ' is missing "to" field');
      continue;
    }

    // Check if source label exists
    const sourceLabel = GmailApp.getUserLabelByName(migration.from);
    if (!sourceLabel)
    {
      warnings.push('Source label "' + migration.from + '" does not exist (will be skipped)');
    }

    // Validate destination label name
    const destValidation = validateLabelName(migration.to);
    if (!destValidation.valid)
    {
      errors.push('Invalid destination label "' + migration.to + '": ' + destValidation.reason);
    }

    // Check if destination is in newLabels or already exists
    const destExists = GmailApp.getUserLabelByName(migration.to);
    const destInPlan = plan.newLabels.indexOf(migration.to) > -1;
    if (!destExists && !destInPlan)
    {
      warnings.push('Destination "' + migration.to + '" not in newLabels (will be created during migration)');
    }
  }

  // Check for duplicate migrations (same source label twice)
  // Null-prototype map: the keys below come from message headers or label names,
  // which are outside our control. On a plain object a key of __proto__ or
  // constructor resolves to something on Object.prototype instead of a own
  // property, silently corrupting the tally.
  const seenFrom = Object.create(null);
  for (let i = 0; i < plan.migrations.length; i++)
  {
    const from = plan.migrations[i].from;
    if (seenFrom[from])
    {
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
 * List all labels with detailed information (name and thread count).
 */
function listAllLabelsDetailed()
{
  const labels = GmailApp.getUserLabels();
  const labelData = [];

  log('Scanning ' + labels.length + ' labels...');

  for (let i = 0; i < labels.length; i++)
  {
    const label = labels[i];
    const name = label.getName();
    const threadCount = getThreadCountForLabel(label);

    labelData.push({
      name: name,
      threads: threadCount
    });
  }

  // Sort alphabetically by name
  labelData.sort(function(a, b)
  {
    return a.name.localeCompare(b.name);
  });

  Logger.log('=== ALL GMAIL LABELS ===');
  for (let i = 0; i < labelData.length; i++)
  {
    Logger.log('"' + labelData[i].name + '": ' + labelData[i].threads + ' threads');
  }
  Logger.log('=== TOTAL: ' + labelData.length + ' labels ===');

  return labelData;
}

/**
 * Find duplicate labels (case-insensitive comparison).
 *
 * @return {Array} Array of duplicate pairs
 */
function findDuplicateLabels()
{
  const labels = GmailApp.getUserLabels();
  // Null-prototype map: the keys below come from message headers or label names,
  // which are outside our control. On a plain object a key of __proto__ or
  // constructor resolves to something on Object.prototype instead of a own
  // property, silently corrupting the tally.
  const seen = Object.create(null);
  const duplicates = [];

  for (let i = 0; i < labels.length; i++)
  {
    const name = labels[i].getName().toLowerCase();
    if (seen[name])
    {
      duplicates.push({
        original: seen[name],
        duplicate: labels[i].getName()
      });
    }
    else
    {
      seen[name] = labels[i].getName();
    }
  }

  if (duplicates.length > 0)
  {
    Logger.log('=== DUPLICATE LABELS FOUND ===');
    for (let i = 0; i < duplicates.length; i++)
    {
      Logger.log('  "' + duplicates[i].original + '" vs "' + duplicates[i].duplicate + '"');
    }
  }
  else
  {
    Logger.log('No duplicate labels found');
  }

  return duplicates;
}

/**
 * Export label structure to JSON format for external analysis.
 *
 * @return {Array} Label structure array
 */
function exportLabelStructure()
{
  const labels = GmailApp.getUserLabels();
  const structure = [];

  for (let i = 0; i < labels.length; i++)
  {
    const label = labels[i];
    const threadCount = getThreadCountForLabel(label);

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
 * Delete empty labels with confirmation.
 * Use dryRun=true to preview, dryRun=false to actually delete.
 *
 * @param {boolean} dryRun - If true, only report what would be deleted
 */
function deleteEmptyLabels(dryRun)
{
  // Default to dry run for safety
  if (dryRun === undefined)
  {
    dryRun = true;
  }

  const labels = GmailApp.getUserLabels();
  const emptyLabels = [];

  log('Scanning for empty labels...');

  for (let i = 0; i < labels.length; i++)
  {
    const label = labels[i];
    const threads = label.getThreads(0, 1);

    if (threads.length === 0)
    {
      emptyLabels.push(label);
    }
  }

  Logger.log('=== EMPTY LABELS (' + emptyLabels.length + ') ===');
  for (let i = 0; i < emptyLabels.length; i++)
  {
    Logger.log('  ' + emptyLabels[i].getName());
  }

  if (dryRun)
  {
    Logger.log('');
    Logger.log('DRY RUN: No labels deleted. Set dryRun=false to delete.');
  }
  else
  {
    Logger.log('');
    Logger.log('Deleting ' + emptyLabels.length + ' empty labels...');
    for (let i = 0; i < emptyLabels.length; i++)
    {
      try
      {
        GmailApp.deleteLabel(emptyLabels[i]);
        log('Deleted: ' + emptyLabels[i].getName());
      }
      catch (e)
      {
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
 * Check if there's enough time remaining before Apps Script timeout.
 * Apps Script has a 6-minute limit; we use a buffer to stop gracefully.
 *
 * @param {number} startTime - Script start time (from Date.getTime())
 * @param {number} maxRuntime - Maximum runtime in milliseconds
 * @param {number} [buffer] - Buffer time in milliseconds (default 30000)
 * @return {boolean} True if there's time remaining
 */
function hasTimeRemaining(startTime, maxRuntime, buffer)
{
  // Validate startTime
  if (typeof startTime !== 'number' || isNaN(startTime))
  {
    logWarning('hasTimeRemaining: invalid startTime');
    return false;
  }

  // Validate maxRuntime
  if (typeof maxRuntime !== 'number' || isNaN(maxRuntime) || maxRuntime <= 0)
  {
    logWarning('hasTimeRemaining: invalid maxRuntime');
    return false;
  }

  const effectiveBuffer = (typeof buffer === 'number' && !isNaN(buffer)) ? buffer : CONSTANTS.DEFAULT_TIME_BUFFER_MS;
  const elapsed = new Date().getTime() - startTime;
  return (maxRuntime - elapsed) > effectiveBuffer;
}

/**
 * Get remaining time in seconds.
 *
 * @param {number} startTime - Script start time
 * @param {number} maxRuntime - Maximum runtime in milliseconds
 * @return {number} Seconds remaining (never negative)
 */
function getRemainingSeconds(startTime, maxRuntime)
{
  const elapsed = new Date().getTime() - startTime;
  return Math.max(0, Math.floor((maxRuntime - elapsed) / 1000));
}

// ============================================================================
// ESTIMATION UTILITIES
// ============================================================================

/**
 * Estimate time required for migration.
 * Helps users understand how long the migration will take.
 *
 * @param {Object} plan - Organization plan
 * @return {Object} Estimation details
 */
function estimateMigrationTime(plan)
{
  let totalThreads = 0;
  let existingSourceLabels = 0;

  // Count threads in all source labels
  for (let i = 0; i < plan.migrations.length; i++)
  {
    const fromLabel = GmailApp.getUserLabelByName(plan.migrations[i].from);
    if (fromLabel)
    {
      existingSourceLabels++;
      const count = getThreadCountForLabel(fromLabel);
      totalThreads += count;
    }
  }

  // Rough estimate: ~1 second per thread for processing
  const estimatedSeconds = totalThreads;
  const estimatedMinutes = Math.ceil(estimatedSeconds / 60);
  const expectedRuns = Math.ceil(estimatedMinutes / 5);

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
