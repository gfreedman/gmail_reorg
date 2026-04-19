/**
 * Gmail Reorganization - Example Scripts
 *
 * This file contains ready-to-use example functions.
 * Copy and modify these for your specific needs.
 *
 * REQUIRES: utils.gs (must be loaded first)
 */

// ============================================================================
// QUICK START EXAMPLES
// ============================================================================

/**
 * EXAMPLE 1: Quick Health Check
 * Run this first to understand your Gmail's current state.
 * Provides recommendations based on your label count and structure.
 */
function example_healthCheck()
{
  Logger.log('=== GMAIL HEALTH CHECK ===');
  Logger.log('');

  const labels = GmailApp.getUserLabels();
  const totalLabels = labels.length;

  let emptyCount = 0;
  let totalThreads = 0;
  let largestLabel = '';
  let largestCount = 0;

  // Scan all labels
  for (let i = 0; i < labels.length; i++)
  {
    const count = getThreadCountForLabel(labels[i]);
    totalThreads += count;

    if (count === 0)
    {
      emptyCount++;
    }

    if (count > largestCount)
    {
      largestCount = count;
      largestLabel = labels[i].getName();
    }
  }

  Logger.log('Total labels: ' + totalLabels);
  Logger.log('Empty labels: ' + emptyCount);
  Logger.log('Total threads (with overlap): ' + totalThreads);
  Logger.log('Largest label: "' + largestLabel + '" (' + largestCount + ' threads)');
  Logger.log('');

  // Provide recommendations
  Logger.log('=== RECOMMENDATIONS ===');

  if (totalLabels > 50)
  {
    Logger.log('- You have many labels. Consider consolidating into 5-10 categories.');
  }

  if (emptyCount > 10)
  {
    Logger.log('- You have ' + emptyCount + ' empty labels. Run deleteEmptyLabels(true) to review.');
  }

  if (totalLabels <= 20)
  {
    Logger.log('- Your label count is manageable. Minor reorganization may suffice.');
  }

  Logger.log('');
  Logger.log('Next steps:');
  Logger.log('1. Run analyzeLabelStructure() for detailed analysis');
  Logger.log('2. Run createLabelSummary() to export to spreadsheet');
}

/**
 * EXAMPLE 2: Find Large Labels
 * Identify labels that might need to be split up.
 * Large labels often benefit from subcategories.
 */
function example_findLargeLabels()
{
  const THRESHOLD = 100;  // Labels with more than this many threads

  Logger.log('=== LARGE LABELS (>' + THRESHOLD + ' threads) ===');
  Logger.log('');

  const labels = GmailApp.getUserLabels();
  const largeLabels = [];

  // Find labels exceeding threshold
  for (let i = 0; i < labels.length; i++)
  {
    const count = getThreadCountForLabel(labels[i]);
    if (count > THRESHOLD)
    {
      largeLabels.push({
        name: labels[i].getName(),
        count: count
      });
    }
  }

  // Sort by count descending
  largeLabels.sort(function(a, b)
  {
    return b.count - a.count;
  });

  if (largeLabels.length === 0)
  {
    Logger.log('No labels exceed ' + THRESHOLD + ' threads.');
  }
  else
  {
    for (let i = 0; i < largeLabels.length; i++)
    {
      Logger.log(largeLabels[i].count + ' threads: ' + largeLabels[i].name);
    }
  }
}

/**
 * EXAMPLE 3: List Root Labels Only
 * See just your top-level organization.
 * Helps understand your current category structure.
 */
function example_listRootLabels()
{
  Logger.log('=== ROOT-LEVEL LABELS ===');
  Logger.log('');

  const labels = GmailApp.getUserLabels();
  const rootLabels = [];

  // Find labels without slashes (root level)
  for (let i = 0; i < labels.length; i++)
  {
    const name = labels[i].getName();
    if (name.indexOf('/') === -1)
    {
      const count = getThreadCountForLabel(labels[i]);
      rootLabels.push({
        name: name,
        count: count
      });
    }
  }

  // Sort alphabetically
  rootLabels.sort(function(a, b)
  {
    return a.name.localeCompare(b.name);
  });

  for (let i = 0; i < rootLabels.length; i++)
  {
    Logger.log(rootLabels[i].name + ' (' + rootLabels[i].count + ' threads)');
  }

  Logger.log('');
  Logger.log('Total root labels: ' + rootLabels.length);
  Logger.log('Ideal: 5-10 categories');
}

// ============================================================================
// SAMPLE ORGANIZATION PLANS
// ============================================================================

/**
 * EXAMPLE 4: Apply Minimal Organization
 * Creates just 5 top-level categories.
 * Good starting point for simple organization.
 */
function example_minimalPlan()
{
  // Define a minimal organization plan
  const minimalPlan =
  {
    newLabels:
    [
      'Personal',
      'Work',
      'Finance',
      'Shopping',
      'Archive'
    ],
    migrations:
    [
      // Add your specific migrations here
      // {from: 'YourOldLabel', to: 'Personal'},
    ]
  };

  // Preview the plan
  Logger.log('=== MINIMAL ORGANIZATION PLAN ===');
  Logger.log('');
  Logger.log('This plan creates 5 simple categories:');

  for (let i = 0; i < minimalPlan.newLabels.length; i++)
  {
    Logger.log('  - ' + minimalPlan.newLabels[i]);
  }

  Logger.log('');
  Logger.log('To use this plan:');
  Logger.log('1. Copy the minimalPlan object to ORGANIZATION_PLAN in reorganization.gs');
  Logger.log('2. Add your migration rules');
  Logger.log('3. Run validatePlan() then main()');
}

/**
 * EXAMPLE 5: Year-Based Archive Structure
 * For organizing historical emails by year.
 * Useful for long-term email archival.
 */
function example_yearBasedArchive()
{
  const currentYear = new Date().getFullYear();
  const years = [];

  // Generate labels for last 5 years
  for (let i = 0; i < 5; i++)
  {
    years.push('Archive/' + (currentYear - i));
  }
  years.push('Archive/Older');

  Logger.log('=== YEAR-BASED ARCHIVE STRUCTURE ===');
  Logger.log('');
  Logger.log('Suggested archive labels:');

  for (let i = 0; i < years.length; i++)
  {
    Logger.log('  - ' + years[i]);
  }

  Logger.log('');
  Logger.log('Add these to your ORGANIZATION_PLAN.newLabels');
}

// ============================================================================
// CLEANUP EXAMPLES
// ============================================================================

/**
 * EXAMPLE 6: Preview Empty Label Cleanup
 * Shows what deleteEmptyLabels would remove.
 * Safe preview mode - no changes made.
 */
function example_previewEmptyCleanup()
{
  deleteEmptyLabels(true);  // true = dry run
}

/**
 * EXAMPLE 7: Find Orphaned Nested Labels
 * Labels whose parents don't exist.
 * These can cause confusion in the Gmail interface.
 */
function example_findOrphanedLabels()
{
  Logger.log('=== ORPHANED LABELS CHECK ===');
  Logger.log('');

  const labels = GmailApp.getUserLabels();
  const labelNames = {};

  // Build set of all label names
  for (let i = 0; i < labels.length; i++)
  {
    labelNames[labels[i].getName()] = true;
  }

  // Find orphans (nested labels with missing parents)
  const orphans = [];
  for (let i = 0; i < labels.length; i++)
  {
    const name = labels[i].getName();
    const lastSlash = name.lastIndexOf('/');

    if (lastSlash > 0)
    {
      const parent = name.substring(0, lastSlash);
      if (!labelNames[parent])
      {
        orphans.push({
          label: name,
          missingParent: parent
        });
      }
    }
  }

  if (orphans.length === 0)
  {
    Logger.log('No orphaned labels found.');
  }
  else
  {
    Logger.log('Found ' + orphans.length + ' orphaned labels:');
    for (let i = 0; i < orphans.length; i++)
    {
      Logger.log('  "' + orphans[i].label + '" (parent "' + orphans[i].missingParent + '" missing)');
    }
  }
}

// ============================================================================
// MIGRATION HELPERS
// ============================================================================

/**
 * EXAMPLE 8: Generate Migration Rules from Pattern
 * Migrate all labels matching a pattern to a destination.
 * Useful for bulk reorganization.
 */
function example_generatePatternMigrations()
{
  const PATTERN = 'Old';         // Labels containing this string
  const DESTINATION = 'Archive'; // Where to migrate them

  Logger.log('=== PATTERN-BASED MIGRATION GENERATOR ===');
  Logger.log('');
  Logger.log('Finding labels containing: "' + PATTERN + '"');
  Logger.log('');

  const labels = GmailApp.getUserLabels();
  const matches = [];

  // Find matching labels
  for (let i = 0; i < labels.length; i++)
  {
    const name = labels[i].getName();
    if (name.toLowerCase().indexOf(PATTERN.toLowerCase()) > -1)
    {
      const count = getThreadCountForLabel(labels[i]);
      matches.push({
        name: name,
        count: count
      });
    }
  }

  if (matches.length === 0)
  {
    Logger.log('No labels match the pattern.');
  }
  else
  {
    Logger.log('Add these to your migrations array:');
    Logger.log('');
    for (let i = 0; i < matches.length; i++)
    {
      Logger.log("  {from: '" + matches[i].name + "', to: '" + DESTINATION + "'}, // " + matches[i].count + ' threads');
    }
  }
}

/**
 * EXAMPLE 9: Count Threads by Category Pattern
 * See how many threads would go to each category.
 * Uses CATEGORY_PATTERNS from analysis.gs for consistency.
 */
function example_categoryDistribution()
{
  Logger.log('=== ESTIMATED CATEGORY DISTRIBUTION ===');
  Logger.log('');

  const labels = GmailApp.getUserLabels();
  const results = {};

  // Initialize results from authoritative CATEGORY_PATTERNS
  for (const cat of Object.keys(CATEGORY_PATTERNS))
  {
    results[cat] = {labels: 0, threads: 0};
  }
  results['other'] = {labels: 0, threads: 0};

  // Categorize each label
  for (let i = 0; i < labels.length; i++)
  {
    const name = labels[i].getName().toLowerCase();
    const count = getThreadCountForLabel(labels[i]);
    let matched = false;

    for (const cat of Object.keys(CATEGORY_PATTERNS))
    {
      const keywords = CATEGORY_PATTERNS[cat].keywords;
      for (let j = 0; j < keywords.length; j++)
      {
        if (name.indexOf(keywords[j]) > -1)
        {
          results[cat].labels++;
          results[cat].threads += count;
          matched = true;
          break;
        }
      }
      if (matched)
      {
        break;
      }
    }

    if (!matched)
    {
      results['other'].labels++;
      results['other'].threads += count;
    }
  }

  // Display results
  for (const cat of Object.keys(results))
  {
    Logger.log(cat.toUpperCase() + ': ' + results[cat].labels + ' labels, ~' + results[cat].threads + ' threads');
  }
}

/**
 * EXAMPLE 10: Test Single Migration
 * Dry-run test of moving one label.
 * Use this to verify a migration before adding to your plan.
 */
function example_testSingleMigration()
{
  const FROM_LABEL = 'TestLabel';   // Change this
  const TO_LABEL = 'Archive/Test';  // Change this

  Logger.log('=== SINGLE MIGRATION TEST ===');
  Logger.log('');
  Logger.log('From: "' + FROM_LABEL + '"');
  Logger.log('To: "' + TO_LABEL + '"');
  Logger.log('');

  const fromLabel = GmailApp.getUserLabelByName(FROM_LABEL);

  if (!fromLabel)
  {
    Logger.log('ERROR: Source label "' + FROM_LABEL + '" not found.');
    Logger.log('Run listAllLabelsDetailed() to see your labels.');
    return;
  }

  const threads = getAllThreadsFromLabel(fromLabel);
  Logger.log('Threads to migrate: ' + threads.length);

  if (threads.length > 0)
  {
    Logger.log('');
    Logger.log('Sample threads:');
    for (let i = 0; i < Math.min(5, threads.length); i++)
    {
      Logger.log('  - ' + threads[i].getFirstMessageSubject());
    }
  }

  Logger.log('');
  Logger.log('To execute this migration, add to ORGANIZATION_PLAN.migrations:');
  Logger.log("  {from: '" + FROM_LABEL + "', to: '" + TO_LABEL + "'}");
}
