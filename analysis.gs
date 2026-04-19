/**
 * Gmail Label Analysis Script
 * Analyzes current label structure and proposes organization
 *
 * REQUIRES: utils.gs (must be loaded first)
 */

// ============================================================================
// CATEGORY DETECTION PATTERNS
// ============================================================================

/**
 * Common patterns to detect label categories.
 * These are used to suggest organization structure based on label names.
 */
const CATEGORY_PATTERNS =
{
  work:
  {
    keywords: ['work', 'job', 'office', 'client', 'project', 'meeting', 'team', 'company', 'business', 'corporate', 'enterprise', 'hr', 'payroll', 'colleague'],
    domains: ['slack', 'jira', 'asana', 'trello', 'notion', 'confluence', 'teams']
  },
  finance:
  {
    keywords: ['bank', 'finance', 'money', 'payment', 'invoice', 'receipt', 'tax', 'investment', 'stock', 'crypto', 'paypal', 'venmo', 'zelle', 'billing', 'subscription'],
    domains: ['paypal', 'venmo', 'chase', 'wellsfargo', 'bankofamerica', 'citi', 'capitalone', 'amex', 'stripe', 'square']
  },
  personal:
  {
    keywords: ['personal', 'family', 'friend', 'home', 'pet', 'hobby', 'health', 'doctor', 'medical', 'fitness', 'gym'],
    domains: ['facebook', 'instagram', 'twitter', 'linkedin', 'whatsapp']
  },
  shopping:
  {
    keywords: ['order', 'shipping', 'delivery', 'purchase', 'shop', 'store', 'buy', 'cart', 'return', 'refund'],
    domains: ['amazon', 'ebay', 'etsy', 'walmart', 'target', 'bestbuy', 'shopify']
  },
  travel:
  {
    keywords: ['travel', 'flight', 'hotel', 'booking', 'trip', 'vacation', 'airline', 'airport', 'reservation'],
    domains: ['airbnb', 'expedia', 'booking', 'kayak', 'tripadvisor', 'united', 'delta', 'southwest', 'american']
  },
  learning:
  {
    keywords: ['course', 'learn', 'education', 'school', 'university', 'class', 'training', 'tutorial', 'certification', 'study'],
    domains: ['coursera', 'udemy', 'edx', 'skillshare', 'linkedin', 'pluralsight', 'codecademy']
  },
  newsletters:
  {
    keywords: ['newsletter', 'digest', 'weekly', 'daily', 'update', 'subscribe', 'unsubscribe'],
    domains: ['substack', 'mailchimp', 'convertkit', 'buttondown']
  }
};

// ============================================================================
// MAIN ANALYSIS FUNCTIONS
// ============================================================================

/**
 * Analyze current label structure and provide comprehensive insights.
 * This is the main entry point for understanding your Gmail organization.
 */
function analyzeLabelStructure()
{
  log('=== GMAIL LABEL ANALYSIS ===');

  const labels = GmailApp.getUserLabels();
  const labelData = collectLabelData(labels);

  Logger.log('Total labels: ' + labels.length);
  Logger.log('');

  // Display analysis sections
  displayTopLabels(labelData);
  displayLabelHierarchy(labelData);
  displayEmptyLabels(labelData);
  displayPotentialDuplicates(labelData);
  suggestConsolidations(labelData);
  displayCategoryAnalysis(labelData);

  Logger.log('');
  Logger.log('=== RECOMMENDED ORGANIZATION STRUCTURE ===');
  proposeOrganization(labelData);

  return labelData;
}

/**
 * Collect detailed data for all labels.
 * Gathers name, thread count, nesting level, and suggested category.
 *
 * @param {GmailLabel[]} labels - Array of Gmail labels
 * @return {Array} Array of label data objects
 */
function collectLabelData(labels)
{
  const labelData = [];

  log('Collecting data for ' + labels.length + ' labels...');

  for (let i = 0; i < labels.length; i++)
  {
    const label = labels[i];
    const name = label.getName();
    const threadCount = getThreadCountForLabel(label);

    // Calculate nesting level by counting slashes
    const level = (name.match(/\//g) || []).length;

    // Extract parent label (everything before last slash)
    const parent = name.indexOf('/') > -1 ? name.substring(0, name.lastIndexOf('/')) : null;

    // Get the base name (last segment after slash)
    const baseName = name.split('/').pop().toLowerCase();

    // Detect category based on keywords
    const category = detectCategory(baseName);

    labelData.push({
      name: name,
      threadCount: threadCount,
      level: level,
      parent: parent,
      baseName: baseName,
      suggestedCategory: category
    });
  }

  return labelData;
}

/**
 * Detect likely category for a label based on keyword patterns.
 *
 * @param {string} labelName - Label name (lowercase)
 * @return {string|null} Detected category or null if no match
 */
function detectCategory(labelName)
{
  for (const category of Object.keys(CATEGORY_PATTERNS))
  {
    const patterns = CATEGORY_PATTERNS[category];

    // Check keywords
    for (let i = 0; i < patterns.keywords.length; i++)
    {
      if (labelName.indexOf(patterns.keywords[i]) > -1)
      {
        return category;
      }
    }

    // Check domains
    for (let i = 0; i < patterns.domains.length; i++)
    {
      if (labelName.indexOf(patterns.domains[i]) > -1)
      {
        return category;
      }
    }
  }

  return null;
}

// ============================================================================
// DISPLAY FUNCTIONS
// ============================================================================

/**
 * Display top labels by thread count.
 * Helps identify where most of your email is categorized.
 *
 * @param {Array} labelData - Label data array
 */
function displayTopLabels(labelData)
{
  // Sort by thread count descending
  const sorted = labelData.slice().sort(function(a, b)
  {
    return b.threadCount - a.threadCount;
  });

  Logger.log('=== TOP 20 LABELS BY THREAD COUNT ===');
  for (let i = 0; i < Math.min(20, sorted.length); i++)
  {
    const label = sorted[i];
    const categoryTag = label.suggestedCategory ? ' [' + label.suggestedCategory + ']' : '';
    Logger.log('  ' + label.threadCount + ' threads: ' + label.name + categoryTag);
  }
  Logger.log('');
}

/**
 * Display label hierarchy analysis.
 * Shows distribution of root vs nested labels.
 *
 * @param {Array} labelData - Label data array
 */
function displayLabelHierarchy(labelData)
{
  const rootLabels = labelData.filter(function(l)
  {
    return l.level === 0;
  });
  const nestedLabels = labelData.filter(function(l)
  {
    return l.level > 0;
  });
  const deepLabels = labelData.filter(function(l)
  {
    return l.level >= 2;
  });

  Logger.log('=== HIERARCHY ANALYSIS ===');
  Logger.log('Root-level labels: ' + rootLabels.length);
  Logger.log('Nested labels: ' + nestedLabels.length);
  Logger.log('Deeply nested (3+ levels): ' + deepLabels.length);
  Logger.log('');

  // Warn if too many root labels
  if (rootLabels.length > 15)
  {
    Logger.log('WARNING: You have many root-level labels (' + rootLabels.length + ')');
    Logger.log('Consider consolidating into 5-10 top-level categories.');
    Logger.log('');
  }

  // Show deeply nested labels
  if (deepLabels.length > 0)
  {
    Logger.log('=== DEEPLY NESTED LABELS ===');
    for (let i = 0; i < deepLabels.length; i++)
    {
      Logger.log('  ' + deepLabels[i].name + ' (' + deepLabels[i].threadCount + ' threads)');
    }
    Logger.log('');
  }
}

/**
 * Display empty labels that could be cleaned up.
 *
 * @param {Array} labelData - Label data array
 */
function displayEmptyLabels(labelData)
{
  const emptyLabels = labelData.filter(function(l)
  {
    return l.threadCount === 0;
  });

  if (emptyLabels.length > 0)
  {
    Logger.log('=== EMPTY LABELS (' + emptyLabels.length + ') ===');
    Logger.log('These labels have no emails and could be deleted:');
    for (let i = 0; i < emptyLabels.length; i++)
    {
      Logger.log('  ' + emptyLabels[i].name);
    }
    Logger.log('');
    Logger.log('TIP: Run deleteEmptyLabels(true) to preview deletion,');
    Logger.log('     or deleteEmptyLabels(false) to actually delete.');
    Logger.log('');
  }
}

/**
 * Display potential duplicate labels (similar names).
 *
 * @param {Array} labelData - Label data array
 */
function displayPotentialDuplicates(labelData)
{
  const duplicates = [];
  const seen = {};

  // Normalize names by removing non-alphanumeric chars
  for (let i = 0; i < labelData.length; i++)
  {
    const normalized = labelData[i].baseName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen[normalized])
    {
      duplicates.push({
        label1: seen[normalized],
        label2: labelData[i].name
      });
    }
    else
    {
      seen[normalized] = labelData[i].name;
    }
  }

  if (duplicates.length > 0)
  {
    Logger.log('=== POTENTIAL DUPLICATES ===');
    Logger.log('These labels have similar names and might be consolidated:');
    for (let i = 0; i < duplicates.length; i++)
    {
      Logger.log('  "' + duplicates[i].label1 + '" and "' + duplicates[i].label2 + '"');
    }
    Logger.log('');
  }
}

/**
 * Suggest labels that could be consolidated.
 * Finds parents with single children and low-usage labels.
 *
 * @param {Array} labelData - Label data array
 */
function suggestConsolidations(labelData)
{
  Logger.log('=== CONSOLIDATION SUGGESTIONS ===');

  // Group labels by parent
  const parentGroups = {};
  for (let i = 0; i < labelData.length; i++)
  {
    const label = labelData[i];
    if (label.parent)
    {
      if (!parentGroups[label.parent])
      {
        parentGroups[label.parent] = [];
      }
      parentGroups[label.parent].push(label);
    }
  }

  // Find parents with only one child (could be flattened)
  const singleChildParents = [];
  for (const parent of Object.keys(parentGroups))
  {
    if (parentGroups[parent].length === 1)
    {
      singleChildParents.push({
        parent: parent,
        child: parentGroups[parent][0].name
      });
    }
  }

  if (singleChildParents.length > 0)
  {
    Logger.log('Labels with only one child (could be flattened):');
    for (let i = 0; i < singleChildParents.length; i++)
    {
      Logger.log('  "' + singleChildParents[i].parent + '" -> "' + singleChildParents[i].child + '"');
    }
    Logger.log('');
  }

  // Find labels with very few threads
  const lowUsage = labelData.filter(function(l)
  {
    return l.threadCount > 0 && l.threadCount < 5;
  });

  if (lowUsage.length > 0)
  {
    Logger.log('Labels with very few threads (1-4):');
    for (let i = 0; i < Math.min(10, lowUsage.length); i++)
    {
      Logger.log('  "' + lowUsage[i].name + '" (' + lowUsage[i].threadCount + ' threads)');
    }
    if (lowUsage.length > 10)
    {
      Logger.log('  ... and ' + (lowUsage.length - 10) + ' more');
    }
    Logger.log('');
  }
}

/**
 * Display category analysis based on pattern detection.
 * Shows how labels are distributed across detected categories.
 *
 * @param {Array} labelData - Label data array
 */
function displayCategoryAnalysis(labelData)
{
  // Group labels by detected category
  const categories = {};

  for (let i = 0; i < labelData.length; i++)
  {
    const cat = labelData[i].suggestedCategory || 'uncategorized';
    if (!categories[cat])
    {
      categories[cat] = {count: 0, threads: 0, labels: []};
    }
    categories[cat].count++;
    categories[cat].threads += labelData[i].threadCount;
    categories[cat].labels.push(labelData[i].name);
  }

  Logger.log('=== DETECTED CATEGORIES ===');
  for (const cat of Object.keys(categories))
  {
    if (cat !== 'uncategorized')
    {
      Logger.log(cat.toUpperCase() + ': ' + categories[cat].count + ' labels, ' + categories[cat].threads + ' threads');
      for (let i = 0; i < Math.min(5, categories[cat].labels.length); i++)
      {
        Logger.log('    - ' + categories[cat].labels[i]);
      }
      if (categories[cat].labels.length > 5)
      {
        Logger.log('    ... and ' + (categories[cat].labels.length - 5) + ' more');
      }
    }
  }

  Logger.log('');

  // Handle uncategorized labels
  if (categories.uncategorized && categories.uncategorized.count > 0)
  {
    Logger.log('UNCATEGORIZED: ' + categories.uncategorized.count + ' labels');
    Logger.log('(These will need manual review for your organization plan)');
  }
  else
  {
    Logger.log('All labels have been categorized!');
  }
  Logger.log('');
}

/**
 * Propose a clean organization structure based on analysis.
 * Provides a recommended template for reorganization.
 *
 * @param {Array} labelData - Label data array
 */
function proposeOrganization(labelData)
{
  Logger.log('Based on your label analysis, here is a recommended structure:');
  Logger.log('');
  Logger.log('1. PERSONAL');
  Logger.log('   - Family');
  Logger.log('   - Friends');
  Logger.log('   - Health');
  Logger.log('   - Hobbies');
  Logger.log('');
  Logger.log('2. WORK');
  Logger.log('   - Current Projects');
  Logger.log('   - Clients');
  Logger.log('   - Team');
  Logger.log('   - Job Search');
  Logger.log('');
  Logger.log('3. FINANCE');
  Logger.log('   - Banking');
  Logger.log('   - Investments');
  Logger.log('   - Bills');
  Logger.log('   - Taxes');
  Logger.log('');
  Logger.log('4. SHOPPING');
  Logger.log('   - Orders');
  Logger.log('   - Receipts');
  Logger.log('   - Returns');
  Logger.log('');
  Logger.log('5. TRAVEL');
  Logger.log('   - Upcoming');
  Logger.log('   - Past Trips');
  Logger.log('   - Bookings');
  Logger.log('');
  Logger.log('6. LEARNING');
  Logger.log('   - Courses');
  Logger.log('   - Reading');
  Logger.log('   - Certificates');
  Logger.log('');
  Logger.log('7. ARCHIVE');
  Logger.log('   - Old Projects');
  Logger.log('   - Past Jobs');
  Logger.log('   - Historical');
  Logger.log('');
  Logger.log('8. NEWSLETTERS');
  Logger.log('   - Keep');
  Logger.log('   - Review');
  Logger.log('');
  Logger.log('---');
  Logger.log('');
  Logger.log('NEXT STEPS:');
  Logger.log('1. Copy the ORGANIZATION_PLAN template from reorganization.gs');
  Logger.log('2. Customize the categories to match your needs');
  Logger.log('3. Add migration rules for your existing labels');
  Logger.log('4. Run validatePlan() to check for errors');
  Logger.log('5. Run main() with DRY_RUN=true to preview changes');
  Logger.log('6. Run main() with DRY_RUN=false to execute');
}

// ============================================================================
// VISUALIZATION FUNCTIONS
// ============================================================================

/**
 * Create a visual tree of label hierarchy.
 * Displays labels with indentation showing nesting.
 */
function visualizeLabelHierarchy()
{
  const labels = GmailApp.getUserLabels();
  const labelNames = labels.map(function(l)
  {
    return l.getName();
  }).sort();

  Logger.log('=== LABEL HIERARCHY TREE ===');
  Logger.log('');

  for (let i = 0; i < labelNames.length; i++)
  {
    const name = labelNames[i];
    const level = (name.match(/\//g) || []).length;

    // Build indentation
    let indent = '';
    for (let j = 0; j < level; j++)
    {
      indent += '    ';
    }

    // Get just the label name (after last slash)
    const displayName = name.split('/').pop();

    // Add tree characters for visual hierarchy
    const prefix = level > 0 ? '├── ' : '';
    Logger.log(indent + prefix + displayName);
  }
}

/**
 * Generate a migration plan template based on current labels.
 * Creates a starting point that users can customize.
 */
function generateMigrationTemplate()
{
  const labelData = collectLabelData(GmailApp.getUserLabels());

  Logger.log('=== MIGRATION PLAN TEMPLATE ===');
  Logger.log('');
  Logger.log('Copy and customize this for your reorganization.gs:');
  Logger.log('');
  Logger.log('var ORGANIZATION_PLAN = {');
  Logger.log('  newLabels: [');
  Logger.log('    // Add your new label structure here');
  Logger.log('    "Personal",');
  Logger.log('    "Personal/Family",');
  Logger.log('    "Work",');
  Logger.log('    "Work/Projects",');
  Logger.log('    "Finance",');
  Logger.log('    "Archive"');
  Logger.log('  ],');
  Logger.log('');
  Logger.log('  migrations: [');

  // Generate migration suggestions based on detected categories
  for (let i = 0; i < labelData.length; i++)
  {
    const label = labelData[i];
    if (label.suggestedCategory && label.threadCount > 0)
    {
      const suggestedDest = label.suggestedCategory.charAt(0).toUpperCase() + label.suggestedCategory.slice(1);
      Logger.log('    // ' + label.threadCount + ' threads');
      Logger.log('    {from: "' + label.name + '", to: "' + suggestedDest + '"},');
    }
  }

  Logger.log('');
  Logger.log('    // Add more migrations below...');
  Logger.log('  ]');
  Logger.log('};');
}

// ============================================================================
// QUICK STATS FUNCTION
// ============================================================================

/**
 * Quick overview of Gmail label stats.
 * Faster than full analysis - good for checking progress.
 */
function quickStats()
{
  const labels = GmailApp.getUserLabels();

  let totalThreads = 0;
  let emptyCount = 0;
  let maxThreads = 0;
  let maxLabel = '';

  for (let i = 0; i < labels.length; i++)
  {
    const count = getThreadCountForLabel(labels[i]);
    totalThreads += count;

    if (count === 0)
    {
      emptyCount++;
    }

    if (count > maxThreads)
    {
      maxThreads = count;
      maxLabel = labels[i].getName();
    }
  }

  Logger.log('=== QUICK STATS ===');
  Logger.log('Total labels: ' + labels.length);
  Logger.log('Empty labels: ' + emptyCount);
  Logger.log('Total threads (with duplicates): ' + totalThreads);
  Logger.log('Largest label: "' + maxLabel + '" (' + maxThreads + ' threads)');

  // Show completed migrations if any
  const completed = getCompletedMigrations();
  if (completed.length > 0)
  {
    Logger.log('');
    Logger.log('Completed migrations: ' + completed.length);
  }
}
