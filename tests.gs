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
 * @param {Object} results - Results accumulator {passed, failed, errors}
 */
function runTest(testName, testFn, results)
{
  try
  {
    testFn();
    results.passed++;
    Logger.log('  PASS: ' + testName);
  }
  catch (e)
  {
    results.failed++;
    results.errors.push({test: testName, error: e.message});
    Logger.log('  FAIL: ' + testName + ' - ' + e.message);
  }
}

// ============================================================================
// FILTER SPEC TESTS
// ============================================================================

/**
 * Test suite for the delivery-filter helpers in reorg_toolkit.gs.
 *
 * These use injected fixture specs rather than the real _FILTER_SPEC, so the
 * suite runs without _private_data.gs being present.
 *
 * @param {Object} results - Results accumulator
 */
function testFilterSpec(results)
{
  Logger.log('=== Filter Spec Tests ===');

  const R = 'Label_480';

  /**
   * Build a filter resource with the given action, as the Gmail API returns it.
   *
   * @param {Array<string>} adds - addLabelIds
   * @param {Array<string>} removes - removeLabelIds
   * @return {Object} Filter-shaped object
   */
  function filterWith(adds, removes)
  {
    return {action: {addLabelIds: adds, removeLabelIds: removes}};
  }

  // --- criteria tokenisation ---

  runTest('_specAddresses_ splits an OR list', function()
  {
    assertDeepEquals(_specAddresses_({from: 'a@x.com OR b@x.com OR c@x.com'}),
      ['a@x.com', 'b@x.com', 'c@x.com'], 'Should split on OR');
  }, results);

  runTest('_specAddresses_ lowercases a single address', function()
  {
    assertDeepEquals(_specAddresses_({from: 'Solo@X.com'}), ['solo@x.com'], 'Should lowercase');
  }, results);

  runTest('_specAddresses_ namespaces query criteria', function()
  {
    assertDeepEquals(_specAddresses_({query: 'list:(<y>)'}), ['query::list:(<y>)'],
      'Query should not collide with an address');
  }, results);

  // --- conflict detection ---
  // Gmail runs EVERY matching filter, so two entries matching one message double-label.

  runTest('_specConflicts_ passes a clean spec', function()
  {
    const spec = [
      {from: 'a@x.com', label: 'Reading', skipInbox: true},
      {from: 'b@y.com', label: 'Misc', skipInbox: true}
    ];
    assertEquals(_specConflicts_(spec).length, 0, 'Distinct addresses should not conflict');
  }, results);

  runTest('_specConflicts_ catches a duplicated address', function()
  {
    const spec = [
      {from: 'a@x.com', label: 'Reading', skipInbox: true},
      {from: 'a@x.com', label: 'Misc', skipInbox: true}
    ];
    assertEquals(_specConflicts_(spec).length, 1, 'Same address in two entries should conflict');
  }, results);

  runTest('_specConflicts_ catches a bare domain subsuming an address', function()
  {
    // This is the exact shape of the Apple Mail rule that caused the 2026 drift:
    // a bare "linkedin.com" swallowing job alerts, InMail and digests alike.
    const spec = [
      {from: 'jobalerts-noreply@linkedin.com', label: 'Career/Jobs', skipInbox: true},
      {from: 'linkedin.com', label: 'Misc', skipInbox: true}
    ];
    assert(_specConflicts_(spec).length > 0, 'Bare domain should be flagged');
  }, results);

  runTest('_specConflicts_ does not flag distinct query criteria', function()
  {
    const spec = [
      {query: 'list:(<a.substack.com>)', label: 'Reading', skipInbox: true},
      {query: 'list:(<b.substack.com>)', label: 'Reading', skipInbox: true}
    ];
    assertEquals(_specConflicts_(spec).length, 0, 'Different lists should not conflict');
  }, results);

  // --- classification: what rebuildFilters_ is allowed to overwrite ---

  runTest('_classifyFilter_ recognises an exact match', function()
  {
    assertEquals(_classifyFilter_(filterWith([R], ['INBOX']), R, true), 'ok',
      'Spec-matching filter needs no work');
  }, results);

  runTest('_classifyFilter_ preserves unmanaged removeLabelIds', function()
  {
    assertEquals(_classifyFilter_(filterWith([R], ['INBOX', 'SPAM']), R, true), 'ok',
      'Extra removes are not a reason to rewrite');
  }, results);

  runTest('_classifyFilter_ treats an empty action as repairable', function()
  {
    assertEquals(_classifyFilter_(filterWith([], []), R, true), 'repair',
      'Orphaned filter carries no user intent');
  }, results);

  runTest('_classifyFilter_ treats a missing action as repairable', function()
  {
    assertEquals(_classifyFilter_({}, R, true), 'repair', 'Absent action should not throw');
  }, results);

  runTest('_classifyFilter_ protects a hand-added second label', function()
  {
    assertEquals(_classifyFilter_(filterWith([R, 'Label_496'], ['INBOX']), R, true), 'manual',
      'Never silently discard a label the user added');
  }, results);

  runTest('_classifyFilter_ protects a different target label', function()
  {
    assertEquals(_classifyFilter_(filterWith(['Label_496'], ['INBOX']), R, true), 'manual',
      'A retargeted filter is a deliberate edit');
  }, results);

  runTest('_classifyFilter_ protects a flipped inbox flag', function()
  {
    assertEquals(_classifyFilter_(filterWith([R], []), R, true), 'manual',
      'User removed skip-inbox; respect it');
  }, results);

  runTest('_classifyFilter_ protects an added inbox flag', function()
  {
    assertEquals(_classifyFilter_(filterWith([R], ['INBOX']), R, false), 'manual',
      'User added skip-inbox; respect it');
  }, results);

  // --- signature keying ---

  runTest('_filterSig_ separates from and query criteria', function()
  {
    assert(_filterSig_('a@x.com', null) !== _filterSig_(null, 'a@x.com'),
      'A from and a query with the same text are different filters');
  }, results);
}

// ============================================================================
// MUTATING PATH TESTS
// ============================================================================

/**
 * Build a fake label that records what was done to it.
 *
 * getThreads() keys on the `max` argument: the drain loops ask for 50 at a
 * time, while the post-move safety check asks for 1. That lets a test simulate
 * "a thread was still there when we went to delete the label" without making
 * the drain loop infinite.
 *
 * @param {string} name - Label name
 * @param {number} count - How many threads it starts with
 * @param {number} residual - Threads the size-1 safety check should report
 * @return {Object} Fake label
 */
function fakeLabel(name, count, residual)
{
  const threads = [];
  for (let i = 0; i < count; i++)
  {
    threads.push({id: name + '#' + i});
  }

  return {
    name: name,
    threads: threads,
    added: [],
    getName: function() { return name; },
    getThreads: function(start, max)
    {
      if (max === 1 && residual > 0)
      {
        return [{id: name + '#residual'}];
      }
      return threads.slice(start, start + max);
    },
    addToThreads: function(ts)
    {
      const self = this;
      ts.forEach(function(t) { self.added.push(t); });
    },
    removeFromThreads: function(ts)
    {
      ts.forEach(function(t)
      {
        const i = threads.indexOf(t);
        if (i !== -1) { threads.splice(i, 1); }
      });
    }
  };
}

/**
 * Build a fake Gmail gateway that records every write.
 *
 * @param {Object} state - {labels, filters, labelsByName, searchResults, createError}
 * @return {Object} Gateway with a .calls record
 */
function fakeGateway(state)
{
  const calls = {created: [], removedFilters: [], deletedLabels: [], searches: 0};

  return {
    calls: calls,
    listLabels: function() { return state.labels || []; },
    listFilters: function() { return state.filters || []; },
    getLabel: function(name) { return (state.labelsByName || {})[name] || null; },
    deleteLabel: function(label) { calls.deletedLabels.push(label.getName()); return null; },
    search: function()
    {
      calls.searches++;
      const batch = (state.searchResults || []).shift();
      return batch || [];
    },
    createFilter: function(resource)
    {
      if (state.createError) { throw new Error(state.createError); }
      calls.created.push(resource);
      return {id: 'new_' + calls.created.length};
    },
    removeFilter: function(id) { calls.removedFilters.push(id); return null; }
  };
}

/**
 * Count how many writes a gateway recorded.
 *
 * @param {Object} gw - Fake gateway
 * @return {number} Total writes
 */
function writeCount(gw)
{
  return gw.calls.created.length + gw.calls.removedFilters.length + gw.calls.deletedLabels.length;
}

/**
 * Test suite for the mutating routes: rebuildFilters_, mergeDrift_ and
 * linkedinNoiseBackfill_.
 *
 * Each test drives the real function through a fake gateway, so the code path
 * under test is the production one — only the Gmail calls are substituted.
 *
 * @param {Object} results - Results accumulator
 */
function testMutatingPaths(results)
{
  Logger.log('=== Mutating Path Tests ===');

  const READING = 'Label_480';
  const LABELS = [{id: READING, name: 'Reading'}, {id: 'Label_496', name: 'Misc'}];
  const SPEC = [{from: 'a@x.com', label: 'Reading', skipInbox: true}];

  // --- dependency injection guards ---

  runTest('_dep_ keeps a falsy but valid injected value', function()
  {
    assertEquals(_dep_({query: ''}, 'query', 'PRODUCTION'), '',
      'An empty string is a real value, not a reason to reach for production config');
  }, results);

  runTest('_dep_ falls back only when the key is absent', function()
  {
    assertEquals(_dep_({}, 'query', 'PRODUCTION'), 'PRODUCTION', 'Absent key should fall back');
    assertEquals(_dep_(null, 'query', 'PRODUCTION'), 'PRODUCTION', 'No deps at all should fall back');
  }, results);

  runTest('_depGw_ refuses to reach live Gmail when deps omits the gateway', function()
  {
    let threw = false;
    try { _depGw_({spec: []}); }
    catch (e) { threw = true; }
    assert(threw, 'A test that forgets gw must fail loudly, never mutate the real mailbox');
  }, results);

  // --- rebuildFilters_: dry-run ---

  runTest('rebuildFilters_ dry-run writes nothing', function()
  {
    const gw = fakeGateway({labels: LABELS, filters: []});
    rebuildFilters_([], false, false, {gw: gw, spec: SPEC, superseded: []});
    assertEquals(writeCount(gw), 0, 'Dry-run must not write');
  }, results);

  // --- rebuildFilters_: create ---

  runTest('rebuildFilters_ creates a missing filter', function()
  {
    const gw = fakeGateway({labels: LABELS, filters: []});
    rebuildFilters_([], true, false, {gw: gw, spec: SPEC, superseded: []});
    assertEquals(gw.calls.created.length, 1, 'Should create one filter');
    assertEquals(gw.calls.created[0].criteria.from, 'a@x.com', 'Criteria should match spec');
    assertDeepEquals(gw.calls.created[0].action.addLabelIds, [READING], 'Should target Reading');
    assertContains(gw.calls.created[0].action.removeLabelIds, 'INBOX', 'skipInbox should strip INBOX');
  }, results);

  runTest('rebuildFilters_ omits removeLabelIds when skipInbox is false', function()
  {
    const gw = fakeGateway({labels: LABELS, filters: []});
    const spec = [{from: 'a@x.com', label: 'Reading', skipInbox: false}];
    rebuildFilters_([], true, false, {gw: gw, spec: spec, superseded: []});
    assertNull(gw.calls.created[0].action.removeLabelIds || null, 'Should not touch INBOX');
  }, results);

  // --- rebuildFilters_: repair ---

  runTest('rebuildFilters_ repairs an empty-action filter', function()
  {
    const prior = {id: 'f1', criteria: {from: 'a@x.com'}, action: {addLabelIds: [], removeLabelIds: []}};
    const gw = fakeGateway({labels: LABELS, filters: [prior]});
    rebuildFilters_([], true, false, {gw: gw, spec: SPEC, superseded: []});
    assertDeepEquals(gw.calls.removedFilters, ['f1'], 'Should delete the dead filter');
    assertEquals(gw.calls.created.length, 1, 'Should recreate it');
  }, results);

  runTest('rebuildFilters_ preserves unmanaged removeLabelIds on repair', function()
  {
    const prior = {id: 'f1', criteria: {from: 'a@x.com'},
      action: {addLabelIds: [], removeLabelIds: ['INBOX', 'SPAM']}};
    const gw = fakeGateway({labels: LABELS, filters: [prior]});
    rebuildFilters_([], true, false, {gw: gw, spec: SPEC, superseded: []});
    assertContains(gw.calls.created[0].action.removeLabelIds, 'SPAM',
      'A repair must not drop settings the spec does not manage');
  }, results);

  runTest('rebuildFilters_ leaves an already-correct filter alone', function()
  {
    const prior = {id: 'f1', criteria: {from: 'a@x.com'},
      action: {addLabelIds: [READING], removeLabelIds: ['INBOX']}};
    const gw = fakeGateway({labels: LABELS, filters: [prior]});
    rebuildFilters_([], true, false, {gw: gw, spec: SPEC, superseded: []});
    assertEquals(writeCount(gw), 0, 'Correct filter needs no work');
  }, results);

  // --- rebuildFilters_: hand-edited protection ---

  runTest('rebuildFilters_ does not overwrite a hand-edited filter', function()
  {
    const prior = {id: 'f1', criteria: {from: 'a@x.com'},
      action: {addLabelIds: [READING, 'Label_496'], removeLabelIds: ['INBOX']}};
    const gw = fakeGateway({labels: LABELS, filters: [prior]});
    const out = [];
    rebuildFilters_(out, true, false, {gw: gw, spec: SPEC, superseded: []});
    assertEquals(writeCount(gw), 0, 'Hand edits must survive a rebuild');
    assert(out.join('\n').indexOf('MANUAL') !== -1, 'Should report it as MANUAL');
  }, results);

  runTest('rebuildFilters_ overwrites a hand-edited filter under force', function()
  {
    const prior = {id: 'f1', criteria: {from: 'a@x.com'},
      action: {addLabelIds: [READING, 'Label_496'], removeLabelIds: ['INBOX']}};
    const gw = fakeGateway({labels: LABELS, filters: [prior]});
    rebuildFilters_([], true, true, {gw: gw, spec: SPEC, superseded: []});
    assertDeepEquals(gw.calls.removedFilters, ['f1'], 'force should delete it');
    assertEquals(gw.calls.created.length, 1, 'force should recreate it to spec');
  }, results);

  // --- rebuildFilters_: failure reporting ---

  runTest('rebuildFilters_ reports a failed create instead of counting success', function()
  {
    const gw = fakeGateway({labels: LABELS, filters: [], createError: 'invalid criteria'});
    const out = [];
    rebuildFilters_(out, true, false, {gw: gw, spec: SPEC, superseded: []});
    const text = out.join('\n');
    assertEquals(gw.calls.created.length, 0, 'Nothing was created');
    assert(text.indexOf('FAILED') !== -1, 'Should print FAILED');
    assert(text.indexOf('ACTION REQUIRED') !== -1, 'Should raise ACTION REQUIRED');
    assert(text.indexOf('Created 0') !== -1, 'Must not count a failure as created');
  }, results);

  runTest('rebuildFilters_ warns the sender is unfiled when a repair fails', function()
  {
    const prior = {id: 'f1', criteria: {from: 'a@x.com'}, action: {addLabelIds: [], removeLabelIds: []}};
    const gw = fakeGateway({labels: LABELS, filters: [prior], createError: 'invalid criteria'});
    const out = [];
    rebuildFilters_(out, true, false, {gw: gw, spec: SPEC, superseded: []});
    assertDeepEquals(gw.calls.removedFilters, ['f1'], 'Prior filter was already deleted');
    assert(out.join('\n').indexOf('UNFILED') !== -1, 'Must say the sender is now unfiled');
  }, results);

  // --- rebuildFilters_: refuses to write a bad spec ---

  runTest('rebuildFilters_ aborts on a conflicting spec without writing', function()
  {
    const gw = fakeGateway({labels: LABELS, filters: []});
    const spec = [
      {from: 'a@x.com', label: 'Reading', skipInbox: true},
      {from: 'a@x.com', label: 'Misc', skipInbox: true}
    ];
    const out = [];
    rebuildFilters_(out, true, false, {gw: gw, spec: spec, superseded: []});
    assertEquals(writeCount(gw), 0, 'A double-labelling spec must not be written');
    assert(out.join('\n').indexOf('ABORTING') !== -1, 'Should say it aborted');
  }, results);

  runTest('rebuildFilters_ aborts when a target label is missing', function()
  {
    const gw = fakeGateway({labels: [], filters: []});
    rebuildFilters_([], true, false, {gw: gw, spec: SPEC, superseded: []});
    assertEquals(writeCount(gw), 0, 'Missing destination must abort before writing');
  }, results);

  runTest('rebuildFilters_ deletes a superseded filter', function()
  {
    const stale = {id: 'old1', criteria: {from: 'narrow@x.com'}, action: {addLabelIds: [READING]}};
    const gw = fakeGateway({labels: LABELS, filters: [stale]});
    rebuildFilters_([], true, false,
      {gw: gw, spec: SPEC, superseded: [{from: 'narrow@x.com'}]});
    assertContains(gw.calls.removedFilters, 'old1', 'Superseded filter should go');
  }, results);

  // --- mergeDrift_ ---

  runTest('mergeDrift_ moves threads and deletes the emptied source', function()
  {
    const src = fakeLabel('Old/Label', 3, 0);
    const dst = fakeLabel('Reading', 0, 0);
    const gw = fakeGateway({labelsByName: {'Old/Label': src, 'Reading': dst}});
    mergeDrift_([], true, {gw: gw, merges: [{src: 'Old/Label', dst: 'Reading'}], shells: []});
    assertEquals(dst.added.length, 3, 'All threads should land in the destination');
    assertDeepEquals(gw.calls.deletedLabels, ['Old/Label'], 'Emptied source should be deleted');
  }, results);

  runTest('mergeDrift_ keeps a source that still has threads', function()
  {
    const src = fakeLabel('Old/Label', 2, 1);
    const dst = fakeLabel('Reading', 0, 0);
    const gw = fakeGateway({labelsByName: {'Old/Label': src, 'Reading': dst}});
    const out = [];
    mergeDrift_(out, true, {gw: gw, merges: [{src: 'Old/Label', dst: 'Reading'}], shells: []});
    assertEquals(gw.calls.deletedLabels.length, 0, 'Must not delete a non-empty label');
    assert(out.join('\n').indexOf('NOT deleting') !== -1, 'Should say why');
  }, results);

  runTest('mergeDrift_ skips a merge whose destination is missing', function()
  {
    const src = fakeLabel('Old/Label', 3, 0);
    const gw = fakeGateway({labelsByName: {'Old/Label': src}});
    const out = [];
    mergeDrift_(out, true, {gw: gw, merges: [{src: 'Old/Label', dst: 'Gone'}], shells: []});
    assertEquals(writeCount(gw), 0, 'Must not move threads into a missing label');
    assert(out.join('\n').indexOf('destination missing') !== -1, 'Should explain the skip');
  }, results);

  runTest('mergeDrift_ dry-run writes nothing', function()
  {
    const src = fakeLabel('Old/Label', 3, 0);
    const dst = fakeLabel('Reading', 0, 0);
    const gw = fakeGateway({labelsByName: {'Old/Label': src, 'Reading': dst}});
    mergeDrift_([], false, {gw: gw, merges: [{src: 'Old/Label', dst: 'Reading'}], shells: []});
    assertEquals(dst.added.length, 0, 'Dry-run must not move anything');
    assertEquals(writeCount(gw), 0, 'Dry-run must not delete anything');
  }, results);

  runTest('mergeDrift_ deletes an empty shell but not a populated one', function()
  {
    const empty = fakeLabel('Empty/Shell', 0, 0);
    const full = fakeLabel('Full/Shell', 0, 1);
    const gw = fakeGateway({labelsByName: {'Empty/Shell': empty, 'Full/Shell': full}});
    mergeDrift_([], true, {gw: gw, merges: [], shells: ['Empty/Shell', 'Full/Shell']});
    assertDeepEquals(gw.calls.deletedLabels, ['Empty/Shell'], 'Only the empty shell should go');
  }, results);

  // --- linkedinNoiseBackfill_ ---

  runTest('linkedinNoiseBackfill_ moves matching threads', function()
  {
    const jobs = fakeLabel('Career/Jobs', 0, 0);
    const misc = fakeLabel('Misc', 0, 0);
    const hits = [{id: 't1'}, {id: 't2'}];
    const gw = fakeGateway({
      labelsByName: {'Career/Jobs': jobs, 'Misc': misc},
      searchResults: [hits, []]
    });
    linkedinNoiseBackfill_([], true,
      {gw: gw, src: 'Career/Jobs', dst: 'Misc', query: 'q'});
    assertEquals(misc.added.length, 2, 'Both threads should move to the destination');
  }, results);

  runTest('linkedinNoiseBackfill_ dry-run writes nothing', function()
  {
    const jobs = fakeLabel('Career/Jobs', 0, 0);
    const misc = fakeLabel('Misc', 0, 0);
    const gw = fakeGateway({
      labelsByName: {'Career/Jobs': jobs, 'Misc': misc},
      searchResults: [[{id: 't1'}], []]
    });
    linkedinNoiseBackfill_([], false,
      {gw: gw, src: 'Career/Jobs', dst: 'Misc', query: 'q'});
    assertEquals(misc.added.length, 0, 'Dry-run must not move anything');
  }, results);

  runTest('linkedinNoiseBackfill_ aborts when a label is missing', function()
  {
    const gw = fakeGateway({labelsByName: {'Career/Jobs': fakeLabel('Career/Jobs', 0, 0)}});
    const out = [];
    linkedinNoiseBackfill_(out, true,
      {gw: gw, src: 'Career/Jobs', dst: 'Misc', query: 'q'});
    assertEquals(gw.calls.searches, 0, 'Must not search before checking labels exist');
    assert(out.join('\n').indexOf('ABORT') !== -1, 'Should abort loudly');
  }, results);
}

// ============================================================================
// VALIDATION TESTS
// ============================================================================

/**
 * Test suite for validateLabelName function
 *
 * @param {Object} results - Results accumulator
 */
function testValidateLabelName(results)
{
  Logger.log('=== validateLabelName Tests ===');

  runTest('Valid simple label', function()
  {
    const result = validateLabelName('MyLabel');
    assert(result.valid === true, 'Should be valid');
    assertNull(result.reason, 'Should have no reason');
  }, results);

  runTest('Valid nested label', function()
  {
    const result = validateLabelName('Parent/Child/Grandchild');
    assert(result.valid === true, 'Should be valid');
  }, results);

  runTest('Empty label rejected', function()
  {
    const result = validateLabelName('');
    assert(result.valid === false, 'Should be invalid');
    assertNotNull(result.reason, 'Should have a reason');
  }, results);

  runTest('Null label rejected', function()
  {
    const result = validateLabelName(null);
    assert(result.valid === false, 'Should be invalid');
  }, results);

  runTest('Whitespace-only label rejected', function()
  {
    const result = validateLabelName('   ');
    assert(result.valid === false, 'Should be invalid');
  }, results);

  runTest('Reserved label "inbox" rejected', function()
  {
    const result = validateLabelName('inbox');
    assert(result.valid === false, 'Should be invalid');
    assert(result.reason.indexOf('reserved') > -1, 'Should mention reserved');
  }, results);

  runTest('Reserved label case insensitive', function()
  {
    const result = validateLabelName('INBOX');
    assert(result.valid === false, 'Should be invalid');
  }, results);

  runTest('Invalid character < rejected', function()
  {
    const result = validateLabelName('Test<Label');
    assert(result.valid === false, 'Should be invalid');
    assert(result.reason.indexOf('<') > -1, 'Should mention the character');
  }, results);

  runTest('Invalid character & rejected', function()
  {
    const result = validateLabelName('Test&Label');
    assert(result.valid === false, 'Should be invalid');
  }, results);

  runTest('Label exceeding 225 chars rejected', function()
  {
    let longName = '';
    for (let i = 0; i < 230; i++)
    {
      longName += 'a';
    }
    const result = validateLabelName(longName);
    assert(result.valid === false, 'Should be invalid');
    assert(result.reason.indexOf('225') > -1, 'Should mention limit');
  }, results);

  runTest('Label at exactly 225 chars accepted', function()
  {
    let exactName = '';
    for (let i = 0; i < 225; i++)
    {
      exactName += 'a';
    }
    const result = validateLabelName(exactName);
    assert(result.valid === true, 'Should be valid');
  }, results);
}

// ============================================================================
// ORGANIZATION PLAN VALIDATION TESTS
// ============================================================================

/**
 * Test suite for validateOrganizationPlan function
 *
 * @param {Object} results - Results accumulator
 */
function testValidateOrganizationPlan(results)
{
  Logger.log('=== validateOrganizationPlan Tests ===');

  runTest('Null plan rejected', function()
  {
    const result = validateOrganizationPlan(null);
    assert(result.valid === false, 'Should be invalid');
    assert(result.errors.length > 0, 'Should have errors');
  }, results);

  runTest('Plan without newLabels rejected', function()
  {
    const result = validateOrganizationPlan({migrations: []});
    assert(result.valid === false, 'Should be invalid');
    assert(result.errors.some(function(e)
    {
      return e.indexOf('newLabels') > -1;
    }), 'Should mention newLabels');
  }, results);

  runTest('Plan without migrations rejected', function()
  {
    const result = validateOrganizationPlan({newLabels: []});
    assert(result.valid === false, 'Should be invalid');
  }, results);

  runTest('Valid empty plan accepted', function()
  {
    const result = validateOrganizationPlan({newLabels: [], migrations: []});
    assert(result.valid === true, 'Should be valid');
  }, results);

  runTest('Plan with valid labels accepted', function()
  {
    const result = validateOrganizationPlan({
      newLabels: ['Personal', 'Work', 'Archive'],
      migrations: []
    });
    assert(result.valid === true, 'Should be valid');
    assertEquals(result.errors.length, 0, 'Should have no errors');
  }, results);

  runTest('Plan with invalid label rejected', function()
  {
    const result = validateOrganizationPlan({
      newLabels: ['Personal', 'inbox', 'Archive'],
      migrations: []
    });
    assert(result.valid === false, 'Should be invalid');
  }, results);

  runTest('Migration without from field rejected', function()
  {
    const result = validateOrganizationPlan({
      newLabels: ['Archive'],
      migrations: [{to: 'Archive'}]
    });
    assert(result.valid === false, 'Should be invalid');
    assert(result.errors.some(function(e)
    {
      return e.indexOf('from') > -1;
    }), 'Should mention from');
  }, results);

  runTest('Migration without to field rejected', function()
  {
    const result = validateOrganizationPlan({
      newLabels: ['Archive'],
      migrations: [{from: 'OldLabel'}]
    });
    assert(result.valid === false, 'Should be invalid');
  }, results);

  runTest('Duplicate migrations generate warning', function()
  {
    const result = validateOrganizationPlan({
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
  }, results);
}

// ============================================================================
// TIME MANAGEMENT TESTS
// ============================================================================

/**
 * Test suite for time management functions
 *
 * @param {Object} results - Results accumulator
 */
function testTimeManagement(results)
{
  Logger.log('=== Time Management Tests ===');

  runTest('hasTimeRemaining returns true when time available', function()
  {
    const startTime = new Date().getTime();
    const result = hasTimeRemaining(startTime, 300000, 30000);
    assert(result === true, 'Should have time remaining');
  }, results);

  runTest('hasTimeRemaining returns false when time expired', function()
  {
    const startTime = new Date().getTime() - 300000;  // 5 minutes ago
    const result = hasTimeRemaining(startTime, 300000, 30000);
    assert(result === false, 'Should not have time remaining');
  }, results);

  runTest('hasTimeRemaining respects buffer', function()
  {
    const startTime = new Date().getTime() - 275000;  // 4:35 elapsed
    const result = hasTimeRemaining(startTime, 300000, 30000);  // 30s buffer
    assert(result === false, 'Should account for buffer');
  }, results);

  runTest('hasTimeRemaining default buffer is 30000', function()
  {
    const startTime = new Date().getTime() - 260000;  // 4:20 elapsed
    const result = hasTimeRemaining(startTime, 300000);
    assert(result === true, 'Should use default buffer');
  }, results);

  runTest('getRemainingSeconds calculates correctly', function()
  {
    const startTime = new Date().getTime() - 60000;  // 1 minute ago
    const result = getRemainingSeconds(startTime, 300000);
    assert(result >= 239 && result <= 241, 'Should be around 240 seconds');
  }, results);

  runTest('getRemainingSeconds never returns negative', function()
  {
    const startTime = new Date().getTime() - 400000;  // Past limit
    const result = getRemainingSeconds(startTime, 300000);
    assertEquals(result, 0, 'Should return 0, not negative');
  }, results);
}

// ============================================================================
// RETRY HELPER TESTS
// ============================================================================

/**
 * Test suite for withRetry and isTransientError.
 * Uses tiny baseDelayMs so the suite runs in milliseconds.
 *
 * @param {Object} results - Results accumulator
 */
function testRetryHelpers(results)
{
  Logger.log('=== Retry Helper Tests ===');

  // --- isTransientError classification ---

  runTest('isTransientError detects 503', function()
  {
    assert(isTransientError(new Error('Service Unavailable (503)')), 'Should match 503');
  }, results);

  runTest('isTransientError detects 429 rate limit', function()
  {
    assert(isTransientError(new Error('429 Too Many Requests')), 'Should match 429');
  }, results);

  runTest('isTransientError detects Apps Script quota message', function()
  {
    assert(isTransientError(new Error('Service invoked too many times for one day')),
           'Should match Apps Script quota');
  }, results);

  runTest('isTransientError detects timeout', function()
  {
    assert(isTransientError(new Error('Operation timed out')), 'Should match timed out');
  }, results);

  runTest('isTransientError rejects permanent error', function()
  {
    assert(!isTransientError(new Error('Label not found')), 'Should not match permanent error');
  }, results);

  runTest('isTransientError handles null/undefined', function()
  {
    assert(!isTransientError(null), 'Should not throw on null');
    assert(!isTransientError(undefined), 'Should not throw on undefined');
    assert(!isTransientError({}), 'Should not throw on plain object');
  }, results);

  // --- withRetry success paths ---

  runTest('withRetry returns value when fn succeeds first try', function()
  {
    let calls = 0;
    const result = withRetry(function() { calls++; return 'ok'; }, 'first-try',
                             {baseDelayMs: 1});
    assertEquals(result, 'ok', 'Should return fn value');
    assertEquals(calls, 1, 'Should call fn exactly once');
  }, results);

  runTest('withRetry retries on transient then succeeds', function()
  {
    let calls = 0;
    const result = withRetry(function()
    {
      calls++;
      if (calls < 3) { throw new Error('503 Service Unavailable'); }
      return 'recovered';
    }, 'retry-then-succeed', {baseDelayMs: 1, maxAttempts: 4});
    assertEquals(result, 'recovered', 'Should return after retries');
    assertEquals(calls, 3, 'Should call fn three times');
  }, results);

  // --- withRetry failure paths ---

  runTest('withRetry throws immediately on permanent error', function()
  {
    let calls = 0;
    let threw = false;
    try
    {
      withRetry(function() { calls++; throw new Error('Label not found'); },
                'permanent', {baseDelayMs: 1, maxAttempts: 4});
    }
    catch (e) { threw = true; }
    assert(threw, 'Should throw');
    assertEquals(calls, 1, 'Should not retry permanent errors');
  }, results);

  runTest('withRetry throws after exhausting attempts on transient', function()
  {
    let calls = 0;
    let threw = false;
    try
    {
      withRetry(function() { calls++; throw new Error('429 rate limit'); },
                'exhaust', {baseDelayMs: 1, maxAttempts: 3});
    }
    catch (e) { threw = true; }
    assert(threw, 'Should throw after exhausting');
    assertEquals(calls, 3, 'Should call fn maxAttempts times');
  }, results);

  // --- withRetry time-budget enforcement ---

  runTest('withRetry aborts retry when budget would be exceeded', function()
  {
    let calls = 0;
    let threw = false;
    const ancientStart = new Date().getTime() - 290000;  // nearly exhausted 300s budget
    try
    {
      withRetry(function() { calls++; throw new Error('503 backend error'); },
                'budget-aware',
                {baseDelayMs: 30000, maxAttempts: 4,  // 30s+ backoff exceeds remaining ~10s
                 runStartTime: ancientStart, maxRuntimeMs: 300000});
    }
    catch (e) { threw = true; }
    assert(threw, 'Should throw when budget exceeded');
    assertEquals(calls, 1, 'Should not retry when delay exceeds remaining runtime');
  }, results);

  // --- withRetry telemetry ---

  runTest('withRetry invokes onRetry callback with attempt and error', function()
  {
    const retryLog = [];
    try
    {
      withRetry(function() { throw new Error('503'); },
                'telemetry',
                {baseDelayMs: 1, maxAttempts: 3,
                 onRetry: function(attempt, err, delay)
                 {
                   retryLog.push({attempt: attempt, msg: err.message, delay: delay});
                 }});
    }
    catch (e) { /* expected */ }
    // Two retries before final failure on attempt 3
    assertEquals(retryLog.length, 2, 'Should invoke onRetry twice (between attempts)');
    assertEquals(retryLog[0].attempt, 1, 'First retry callback is for attempt 1');
    assertEquals(retryLog[1].attempt, 2, 'Second retry callback is for attempt 2');
    assert(retryLog[0].delay >= 1, 'Delay should be set');
  }, results);

  runTest('withRetry survives onRetry callback throwing', function()
  {
    let calls = 0;
    let succeeded = false;
    try
    {
      withRetry(function()
      {
        calls++;
        if (calls < 2) { throw new Error('503'); }
        return 'ok';
      }, 'bad-callback',
         {baseDelayMs: 1, maxAttempts: 3,
          onRetry: function() { throw new Error('telemetry blew up'); }});
      succeeded = true;
    }
    catch (e) { /* should not happen */ }
    assert(succeeded, 'withRetry should not propagate onRetry errors');
    assertEquals(calls, 2, 'fn should still be retried after onRetry throws');
  }, results);
}

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

/**
 * Test suite for utility functions
 *
 * @param {Object} results - Results accumulator
 */
function testUtilityFunctions(results)
{
  Logger.log('=== Utility Function Tests ===');

  runTest('formatTimestamp returns ISO format', function()
  {
    const result = formatTimestamp();
    assert(result.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/), 'Should be ISO format');
  }, results);

  runTest('PROPERTY_KEYS are defined', function()
  {
    assertNotNull(PROPERTY_KEYS.MIGRATION_STATE, 'MIGRATION_STATE should exist');
    assertNotNull(PROPERTY_KEYS.LAST_RUN, 'LAST_RUN should exist');
    assertNotNull(PROPERTY_KEYS.COMPLETED_MIGRATIONS, 'COMPLETED_MIGRATIONS should exist');
    assertNotNull(PROPERTY_KEYS.STATISTICS, 'STATISTICS should exist');
  }, results);

  runTest('RESERVED_LABELS contains common labels', function()
  {
    assertContains(RESERVED_LABELS, 'inbox', 'Should contain inbox');
    assertContains(RESERVED_LABELS, 'sent', 'Should contain sent');
    assertContains(RESERVED_LABELS, 'trash', 'Should contain trash');
    assertContains(RESERVED_LABELS, 'spam', 'Should contain spam');
  }, results);

  runTest('INVALID_LABEL_CHARS contains special characters', function()
  {
    assertContains(INVALID_LABEL_CHARS, '&', 'Should contain &');
    assertContains(INVALID_LABEL_CHARS, '<', 'Should contain <');
    assertContains(INVALID_LABEL_CHARS, '>', 'Should contain >');
  }, results);
}

// ============================================================================
// STATE PERSISTENCE TESTS
// ============================================================================

/**
 * Test suite for state persistence functions.
 * Note: These tests use actual PropertiesService.
 *
 * @param {Object} results - Results accumulator
 */
function testStatePersistence(results)
{
  Logger.log('=== State Persistence Tests ===');

  // Clean up before tests
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROPERTY_KEYS.MIGRATION_STATE);
  props.deleteProperty(PROPERTY_KEYS.COMPLETED_MIGRATIONS);
  props.deleteProperty(PROPERTY_KEYS.STATISTICS);

  runTest('loadMigrationState returns null when no state', function()
  {
    const result = loadMigrationState();
    assertNull(result, 'Should return null');
  }, results);

  runTest('saveMigrationState and loadMigrationState roundtrip', function()
  {
    const testState = {lastIndex: 5, timestamp: '2024-01-01'};
    saveMigrationState(testState);
    const result = loadMigrationState();
    assertDeepEquals(result, testState, 'Should roundtrip correctly');
  }, results);

  runTest('clearMigrationState removes state', function()
  {
    saveMigrationState({test: true});
    clearMigrationState();
    const result = loadMigrationState();
    assertNull(result, 'Should be cleared');
  }, results);

  runTest('getCompletedMigrations returns empty array when none', function()
  {
    const result = getCompletedMigrations();
    assert(Array.isArray(result), 'Should be array');
    assertEquals(result.length, 0, 'Should be empty');
  }, results);

  runTest('markMigrationCompleted adds to list', function()
  {
    markMigrationCompleted('OldLabel', 'NewLabel', 10);
    const result = getCompletedMigrations();
    assertEquals(result.length, 1, 'Should have one entry');
    assertEquals(result[0].from, 'OldLabel', 'Should have correct from');
    assertEquals(result[0].to, 'NewLabel', 'Should have correct to');
    assertEquals(result[0].threads, 10, 'Should have correct threads');
  }, results);

  runTest('isMigrationCompleted returns true for completed', function()
  {
    const result = isMigrationCompleted('OldLabel');
    assert(result === true, 'Should return true');
  }, results);

  runTest('isMigrationCompleted returns false for not completed', function()
  {
    const result = isMigrationCompleted('NonExistent');
    assert(result === false, 'Should return false');
  }, results);

  runTest('getStatistics returns object', function()
  {
    const result = getStatistics();
    assert(typeof result === 'object', 'Should be object');
  }, results);

  runTest('updateStatistics increments values', function()
  {
    updateStatistics(100, 5);
    const result = getStatistics();
    assert(result.totalThreadsProcessed >= 100, 'Should have threads');
    assert(result.totalLabelsCreated >= 5, 'Should have labels');
    assert(result.runCount >= 1, 'Should have run count');
  }, results);

  runTest('resetAllMigrationTracking clears everything', function()
  {
    resetAllMigrationTracking();
    assertNull(loadMigrationState(), 'State should be null');
    assertEquals(getCompletedMigrations().length, 0, 'Completed should be empty');
  }, results);
}

// ============================================================================
// CATEGORY DETECTION TESTS
// ============================================================================

/**
 * Test suite for category detection
 *
 * @param {Object} results - Results accumulator
 */
function testCategoryDetection(results)
{
  Logger.log('=== Category Detection Tests ===');

  runTest('detectCategory finds work keywords', function()
  {
    assertEquals(detectCategory('myproject'), 'work', 'Should detect project as work');
    assertEquals(detectCategory('client-acme'), 'work', 'Should detect client as work');
  }, results);

  runTest('detectCategory finds finance keywords', function()
  {
    assertEquals(detectCategory('bank-statements'), 'finance', 'Should detect bank as finance');
    assertEquals(detectCategory('taxes-2024'), 'finance', 'Should detect tax as finance');
  }, results);

  runTest('detectCategory finds personal keywords', function()
  {
    assertEquals(detectCategory('family-updates'), 'personal', 'Should detect family as personal');
  }, results);

  runTest('detectCategory finds shopping keywords', function()
  {
    assertEquals(detectCategory('amazon-orders'), 'shopping', 'Should detect amazon as shopping');
    assertEquals(detectCategory('shipping-info'), 'shopping', 'Should detect shipping as shopping');
  }, results);

  runTest('detectCategory returns null for unknown', function()
  {
    assertNull(detectCategory('randomlabel123'), 'Should return null for unknown');
  }, results);

  runTest('CATEGORY_PATTERNS structure is valid', function()
  {
    for (const cat of Object.keys(CATEGORY_PATTERNS))
    {
      assert(Array.isArray(CATEGORY_PATTERNS[cat].keywords), cat + ' should have keywords array');
      assert(Array.isArray(CATEGORY_PATTERNS[cat].domains), cat + ' should have domains array');
    }
  }, results);
}

// ============================================================================
// INPUT VALIDATION EDGE CASES
// ============================================================================

/**
 * Test edge cases and boundary conditions
 *
 * @param {Object} results - Results accumulator
 */
function testEdgeCases(results)
{
  Logger.log('=== Edge Case Tests ===');

  runTest('validateLabelName handles undefined', function()
  {
    const result = validateLabelName(undefined);
    assert(result.valid === false, 'Should reject undefined');
  }, results);

  runTest('validateLabelName handles number input', function()
  {
    const result = validateLabelName(123);
    // Should handle gracefully - either reject or convert
    assert(result !== undefined, 'Should not crash');
  }, results);

  runTest('validateLabelName handles object input', function()
  {
    const result = validateLabelName({name: 'test'});
    assert(result !== undefined, 'Should not crash');
  }, results);

  runTest('Empty migrations array is valid', function()
  {
    const result = validateOrganizationPlan({
      newLabels: ['Test'],
      migrations: []
    });
    assert(result.valid === true, 'Empty migrations should be valid');
  }, results);

  runTest('Labels with spaces are valid', function()
  {
    const result = validateLabelName('My Label Name');
    assert(result.valid === true, 'Labels with spaces should be valid');
  }, results);

  runTest('Labels with numbers are valid', function()
  {
    const result = validateLabelName('Project2024');
    assert(result.valid === true, 'Labels with numbers should be valid');
  }, results);

  runTest('Labels with dashes are valid', function()
  {
    const result = validateLabelName('my-label-name');
    assert(result.valid === true, 'Labels with dashes should be valid');
  }, results);

  runTest('Labels with underscores are valid', function()
  {
    const result = validateLabelName('my_label_name');
    assert(result.valid === true, 'Labels with underscores should be valid');
  }, results);
}

// ============================================================================
// CONFIGURATION VALIDATION TESTS
// ============================================================================

/**
 * Test configuration objects
 *
 * @param {Object} results - Results accumulator
 */
function testConfiguration(results)
{
  Logger.log('=== Configuration Tests ===');

  runTest('CONFIG object exists', function()
  {
    assertNotNull(CONFIG, 'CONFIG should exist');
  }, results);

  runTest('CONFIG has required properties', function()
  {
    assert('DRY_RUN' in CONFIG, 'Should have DRY_RUN');
    assert('BATCH_SIZE' in CONFIG, 'Should have BATCH_SIZE');
    assert('MAX_RUNTIME_MS' in CONFIG, 'Should have MAX_RUNTIME_MS');
  }, results);

  runTest('CONFIG.DRY_RUN defaults to true', function()
  {
    assert(CONFIG.DRY_RUN === true, 'DRY_RUN should default to true for safety');
  }, results);

  runTest('CONFIG.BATCH_SIZE is reasonable', function()
  {
    assert(CONFIG.BATCH_SIZE > 0, 'BATCH_SIZE should be positive');
    assert(CONFIG.BATCH_SIZE <= 500, 'BATCH_SIZE should not exceed API limits');
  }, results);

  runTest('CONFIG.MAX_RUNTIME_MS is under 6 minutes', function()
  {
    assert(CONFIG.MAX_RUNTIME_MS < 360000, 'Should be under Apps Script limit');
  }, results);

  runTest('BACKUP_CONFIG object exists', function()
  {
    assertNotNull(BACKUP_CONFIG, 'BACKUP_CONFIG should exist');
  }, results);

  runTest('ORGANIZATION_PLAN has required structure', function()
  {
    assert(Array.isArray(ORGANIZATION_PLAN.newLabels), 'Should have newLabels array');
    assert(Array.isArray(ORGANIZATION_PLAN.migrations), 'Should have migrations array');
  }, results);
}

// ============================================================================
// TEST RUNNER
// ============================================================================

/**
 * Run all test suites.
 * Call this function to execute the complete test suite.
 *
 * @return {Object} {passed, failed, errors}
 */
function runAllTests()
{
  const results = {passed: 0, failed: 0, errors: []};

  Logger.log('');
  Logger.log('========================================');
  Logger.log('   GMAIL REORG LIBRARY - TEST SUITE    ');
  Logger.log('========================================');
  Logger.log('');

  // Run all test suites
  testValidateLabelName(results);
  Logger.log('');

  testFilterSpec(results);
  Logger.log('');

  testMutatingPaths(results);
  Logger.log('');

  testValidateOrganizationPlan(results);
  Logger.log('');

  testTimeManagement(results);
  Logger.log('');

  testRetryHelpers(results);
  Logger.log('');

  testUtilityFunctions(results);
  Logger.log('');

  testStatePersistence(results);
  Logger.log('');

  testCategoryDetection(results);
  Logger.log('');

  testEdgeCases(results);
  Logger.log('');

  testConfiguration(results);
  Logger.log('');

  // Summary
  Logger.log('========================================');
  Logger.log('              TEST RESULTS             ');
  Logger.log('========================================');
  Logger.log('');
  Logger.log('  Passed: ' + results.passed);
  Logger.log('  Failed: ' + results.failed);
  Logger.log('  Total:  ' + (results.passed + results.failed));
  Logger.log('');

  if (results.failed > 0)
  {
    Logger.log('=== FAILURES ===');
    for (let i = 0; i < results.errors.length; i++)
    {
      const err = results.errors[i];
      Logger.log('  ' + err.test + ': ' + err.error);
    }
  }
  else
  {
    Logger.log('All tests passed!');
  }

  Logger.log('');

  return results;
}

/**
 * Quick smoke test - runs minimal tests to verify basic functionality.
 * Use this for fast validation that the library is working.
 *
 * @return {boolean} True if all smoke tests passed
 */
function runSmokeTests()
{
  Logger.log('=== SMOKE TESTS ===');

  const results = {passed: 0, failed: 0, errors: []};

  runTest('validateLabelName exists and works', function()
  {
    const result = validateLabelName('Test');
    assert(result.valid === true, 'Basic validation should work');
  }, results);

  runTest('validateOrganizationPlan exists and works', function()
  {
    const result = validateOrganizationPlan({newLabels: [], migrations: []});
    assert(result.valid === true, 'Basic plan validation should work');
  }, results);

  runTest('Time functions exist and work', function()
  {
    const start = new Date().getTime();
    assert(hasTimeRemaining(start, 300000) === true, 'Time check should work');
  }, results);

  runTest('State functions exist', function()
  {
    assert(typeof loadMigrationState === 'function', 'loadMigrationState should exist');
    assert(typeof saveMigrationState === 'function', 'saveMigrationState should exist');
  }, results);

  Logger.log('');
  Logger.log('Smoke tests: ' + results.passed + ' passed, ' + results.failed + ' failed');

  return results.failed === 0;
}
