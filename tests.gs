/**
 * Gmail Reorganization Library - Unit Tests
 *
 * Run these tests to verify the library functions correctly.
 * Execute runAllTests() to run the complete test suite.
 *
 * IMPORTANT: These tests use mocking to avoid modifying actual Gmail data.
 */

// ============================================================================
// TEST FRAMEWORK
// ============================================================================

/**
 * Global test results tracker
 */
var TestResults =
{
  passed: 0,
  failed: 0,
  errors: []
};

/**
 * Assert that a condition is true.
 *
 * @param {boolean} condition - Condition to test
 * @param {string} message - Error message if assertion fails
 */
function assert(condition, message)
{
  if (!condition)
  {
    throw new Error('Assertion failed: ' + message);
  }
}

/**
 * Assert that two values are equal.
 *
 * @param {*} actual - Actual value
 * @param {*} expected - Expected value
 * @param {string} message - Error message if assertion fails
 */
function assertEquals(actual, expected, message)
{
  if (actual !== expected)
  {
    throw new Error(message + ' - Expected: ' + expected + ', Got: ' + actual);
  }
}

/**
 * Assert that two values are deeply equal (for objects/arrays).
 *
 * @param {*} actual - Actual value
 * @param {*} expected - Expected value
 * @param {string} message - Error message if assertion fails
 */
function assertDeepEquals(actual, expected, message)
{
  if (JSON.stringify(actual) !== JSON.stringify(expected))
  {
    throw new Error(message + ' - Expected: ' + JSON.stringify(expected) + ', Got: ' + JSON.stringify(actual));
  }
}

/**
 * Assert that a value is null.
 *
 * @param {*} value - Value to test
 * @param {string} message - Error message if assertion fails
 */
function assertNull(value, message)
{
  if (value !== null)
  {
    throw new Error(message + ' - Expected null, Got: ' + value);
  }
}

/**
 * Assert that a value is not null.
 *
 * @param {*} value - Value to test
 * @param {string} message - Error message if assertion fails
 */
function assertNotNull(value, message)
{
  if (value === null || value === undefined)
  {
    throw new Error(message + ' - Expected non-null value');
  }
}

/**
 * Assert that an array contains a specific value.
 *
 * @param {Array} array - Array to search
 * @param {*} value - Value to find
 * @param {string} message - Error message if assertion fails
 */
function assertContains(array, value, message)
{
  if (array.indexOf(value) === -1)
  {
    throw new Error(message + ' - Array does not contain: ' + value);
  }
}

/**
 * Run a single test and record result.
 *
 * @param {string} testName - Name of the test
 * @param {Function} testFn - Test function to execute
 */
function runTest(testName, testFn)
{
  try
  {
    testFn();
    TestResults.passed++;
    Logger.log('  PASS: ' + testName);
  }
  catch (e)
  {
    TestResults.failed++;
    TestResults.errors.push({test: testName, error: e.message});
    Logger.log('  FAIL: ' + testName + ' - ' + e.message);
  }
}

// ============================================================================
// VALIDATION TESTS
// ============================================================================

/**
 * Test suite for validateLabelName function
 */
function testValidateLabelName()
{
  Logger.log('=== validateLabelName Tests ===');

  runTest('Valid simple label', function()
  {
    var result = validateLabelName('MyLabel');
    assert(result.valid === true, 'Should be valid');
    assertNull(result.reason, 'Should have no reason');
  });

  runTest('Valid nested label', function()
  {
    var result = validateLabelName('Parent/Child/Grandchild');
    assert(result.valid === true, 'Should be valid');
  });

  runTest('Empty label rejected', function()
  {
    var result = validateLabelName('');
    assert(result.valid === false, 'Should be invalid');
    assertNotNull(result.reason, 'Should have a reason');
  });

  runTest('Null label rejected', function()
  {
    var result = validateLabelName(null);
    assert(result.valid === false, 'Should be invalid');
  });

  runTest('Whitespace-only label rejected', function()
  {
    var result = validateLabelName('   ');
    assert(result.valid === false, 'Should be invalid');
  });

  runTest('Reserved label "inbox" rejected', function()
  {
    var result = validateLabelName('inbox');
    assert(result.valid === false, 'Should be invalid');
    assert(result.reason.indexOf('reserved') > -1, 'Should mention reserved');
  });

  runTest('Reserved label case insensitive', function()
  {
    var result = validateLabelName('INBOX');
    assert(result.valid === false, 'Should be invalid');
  });

  runTest('Invalid character < rejected', function()
  {
    var result = validateLabelName('Test<Label');
    assert(result.valid === false, 'Should be invalid');
    assert(result.reason.indexOf('<') > -1, 'Should mention the character');
  });

  runTest('Invalid character & rejected', function()
  {
    var result = validateLabelName('Test&Label');
    assert(result.valid === false, 'Should be invalid');
  });

  runTest('Label exceeding 225 chars rejected', function()
  {
    var longName = '';
    for (var i = 0; i < 230; i++)
    {
      longName += 'a';
    }
    var result = validateLabelName(longName);
    assert(result.valid === false, 'Should be invalid');
    assert(result.reason.indexOf('225') > -1, 'Should mention limit');
  });

  runTest('Label at exactly 225 chars accepted', function()
  {
    var exactName = '';
    for (var i = 0; i < 225; i++)
    {
      exactName += 'a';
    }
    var result = validateLabelName(exactName);
    assert(result.valid === true, 'Should be valid');
  });
}

// ============================================================================
// ORGANIZATION PLAN VALIDATION TESTS
// ============================================================================

/**
 * Test suite for validateOrganizationPlan function
 */
function testValidateOrganizationPlan()
{
  Logger.log('=== validateOrganizationPlan Tests ===');

  runTest('Null plan rejected', function()
  {
    var result = validateOrganizationPlan(null);
    assert(result.valid === false, 'Should be invalid');
    assert(result.errors.length > 0, 'Should have errors');
  });

  runTest('Plan without newLabels rejected', function()
  {
    var result = validateOrganizationPlan({migrations: []});
    assert(result.valid === false, 'Should be invalid');
    assert(result.errors.some(function(e)
    {
      return e.indexOf('newLabels') > -1;
    }), 'Should mention newLabels');
  });

  runTest('Plan without migrations rejected', function()
  {
    var result = validateOrganizationPlan({newLabels: []});
    assert(result.valid === false, 'Should be invalid');
  });

  runTest('Valid empty plan accepted', function()
  {
    var result = validateOrganizationPlan({newLabels: [], migrations: []});
    assert(result.valid === true, 'Should be valid');
  });

  runTest('Plan with valid labels accepted', function()
  {
    var result = validateOrganizationPlan({
      newLabels: ['Personal', 'Work', 'Archive'],
      migrations: []
    });
    assert(result.valid === true, 'Should be valid');
    assertEquals(result.errors.length, 0, 'Should have no errors');
  });

  runTest('Plan with invalid label rejected', function()
  {
    var result = validateOrganizationPlan({
      newLabels: ['Personal', 'inbox', 'Archive'],
      migrations: []
    });
    assert(result.valid === false, 'Should be invalid');
  });

  runTest('Migration without from field rejected', function()
  {
    var result = validateOrganizationPlan({
      newLabels: ['Archive'],
      migrations: [{to: 'Archive'}]
    });
    assert(result.valid === false, 'Should be invalid');
    assert(result.errors.some(function(e)
    {
      return e.indexOf('from') > -1;
    }), 'Should mention from');
  });

  runTest('Migration without to field rejected', function()
  {
    var result = validateOrganizationPlan({
      newLabels: ['Archive'],
      migrations: [{from: 'OldLabel'}]
    });
    assert(result.valid === false, 'Should be invalid');
  });

  runTest('Duplicate migrations generate warning', function()
  {
    var result = validateOrganizationPlan({
      newLabels: ['Archive'],
      migrations:
      [
        {from: 'Label1', to: 'Archive'},
        {from: 'Label1', to: 'Archive'}
      ]
    });
    assert(result.warnings.some(function(w)
    {
      return w.indexOf('multiple') > -1;
    }), 'Should warn about duplicates');
  });
}

// ============================================================================
// TIME MANAGEMENT TESTS
// ============================================================================

/**
 * Test suite for time management functions
 */
function testTimeManagement()
{
  Logger.log('=== Time Management Tests ===');

  runTest('hasTimeRemaining returns true when time available', function()
  {
    var startTime = new Date().getTime();
    var result = hasTimeRemaining(startTime, 300000, 30000);
    assert(result === true, 'Should have time remaining');
  });

  runTest('hasTimeRemaining returns false when time expired', function()
  {
    var startTime = new Date().getTime() - 300000;  // 5 minutes ago
    var result = hasTimeRemaining(startTime, 300000, 30000);
    assert(result === false, 'Should not have time remaining');
  });

  runTest('hasTimeRemaining respects buffer', function()
  {
    var startTime = new Date().getTime() - 275000;  // 4:35 elapsed
    var result = hasTimeRemaining(startTime, 300000, 30000);  // 30s buffer
    assert(result === false, 'Should account for buffer');
  });

  runTest('hasTimeRemaining default buffer is 30000', function()
  {
    var startTime = new Date().getTime() - 260000;  // 4:20 elapsed
    var result = hasTimeRemaining(startTime, 300000);
    assert(result === true, 'Should use default buffer');
  });

  runTest('getRemainingSeconds calculates correctly', function()
  {
    var startTime = new Date().getTime() - 60000;  // 1 minute ago
    var result = getRemainingSeconds(startTime, 300000);
    assert(result >= 239 && result <= 241, 'Should be around 240 seconds');
  });

  runTest('getRemainingSeconds never returns negative', function()
  {
    var startTime = new Date().getTime() - 400000;  // Past limit
    var result = getRemainingSeconds(startTime, 300000);
    assertEquals(result, 0, 'Should return 0, not negative');
  });
}

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

/**
 * Test suite for utility functions
 */
function testUtilityFunctions()
{
  Logger.log('=== Utility Function Tests ===');

  runTest('formatTimestamp returns ISO format', function()
  {
    var result = formatTimestamp();
    assert(result.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/), 'Should be ISO format');
  });

  runTest('PROPERTY_KEYS are defined', function()
  {
    assertNotNull(PROPERTY_KEYS.MIGRATION_STATE, 'MIGRATION_STATE should exist');
    assertNotNull(PROPERTY_KEYS.LAST_RUN, 'LAST_RUN should exist');
    assertNotNull(PROPERTY_KEYS.COMPLETED_MIGRATIONS, 'COMPLETED_MIGRATIONS should exist');
    assertNotNull(PROPERTY_KEYS.STATISTICS, 'STATISTICS should exist');
  });

  runTest('RESERVED_LABELS contains common labels', function()
  {
    assertContains(RESERVED_LABELS, 'inbox', 'Should contain inbox');
    assertContains(RESERVED_LABELS, 'sent', 'Should contain sent');
    assertContains(RESERVED_LABELS, 'trash', 'Should contain trash');
    assertContains(RESERVED_LABELS, 'spam', 'Should contain spam');
  });

  runTest('INVALID_LABEL_CHARS contains special characters', function()
  {
    assertContains(INVALID_LABEL_CHARS, '&', 'Should contain &');
    assertContains(INVALID_LABEL_CHARS, '<', 'Should contain <');
    assertContains(INVALID_LABEL_CHARS, '>', 'Should contain >');
  });
}

// ============================================================================
// STATE PERSISTENCE TESTS
// ============================================================================

/**
 * Test suite for state persistence functions.
 * Note: These tests use actual PropertiesService.
 */
function testStatePersistence()
{
  Logger.log('=== State Persistence Tests ===');

  // Clean up before tests
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROPERTY_KEYS.MIGRATION_STATE);
  props.deleteProperty(PROPERTY_KEYS.COMPLETED_MIGRATIONS);
  props.deleteProperty(PROPERTY_KEYS.STATISTICS);

  runTest('loadMigrationState returns null when no state', function()
  {
    var result = loadMigrationState();
    assertNull(result, 'Should return null');
  });

  runTest('saveMigrationState and loadMigrationState roundtrip', function()
  {
    var testState = {lastIndex: 5, timestamp: '2024-01-01'};
    saveMigrationState(testState);
    var result = loadMigrationState();
    assertDeepEquals(result, testState, 'Should roundtrip correctly');
  });

  runTest('clearMigrationState removes state', function()
  {
    saveMigrationState({test: true});
    clearMigrationState();
    var result = loadMigrationState();
    assertNull(result, 'Should be cleared');
  });

  runTest('getCompletedMigrations returns empty array when none', function()
  {
    var result = getCompletedMigrations();
    assert(Array.isArray(result), 'Should be array');
    assertEquals(result.length, 0, 'Should be empty');
  });

  runTest('markMigrationCompleted adds to list', function()
  {
    markMigrationCompleted('OldLabel', 'NewLabel', 10);
    var result = getCompletedMigrations();
    assertEquals(result.length, 1, 'Should have one entry');
    assertEquals(result[0].from, 'OldLabel', 'Should have correct from');
    assertEquals(result[0].to, 'NewLabel', 'Should have correct to');
    assertEquals(result[0].threads, 10, 'Should have correct threads');
  });

  runTest('isMigrationCompleted returns true for completed', function()
  {
    var result = isMigrationCompleted('OldLabel');
    assert(result === true, 'Should return true');
  });

  runTest('isMigrationCompleted returns false for not completed', function()
  {
    var result = isMigrationCompleted('NonExistent');
    assert(result === false, 'Should return false');
  });

  runTest('getStatistics returns object', function()
  {
    var result = getStatistics();
    assert(typeof result === 'object', 'Should be object');
  });

  runTest('updateStatistics increments values', function()
  {
    updateStatistics(100, 5);
    var result = getStatistics();
    assert(result.totalThreadsProcessed >= 100, 'Should have threads');
    assert(result.totalLabelsCreated >= 5, 'Should have labels');
    assert(result.runCount >= 1, 'Should have run count');
  });

  runTest('resetAllMigrationTracking clears everything', function()
  {
    resetAllMigrationTracking();
    assertNull(loadMigrationState(), 'State should be null');
    assertEquals(getCompletedMigrations().length, 0, 'Completed should be empty');
  });
}

// ============================================================================
// CATEGORY DETECTION TESTS
// ============================================================================

/**
 * Test suite for category detection
 */
function testCategoryDetection()
{
  Logger.log('=== Category Detection Tests ===');

  runTest('detectCategory finds work keywords', function()
  {
    assertEquals(detectCategory('myproject'), 'work', 'Should detect project as work');
    assertEquals(detectCategory('client-acme'), 'work', 'Should detect client as work');
  });

  runTest('detectCategory finds finance keywords', function()
  {
    assertEquals(detectCategory('bank-statements'), 'finance', 'Should detect bank as finance');
    assertEquals(detectCategory('taxes-2024'), 'finance', 'Should detect tax as finance');
  });

  runTest('detectCategory finds personal keywords', function()
  {
    assertEquals(detectCategory('family-updates'), 'personal', 'Should detect family as personal');
  });

  runTest('detectCategory finds shopping keywords', function()
  {
    assertEquals(detectCategory('amazon-orders'), 'shopping', 'Should detect amazon as shopping');
    assertEquals(detectCategory('shipping-info'), 'shopping', 'Should detect shipping as shopping');
  });

  runTest('detectCategory returns null for unknown', function()
  {
    assertNull(detectCategory('randomlabel123'), 'Should return null for unknown');
  });

  runTest('CATEGORY_PATTERNS structure is valid', function()
  {
    for (var cat in CATEGORY_PATTERNS)
    {
      assert(Array.isArray(CATEGORY_PATTERNS[cat].keywords), cat + ' should have keywords array');
      assert(Array.isArray(CATEGORY_PATTERNS[cat].domains), cat + ' should have domains array');
    }
  });
}

// ============================================================================
// INPUT VALIDATION EDGE CASES
// ============================================================================

/**
 * Test edge cases and boundary conditions
 */
function testEdgeCases()
{
  Logger.log('=== Edge Case Tests ===');

  runTest('validateLabelName handles undefined', function()
  {
    var result = validateLabelName(undefined);
    assert(result.valid === false, 'Should reject undefined');
  });

  runTest('validateLabelName handles number input', function()
  {
    var result = validateLabelName(123);
    // Should handle gracefully - either reject or convert
    assert(result !== undefined, 'Should not crash');
  });

  runTest('validateLabelName handles object input', function()
  {
    var result = validateLabelName({name: 'test'});
    assert(result !== undefined, 'Should not crash');
  });

  runTest('Empty migrations array is valid', function()
  {
    var result = validateOrganizationPlan({
      newLabels: ['Test'],
      migrations: []
    });
    assert(result.valid === true, 'Empty migrations should be valid');
  });

  runTest('Labels with spaces are valid', function()
  {
    var result = validateLabelName('My Label Name');
    assert(result.valid === true, 'Labels with spaces should be valid');
  });

  runTest('Labels with numbers are valid', function()
  {
    var result = validateLabelName('Project2024');
    assert(result.valid === true, 'Labels with numbers should be valid');
  });

  runTest('Labels with dashes are valid', function()
  {
    var result = validateLabelName('my-label-name');
    assert(result.valid === true, 'Labels with dashes should be valid');
  });

  runTest('Labels with underscores are valid', function()
  {
    var result = validateLabelName('my_label_name');
    assert(result.valid === true, 'Labels with underscores should be valid');
  });
}

// ============================================================================
// CONFIGURATION VALIDATION TESTS
// ============================================================================

/**
 * Test configuration objects
 */
function testConfiguration()
{
  Logger.log('=== Configuration Tests ===');

  runTest('CONFIG object exists', function()
  {
    assertNotNull(CONFIG, 'CONFIG should exist');
  });

  runTest('CONFIG has required properties', function()
  {
    assert('DRY_RUN' in CONFIG, 'Should have DRY_RUN');
    assert('BATCH_SIZE' in CONFIG, 'Should have BATCH_SIZE');
    assert('MAX_RUNTIME_MS' in CONFIG, 'Should have MAX_RUNTIME_MS');
  });

  runTest('CONFIG.DRY_RUN defaults to true', function()
  {
    assert(CONFIG.DRY_RUN === true, 'DRY_RUN should default to true for safety');
  });

  runTest('CONFIG.BATCH_SIZE is reasonable', function()
  {
    assert(CONFIG.BATCH_SIZE > 0, 'BATCH_SIZE should be positive');
    assert(CONFIG.BATCH_SIZE <= 500, 'BATCH_SIZE should not exceed API limits');
  });

  runTest('CONFIG.MAX_RUNTIME_MS is under 6 minutes', function()
  {
    assert(CONFIG.MAX_RUNTIME_MS < 360000, 'Should be under Apps Script limit');
  });

  runTest('BACKUP_CONFIG object exists', function()
  {
    assertNotNull(BACKUP_CONFIG, 'BACKUP_CONFIG should exist');
  });

  runTest('ORGANIZATION_PLAN has required structure', function()
  {
    assert(Array.isArray(ORGANIZATION_PLAN.newLabels), 'Should have newLabels array');
    assert(Array.isArray(ORGANIZATION_PLAN.migrations), 'Should have migrations array');
  });
}

// ============================================================================
// TEST RUNNER
// ============================================================================

/**
 * Run all test suites.
 * Call this function to execute the complete test suite.
 */
function runAllTests()
{
  TestResults.passed = 0;
  TestResults.failed = 0;
  TestResults.errors = [];

  Logger.log('');
  Logger.log('========================================');
  Logger.log('   GMAIL REORG LIBRARY - TEST SUITE    ');
  Logger.log('========================================');
  Logger.log('');

  // Run all test suites
  testValidateLabelName();
  Logger.log('');

  testValidateOrganizationPlan();
  Logger.log('');

  testTimeManagement();
  Logger.log('');

  testUtilityFunctions();
  Logger.log('');

  testStatePersistence();
  Logger.log('');

  testCategoryDetection();
  Logger.log('');

  testEdgeCases();
  Logger.log('');

  testConfiguration();
  Logger.log('');

  // Summary
  Logger.log('========================================');
  Logger.log('              TEST RESULTS             ');
  Logger.log('========================================');
  Logger.log('');
  Logger.log('  Passed: ' + TestResults.passed);
  Logger.log('  Failed: ' + TestResults.failed);
  Logger.log('  Total:  ' + (TestResults.passed + TestResults.failed));
  Logger.log('');

  if (TestResults.failed > 0)
  {
    Logger.log('=== FAILURES ===');
    for (var i = 0; i < TestResults.errors.length; i++)
    {
      var err = TestResults.errors[i];
      Logger.log('  ' + err.test + ': ' + err.error);
    }
  }
  else
  {
    Logger.log('All tests passed!');
  }

  Logger.log('');

  return {
    passed: TestResults.passed,
    failed: TestResults.failed,
    errors: TestResults.errors
  };
}

/**
 * Quick smoke test - runs minimal tests to verify basic functionality.
 * Use this for fast validation that the library is working.
 */
function runSmokeTests()
{
  Logger.log('=== SMOKE TESTS ===');

  TestResults.passed = 0;
  TestResults.failed = 0;
  TestResults.errors = [];

  runTest('validateLabelName exists and works', function()
  {
    var result = validateLabelName('Test');
    assert(result.valid === true, 'Basic validation should work');
  });

  runTest('validateOrganizationPlan exists and works', function()
  {
    var result = validateOrganizationPlan({newLabels: [], migrations: []});
    assert(result.valid === true, 'Basic plan validation should work');
  });

  runTest('Time functions exist and work', function()
  {
    var start = new Date().getTime();
    assert(hasTimeRemaining(start, 300000) === true, 'Time check should work');
  });

  runTest('State functions exist', function()
  {
    assert(typeof loadMigrationState === 'function', 'loadMigrationState should exist');
    assert(typeof saveMigrationState === 'function', 'saveMigrationState should exist');
  });

  Logger.log('');
  Logger.log('Smoke tests: ' + TestResults.passed + ' passed, ' + TestResults.failed + ' failed');

  return TestResults.failed === 0;
}
