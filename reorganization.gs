/**
 * Gmail Reorganization Script
 * Safely reorganizes Gmail labels according to a defined plan
 *
 * REQUIRES: utils.gs (must be loaded first)
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Main configuration - modify these for your needs
 */
const CONFIG =
{
  // SAFETY: Set to false only when ready to execute live migration
  DRY_RUN: true,

  // Number of threads to process in each batch operation
  BATCH_SIZE: 100,

  // Maximum runtime in milliseconds (5 minutes, leaving buffer for 6min Apps Script limit)
  MAX_RUNTIME_MS: 300000,

  // Whether to skip already-completed migrations (uses state persistence)
  SKIP_COMPLETED: true,

  // Whether to show detailed progress logs
  VERBOSE: true
};

// ============================================================================
// ORGANIZATION PLAN
// ============================================================================

/**
 * Define your organization plan here.
 * This is a TEMPLATE - customize it to match YOUR Gmail labels.
 *
 * EXAMPLE PLANS are in the README and in examples.gs for reference.
 */
const ORGANIZATION_PLAN =
{
  // New label structure to create
  // These will be created before any migrations run
  newLabels:
  [
    // === EXAMPLE: Personal Life ===
    'Personal',
    'Personal/Family',
    'Personal/Friends',
    'Personal/Health',
    'Personal/Hobbies',

    // === EXAMPLE: Work ===
    'Work',
    'Work/Current Projects',
    'Work/Clients',
    'Work/Team',
    'Work/Job Search',

    // === EXAMPLE: Finance ===
    'Finance',
    'Finance/Banking',
    'Finance/Investments',
    'Finance/Bills',
    'Finance/Taxes',

    // === EXAMPLE: Shopping & Orders ===
    'Shopping',
    'Shopping/Orders',
    'Shopping/Receipts',
    'Shopping/Returns',

    // === EXAMPLE: Travel ===
    'Travel',
    'Travel/Upcoming',
    'Travel/Past Trips',
    'Travel/Bookings',

    // === EXAMPLE: Learning ===
    'Learning',
    'Learning/Courses',
    'Learning/Reading',
    'Learning/Certificates',

    // === EXAMPLE: Archive ===
    'Archive',
    'Archive/Old Projects',
    'Archive/Past Jobs',
    'Archive/Historical',

    // === EXAMPLE: Newsletters ===
    'Newsletters',
    'Newsletters/Keep',
    'Newsletters/Review'
  ],

  // Migration rules: {from: 'old label name', to: 'new label name'}
  //
  // IMPORTANT:
  // - Replace these examples with YOUR actual Gmail label names
  // - Run analyzeLabelStructure() to see your current labels
  // - The 'from' label must exist in your Gmail
  // - The 'to' label will be created if it doesn't exist
  //
  migrations:
  [
    // === EXAMPLE MIGRATIONS (customize these!) ===
    //
    // Personal examples:
    // {from: 'Family', to: 'Personal/Family'},
    // {from: 'Mom and Dad', to: 'Personal/Family'},
    // {from: 'Health/Doctors', to: 'Personal/Health'},
    //
    // Work examples:
    // {from: 'Acme Corp', to: 'Work/Clients'},
    // {from: 'Project Alpha', to: 'Work/Current Projects'},
    // {from: 'Old Job/Company X', to: 'Archive/Past Jobs'},
    //
    // Finance examples:
    // {from: 'Bank Statements', to: 'Finance/Banking'},
    // {from: 'Tax 2023', to: 'Finance/Taxes'},
    // {from: 'PayPal', to: 'Finance/Banking'},
    //
    // Shopping examples:
    // {from: 'Amazon', to: 'Shopping/Orders'},
    // {from: 'Receipts/2023', to: 'Shopping/Receipts'},
    //
    // ADD YOUR MIGRATIONS BELOW:

  ]
};

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Create a fresh batch stats object to avoid global state pollution.
 * Called at the start of each main() run.
 *
 * @return {Object} New batch stats object
 */
function createBatchStats()
{
  return {
    labelsCreated: 0,
    threadsMigrated: 0,
    migrationsCompleted: 0,
    errors: [],
    startTime: new Date().getTime()
  };
}

/**
 * Main entry point for reorganization.
 * Run this function to start or resume the migration.
 */
function main()
{
  // Initialize fresh state for this run
  const batchStats = createBatchStats();

  log('========================================');
  log('GMAIL REORGANIZATION');
  log('========================================');
  log('DRY_RUN mode: ' + CONFIG.DRY_RUN);
  log('Skip completed: ' + CONFIG.SKIP_COMPLETED);
  log('');

  // Step 1: Validate the plan
  if (!runValidation())
  {
    logError('Validation failed. Please fix errors before proceeding.');
    return;
  }

  // Step 2: Create new label structure
  if (hasTimeRemaining(batchStats.startTime, CONFIG.MAX_RUNTIME_MS))
  {
    createNewLabelStructure(batchStats);
  }
  else
  {
    logWarning('Time limit reached after validation. Run again to continue.');
    return;
  }

  // Step 3: Execute migrations
  if (hasTimeRemaining(batchStats.startTime, CONFIG.MAX_RUNTIME_MS))
  {
    migrateLabels(batchStats);
  }
  else
  {
    logWarning('Time limit reached after creating labels. Run again to continue.');
  }

  // Step 4: Show summary
  showBatchSummary(batchStats);

  // Update statistics
  updateStatistics(batchStats.threadsMigrated, batchStats.labelsCreated);
}

/**
 * Validate the organization plan before execution.
 *
 * @return {boolean} True if plan is valid
 */
function runValidation()
{
  log('Step 1: Validating organization plan...');

  const result = validateOrganizationPlan(ORGANIZATION_PLAN);

  if (result.errors.length > 0)
  {
    Logger.log('');
    Logger.log('ERRORS (must fix):');
    for (let i = 0; i < result.errors.length; i++)
    {
      Logger.log('  - ' + result.errors[i]);
    }
  }

  if (result.warnings.length > 0)
  {
    Logger.log('');
    Logger.log('WARNINGS (review):');
    for (let i = 0; i < result.warnings.length; i++)
    {
      Logger.log('  - ' + result.warnings[i]);
    }
  }

  if (result.valid)
  {
    log('Validation passed!');
  }

  Logger.log('');
  return result.valid;
}

/**
 * Create the new label structure defined in the plan.
 *
 * @param {Object} batchStats - Running stats object for this batch
 */
function createNewLabelStructure(batchStats)
{
  log('Step 2: Creating new label structure...');

  let created = 0;
  let skipped = 0;

  for (let i = 0; i < ORGANIZATION_PLAN.newLabels.length; i++)
  {
    // Check time remaining
    if (!hasTimeRemaining(batchStats.startTime, CONFIG.MAX_RUNTIME_MS))
    {
      logWarning('Time limit reached during label creation');
      break;
    }

    const labelName = ORGANIZATION_PLAN.newLabels[i];

    try
    {
      const existing = GmailApp.getUserLabelByName(labelName);

      if (existing)
      {
        if (CONFIG.VERBOSE)
        {
          log('  Already exists: ' + labelName);
        }
        skipped++;
        continue;
      }

      if (!CONFIG.DRY_RUN)
      {
        GmailApp.createLabel(labelName);
        log('  Created: ' + labelName);
        created++;
        batchStats.labelsCreated++;
      }
      else
      {
        log('  [DRY RUN] Would create: ' + labelName);
        created++;
      }
    }
    catch (e)
    {
      logError('Failed to create "' + labelName + '": ' + e.message);
      batchStats.errors.push('Label creation: ' + labelName + ' - ' + e.message);
    }
  }

  log('Label creation complete: ' + created + ' created, ' + skipped + ' already existed');
  Logger.log('');
}

/**
 * Execute label migrations according to the plan.
 *
 * @param {Object} batchStats - Running stats object for this batch
 */
function migrateLabels(batchStats)
{
  log('Step 3: Migrating labels...');

  const migrations = ORGANIZATION_PLAN.migrations;

  if (migrations.length === 0)
  {
    log('No migrations defined. Add migrations to ORGANIZATION_PLAN.migrations');
    return;
  }

  const totalMigrations = migrations.length;
  let completed = 0;
  let skipped = 0;

  for (let i = 0; i < migrations.length; i++)
  {
    // Check time remaining
    if (!hasTimeRemaining(batchStats.startTime, CONFIG.MAX_RUNTIME_MS))
    {
      log('Time limit reached at migration ' + (i + 1) + '/' + totalMigrations);
      saveMigrationState({
        lastMigrationIndex: i,
        timestamp: new Date().toISOString()
      });
      log('State saved. Run main() again to continue.');
      break;
    }

    const migration = migrations[i];

    // Skip if already completed
    if (CONFIG.SKIP_COMPLETED && isMigrationCompleted(migration.from))
    {
      if (CONFIG.VERBOSE)
      {
        log('  Skipping (already completed): ' + migration.from);
      }
      skipped++;
      continue;
    }

    // Execute migration
    const result = migrateSingleLabel(migration.from, migration.to, batchStats);

    if (result.success)
    {
      completed++;
      batchStats.migrationsCompleted++;
      batchStats.threadsMigrated += result.threadCount;

      // Mark as completed for resume capability
      if (!CONFIG.DRY_RUN)
      {
        markMigrationCompleted(migration.from, migration.to, result.threadCount);
      }
    }
  }

  log('Migration batch complete: ' + completed + ' migrated, ' + skipped + ' skipped');
}

/**
 * Migrate a single label from old to new.
 * Applies new label to all threads, then removes old label.
 *
 * @param {string} fromLabelName - Source label name
 * @param {string} toLabelName - Destination label name
 * @param {Object} batchStats - Running stats object for this batch
 * @return {Object} {success: boolean, threadCount: number, error: string}
 */
function migrateSingleLabel(fromLabelName, toLabelName, batchStats)
{
  const result = {success: false, threadCount: 0, error: null};

  // Get source label
  const fromLabel = GmailApp.getUserLabelByName(fromLabelName);
  if (!fromLabel)
  {
    if (CONFIG.VERBOSE)
    {
      logWarning('Source label not found: ' + fromLabelName);
    }
    return result;
  }

  // Get threads from source label
  const threads = getAllThreadsFromLabel(fromLabel);

  if (threads.length === 0)
  {
    if (CONFIG.VERBOSE)
    {
      log('  No threads in: ' + fromLabelName);
    }
    result.success = true;
    return result;
  }

  log('  Migrating ' + threads.length + ' threads: "' + fromLabelName + '" -> "' + toLabelName + '"');

  if (!CONFIG.DRY_RUN)
  {
    try
    {
      // Get or create destination label
      let toLabel = GmailApp.getUserLabelByName(toLabelName);
      if (!toLabel)
      {
        toLabel = GmailApp.createLabel(toLabelName);
        log('    Created destination label: ' + toLabelName);
        batchStats.labelsCreated++;
      }

      // Apply new label in batches
      applyLabelToThreads(threads, toLabel);

      // Remove old label in batches
      removeOldLabel(threads, fromLabel);

      result.success = true;
      result.threadCount = threads.length;

      log('    Completed: ' + threads.length + ' threads migrated');
    }
    catch (e)
    {
      logError('Migration failed for "' + fromLabelName + '": ' + e.message);
      result.error = e.message;
      batchStats.errors.push('Migration: ' + fromLabelName + ' - ' + e.message);
    }
  }
  else
  {
    log('    [DRY RUN] Would migrate ' + threads.length + ' threads');
    result.success = true;
    result.threadCount = threads.length;
  }

  return result;
}

/**
 * Apply a label to threads in batches.
 * Batching prevents API quota exhaustion.
 *
 * @param {GmailThread[]} threads - Threads to label
 * @param {GmailLabel} label - Label to apply
 */
function applyLabelToThreads(threads, label)
{
  for (let i = 0; i < threads.length; i += CONFIG.BATCH_SIZE)
  {
    const batch = threads.slice(i, Math.min(i + CONFIG.BATCH_SIZE, threads.length));
    label.addToThreads(batch);

    if (CONFIG.VERBOSE && threads.length > CONFIG.BATCH_SIZE)
    {
      log('    Applied label to ' + Math.min(i + CONFIG.BATCH_SIZE, threads.length) + '/' + threads.length + ' threads');
    }
  }
}

/**
 * Remove a label from threads in batches.
 *
 * @param {GmailThread[]} threads - Threads to unlabel
 * @param {GmailLabel} label - Label to remove
 */
function removeOldLabel(threads, label)
{
  for (let i = 0; i < threads.length; i += CONFIG.BATCH_SIZE)
  {
    const batch = threads.slice(i, Math.min(i + CONFIG.BATCH_SIZE, threads.length));
    label.removeFromThreads(batch);

    if (CONFIG.VERBOSE && threads.length > CONFIG.BATCH_SIZE)
    {
      log('    Removed label from ' + Math.min(i + CONFIG.BATCH_SIZE, threads.length) + '/' + threads.length + ' threads');
    }
  }
}

/**
 * Show summary of this batch run.
 *
 * @param {Object} batchStats - Stats accumulated during this batch
 */
function showBatchSummary(batchStats)
{
  const elapsed = Math.round((new Date().getTime() - batchStats.startTime) / 1000);

  Logger.log('');
  Logger.log('========================================');
  Logger.log('BATCH SUMMARY');
  Logger.log('========================================');
  Logger.log('Runtime: ' + elapsed + ' seconds');
  Logger.log('Labels created: ' + batchStats.labelsCreated);
  Logger.log('Migrations completed: ' + batchStats.migrationsCompleted);
  Logger.log('Threads migrated: ' + batchStats.threadsMigrated);

  if (batchStats.errors.length > 0)
  {
    Logger.log('');
    Logger.log('ERRORS:');
    for (let i = 0; i < batchStats.errors.length; i++)
    {
      Logger.log('  - ' + batchStats.errors[i]);
    }
  }

  // Check if more work needed
  const completed = getCompletedMigrations();
  const remaining = ORGANIZATION_PLAN.migrations.length - completed.length;

  if (remaining > 0 && !CONFIG.DRY_RUN)
  {
    Logger.log('');
    Logger.log('REMAINING: ' + remaining + ' migrations');
    Logger.log('Run main() again to continue.');
  }
  else if (remaining === 0 && !CONFIG.DRY_RUN)
  {
    Logger.log('');
    Logger.log('ALL MIGRATIONS COMPLETE!');
    clearMigrationState();
  }

  Logger.log('========================================');
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Quick validation of the organization plan.
 * Run this before main() to check for issues.
 */
function validatePlan()
{
  log('Validating ORGANIZATION_PLAN...');

  const result = validateOrganizationPlan(ORGANIZATION_PLAN);

  if (result.errors.length > 0)
  {
    Logger.log('');
    Logger.log('ERRORS:');
    for (let i = 0; i < result.errors.length; i++)
    {
      Logger.log('  - ' + result.errors[i]);
    }
  }

  if (result.warnings.length > 0)
  {
    Logger.log('');
    Logger.log('WARNINGS:');
    for (let i = 0; i < result.warnings.length; i++)
    {
      Logger.log('  - ' + result.warnings[i]);
    }
  }

  Logger.log('');
  Logger.log('Validation result: ' + (result.valid ? 'PASSED' : 'FAILED'));

  return result.valid;
}

/**
 * Preview what migrations would do without executing.
 */
function previewMigrations()
{
  log('=== MIGRATION PREVIEW ===');
  log('');

  const total = ORGANIZATION_PLAN.migrations.length;
  let totalThreads = 0;

  for (let i = 0; i < total; i++)
  {
    const migration = ORGANIZATION_PLAN.migrations[i];
    const fromLabel = GmailApp.getUserLabelByName(migration.from);

    let threadCount = 0;
    let status = '';

    if (!fromLabel)
    {
      status = '[NOT FOUND]';
    }
    else if (isMigrationCompleted(migration.from))
    {
      status = '[COMPLETED]';
    }
    else
    {
      threadCount = getThreadCountForLabel(fromLabel);
      totalThreads += threadCount;
      status = threadCount + ' threads';
    }

    Logger.log((i + 1) + '. "' + migration.from + '" -> "' + migration.to + '" ' + status);
  }

  Logger.log('');
  Logger.log('Total migrations: ' + total);
  Logger.log('Total threads to migrate: ' + totalThreads);

  estimateMigrationTime(ORGANIZATION_PLAN);
}

/**
 * Remove a specific label from all its threads.
 * Useful for cleanup operations.
 *
 * @param {string} labelName - Name of label to clear
 */
function removeLabelFromAll(labelName)
{
  const label = GmailApp.getUserLabelByName(labelName);

  if (!label)
  {
    logError('Label not found: ' + labelName);
    return;
  }

  const threads = getAllThreadsFromLabel(labelName);
  log('Removing "' + labelName + '" from ' + threads.length + ' threads...');

  removeOldLabel(threads, label);
  log('Done!');
}

/**
 * Reset migration tracking to start fresh.
 * Use this if you want to re-run migrations from the beginning.
 */
function resetMigrations()
{
  resetAllMigrationTracking();
  log('Migration tracking has been reset.');
  log('Run main() to start migrations from the beginning.');
}

/**
 * Show current migration progress.
 */
function showProgress()
{
  showStatistics();

  const completed = getCompletedMigrations();
  const total = ORGANIZATION_PLAN.migrations.length;
  const remaining = total - completed.length;

  Logger.log('');
  Logger.log('Plan progress: ' + completed.length + '/' + total + ' migrations completed');
  Logger.log('Remaining: ' + remaining);

  if (remaining > 0)
  {
    Logger.log('');
    Logger.log('Next migrations:');
    let count = 0;
    for (let i = 0; i < ORGANIZATION_PLAN.migrations.length && count < 5; i++)
    {
      const m = ORGANIZATION_PLAN.migrations[i];
      if (!isMigrationCompleted(m.from))
      {
        Logger.log('  - "' + m.from + '" -> "' + m.to + '"');
        count++;
      }
    }
    if (remaining > 5)
    {
      Logger.log('  ... and ' + (remaining - 5) + ' more');
    }
  }
}
