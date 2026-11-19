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

  // --- hostile input ---
  // Sender addresses come from message headers, so they are attacker-chosen.

  runTest('_specAddresses_ handles prototype-shaped criteria without throwing', function()
  {
    assertDeepEquals(_specAddresses_({from: '__proto__'}), ['__proto__'],
      'A prototype-shaped address is data, not a key');
    assertDeepEquals(_specAddresses_({from: 'constructor@x.com'}), ['constructor@x.com'],
      'Should be returned verbatim');
  }, results);

  runTest('_specConflicts_ is not confused by prototype-shaped criteria', function()
  {
    // The conflict map keys are prefixed ("dup|", "sub|"), so a criterion of
    // __proto__ can never land on Object.prototype. This pins that property.
    const spec = [
      {from: '__proto__', label: 'Reading', skipInbox: true},
      {from: '__proto__', label: 'Misc', skipInbox: true}
    ];
    assertEquals(_specConflicts_(spec).length, 1,
      'Duplicate detection must still work for a prototype-shaped key');
  }, results);

  runTest('_filterSig_ keeps prototype-shaped criteria distinct', function()
  {
    assert(_filterSig_('__proto__', null) !== _filterSig_(null, '__proto__'),
      'Signatures must stay distinct regardless of the text');
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

  runTest('_classifyFilter_ protects a filter that only forwards', function()
  {
    const prior = {criteria: {from: 'a@x.com'}, action: {forward: 'me@elsewhere.example'}};
    assertEquals(_classifyFilter_(prior, R, true), 'manual',
      'A rewrite would drop the forward');
  }, results);

  runTest('_classifyFilter_ protects a filter with an extra criterion', function()
  {
    const prior = {criteria: {from: 'a@x.com', subject: 'invoice'}, action: {}};
    assertEquals(_classifyFilter_(prior, R, true), 'manual',
      'A rewrite would drop the subject and widen the filter');
  }, results);

  runTest('_classifyFilter_ protects an archive-only filter for a sender kept in the inbox', function()
  {
    assertEquals(_classifyFilter_(filterWith([], ['INBOX']), R, false), 'manual',
      'A rewrite would drop the archiving');
  }, results);

  runTest('_classifyFilter_ still repairs an archive-only orphan the spec also archives', function()
  {
    assertEquals(_classifyFilter_(filterWith([], ['INBOX']), R, true), 'repair',
      'Nothing is lost: the rewrite keeps skip-inbox');
  }, results);

  runTest('_classifyFilter_ ignores a default size setting', function()
  {
    const prior = {criteria: {from: 'a@x.com', size: 0, sizeComparison: 'unspecified'}, action: {}};
    assertEquals(_classifyFilter_(prior, R, true), 'repair', 'An API default is not user intent');
  }, results);

  runTest('_classifyFilter_ protects a real size rule', function()
  {
    const prior = {criteria: {from: 'a@x.com', size: 1000000, sizeComparison: 'larger'}, action: {}};
    assertEquals(_classifyFilter_(prior, R, true), 'manual', 'A size rule is user intent');
  }, results);

  runTest('_classifyFilter_ ignores unmanaged fields that are empty', function()
  {
    const prior = {criteria: {from: 'a@x.com', subject: '', hasAttachment: false},
      action: {addLabelIds: [], forward: ''}};
    assertEquals(_classifyFilter_(prior, R, true), 'repair',
      'Empty fields carry no user intent');
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
 * Build a fake Gmail gateway that records every write.
 *
 * @param {Object} state - {labels, filters, userLabels, labelsByName, inbox, createError}
 * @return {Object} Gateway with a .calls record
 */
function fakeGateway(state)
{
  const calls = {created: [], removedFilters: []};

  return {
    calls: calls,
    listLabels: function() { return state.labels || []; },
    listFilters: function() { return state.filters || []; },
    getUserLabels: function() { return state.userLabels || []; },
    getUserLabelByName: function(name)
    {
      return Object.prototype.hasOwnProperty.call(state.labelsByName || {}, name) ?
        state.labelsByName[name] : null;
    },
    search: function(query, start, max)
    {
      return (state.inbox || []).slice(start, start + max);
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
 * Count the writes that went through the gateway: filter creates and filter
 * deletes.
 *
 * @param {Object} gw - Fake gateway
 * @return {number} Number of gateway writes recorded
 */
function gatewayWrites(gw)
{
  return gw.calls.created.length + gw.calls.removedFilters.length;
}

/**
 * Test suite for the toolkit's write paths: rebuildFilters_, the maintenance
 * trigger, the Web App token and auth check, and dependency injection.
 *
 * Each test drives the real function through a fake, so the code path under
 * test is the production one — only the Google services are substituted.
 *
 * @param {Object} results - Results accumulator
 */
function testMutatingPaths(results)
{
  Logger.log('=== Mutating Path Tests ===');

  const READING = 'Label_480';
  const LABELS = [{id: READING, name: 'Reading'}, {id: 'Label_496', name: 'Misc'}];
  const SPEC = [{from: 'a@x.com', label: 'Reading', skipInbox: true}];

  // --- scheduled maintenance trigger ---

  /**
   * Build a fake ScriptApp that records trigger creation and deletion.
   *
   * @param {Array<Object>} existing - Triggers already installed
   * @return {Object} Fake ScriptApp with a .created / .deleted record
   */
  function fakeScriptApp(existing)
  {
    const state = {created: [], deleted: [], triggers: existing.slice()};
    const builder =
    {
      timeBased: function() { return builder; },
      everyDays: function() { return builder; },
      atHour: function() { return builder; },
      create: function() { state.created.push(state.pending); }
    };
    return {
      state: state,
      getProjectTriggers: function() { return state.triggers; },
      deleteTrigger: function(t) { state.deleted.push(t.getHandlerFunction()); },
      newTrigger: function(name) { state.pending = name; return builder; }
    };
  }

  /**
   * Build a fake trigger.
   *
   * @param {string} handler - Handler function name
   * @return {Object} Fake trigger
   */
  function fakeTrigger(handler)
  {
    return {getHandlerFunction: function() { return handler; }};
  }

  runTest('installMaintenanceTrigger creates the trigger when none exists', function()
  {
    const app = fakeScriptApp([]);
    installMaintenanceTrigger({scriptApp: app});
    assertDeepEquals(app.state.created, [_MAINTENANCE_HANDLER], 'Should create exactly one');
    assertEquals(app.state.deleted.length, 0, 'Nothing to delete');
  }, results);

  runTest('installMaintenanceTrigger replaces rather than stacking duplicates', function()
  {
    // Installing twice is the likely human error; it must not leave the
    // maintenance sweep running two or three times a night.
    const app = fakeScriptApp([fakeTrigger(_MAINTENANCE_HANDLER)]);
    installMaintenanceTrigger({scriptApp: app});
    assertDeepEquals(app.state.deleted, [_MAINTENANCE_HANDLER], 'Should delete the existing one');
    assertEquals(app.state.created.length, 1, 'Should end up with exactly one');
  }, results);

  runTest('installMaintenanceTrigger leaves unrelated triggers alone', function()
  {
    const app = fakeScriptApp([fakeTrigger('someOtherJob')]);
    installMaintenanceTrigger({scriptApp: app});
    assertEquals(app.state.deleted.length, 0, 'Must not delete triggers it does not own');
  }, results);

  runTest('removeMaintenanceTrigger deletes only the maintenance handler', function()
  {
    const app = fakeScriptApp([fakeTrigger(_MAINTENANCE_HANDLER), fakeTrigger('someOtherJob')]);
    removeMaintenanceTrigger({scriptApp: app});
    assertDeepEquals(app.state.deleted, [_MAINTENANCE_HANDLER], 'Only its own handler');
  }, results);

  // --- Web App authorisation ---

  /**
   * Build a fake event object carrying a token parameter.
   *
   * @param {string} [token] - Token to present, or omitted for none
   * @return {Object} Apps Script event-shaped object
   */
  function eventWithToken(token)
  {
    return token === undefined ? {parameter: {}} : {parameter: {token: token}};
  }

  runTest('setWebAppToken produces a long, unique, high-entropy token', function()
  {
    const props = PropertiesService.getScriptProperties();
    const saved = props.getProperty(_TOKEN_PROPERTY);
    try
    {
      const first = setWebAppToken();
      const second = setWebAppToken();
      assert(first.length >= 32, 'Token must be long enough to resist guessing');
      assert(first !== second, 'Each call must produce a fresh token');
      assertEquals(props.getProperty(_TOKEN_PROPERTY), second, 'The latest token must be stored');
      assert(/^[0-9a-f]+$/.test(first), 'Should be hex from the UUID source');
    }
    finally
    {
      if (saved) { props.setProperty(_TOKEN_PROPERTY, saved); }
      else { props.deleteProperty(_TOKEN_PROPERTY); }
    }
  }, results);

  runTest('_constantTimeEquals_ matches identical strings', function()
  {
    assert(_constantTimeEquals_('abc123', 'abc123'), 'Equal strings must compare equal');
  }, results);

  runTest('_constantTimeEquals_ rejects differing strings of equal length', function()
  {
    assert(!_constantTimeEquals_('abc123', 'abc124'), 'One differing byte must fail');
  }, results);

  runTest('_constantTimeEquals_ rejects differing lengths and non-strings', function()
  {
    assert(!_constantTimeEquals_('abc', 'abcd'), 'Different lengths must fail');
    assert(!_constantTimeEquals_(null, 'abc'), 'Non-string must fail, not throw');
    assert(!_constantTimeEquals_('abc', undefined), 'Non-string must fail, not throw');
  }, results);

  runTest('_authorized_ fails closed when no token is configured', function()
  {
    const props = PropertiesService.getScriptProperties();
    const saved = props.getProperty(_TOKEN_PROPERTY);
    props.deleteProperty(_TOKEN_PROPERTY);
    try
    {
      const out = [];
      assert(!_authorized_(eventWithToken('anything'), out),
        'With no token configured every route must be refused, not opened');
      assert(out.join('').indexOf('DENIED') !== -1, 'Should say DENIED');
    }
    finally
    {
      if (saved) { props.setProperty(_TOKEN_PROPERTY, saved); }
    }
  }, results);

  runTest('_authorized_ rejects a missing or wrong token', function()
  {
    const props = PropertiesService.getScriptProperties();
    const saved = props.getProperty(_TOKEN_PROPERTY);
    props.setProperty(_TOKEN_PROPERTY, 'correct-horse-battery-staple');
    try
    {
      assert(!_authorized_(eventWithToken(), []), 'No token must be refused');
      assert(!_authorized_(eventWithToken(''), []), 'Empty token must be refused');
      assert(!_authorized_(eventWithToken('wrong'), []), 'Wrong token must be refused');
      assert(_authorized_(eventWithToken('correct-horse-battery-staple'), []),
        'The configured token must be accepted');
    }
    finally
    {
      if (saved) { props.setProperty(_TOKEN_PROPERTY, saved); }
      else { props.deleteProperty(_TOKEN_PROPERTY); }
    }
  }, results);

  runTest('_authorized_ denial leaks nothing about the request', function()
  {
    const props = PropertiesService.getScriptProperties();
    const saved = props.getProperty(_TOKEN_PROPERTY);
    props.setProperty(_TOKEN_PROPERTY, 'a-real-token');
    try
    {
      const out = [];
      _authorized_({parameter: {token: 'wrong', fn: 'rebuildfilters', apply: '1'}}, out);
      const text = out.join('\n');
      assertEquals(text, 'DENIED', 'Denial must not echo the route, the token, or a reason');
    }
    finally
    {
      if (saved) { props.setProperty(_TOKEN_PROPERTY, saved); }
      else { props.deleteProperty(_TOKEN_PROPERTY); }
    }
  }, results);

  runTest('doGet refuses an unauthorised request before routing', function()
  {
    // Tests the wiring, not the guard: a correct _authorized_ that doGet never
    // calls would leave every route wide open, and every other auth test would
    // still pass.
    const props = PropertiesService.getScriptProperties();
    const saved = props.getProperty(_TOKEN_PROPERTY);
    props.setProperty(_TOKEN_PROPERTY, 'a-real-token');
    try
    {
      const body = doGet({parameter: {fn: 'counts', apply: '1'}}).getContent();
      assertEquals(body, 'DENIED', 'doGet must deny before dispatching to any route');
    }
    finally
    {
      if (saved) { props.setProperty(_TOKEN_PROPERTY, saved); }
      else { props.deleteProperty(_TOKEN_PROPERTY); }
    }
  }, results);

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
    assertEquals(gatewayWrites(gw), 0, 'Dry-run must not write');
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
    assert(!gw.calls.created[0].action.removeLabelIds,
      'A keep-in-inbox filter should omit removeLabelIds entirely, not send an empty array');
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
    assertEquals(gatewayWrites(gw), 0, 'Correct filter needs no work');
  }, results);

  // --- rebuildFilters_: hand-edited protection ---

  runTest('rebuildFilters_ does not overwrite a hand-edited filter', function()
  {
    const prior = {id: 'f1', criteria: {from: 'a@x.com'},
      action: {addLabelIds: [READING, 'Label_496'], removeLabelIds: ['INBOX']}};
    const gw = fakeGateway({labels: LABELS, filters: [prior]});
    const out = [];
    rebuildFilters_(out, true, false, {gw: gw, spec: SPEC, superseded: []});
    assertEquals(gatewayWrites(gw), 0, 'Hand edits must survive a rebuild');
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

  runTest('rebuildFilters_ does not overwrite a filter that forwards mail', function()
  {
    const prior = {id: 'f1', criteria: {from: 'a@x.com'}, action: {forward: 'me@elsewhere.example'}};
    const gw = fakeGateway({labels: LABELS, filters: [prior]});
    const out = [];
    rebuildFilters_(out, true, false, {gw: gw, spec: SPEC, superseded: []});
    assertEquals(gatewayWrites(gw), 0, 'A forwarding filter must survive a rebuild');
    assert(out.join('\n').indexOf('MANUAL') !== -1, 'Should report it as MANUAL');
    assert(out.join('\n').indexOf('forwarding or extra criteria') !== -1, 'Should say why');
  }, results);

  runTest('rebuildFilters_ does not delete a superseded filter that forwards mail', function()
  {
    const stale = {id: 'old1', criteria: {from: 'narrow@x.com'}, action: {forward: 'me@elsewhere.example'}};
    const gw = fakeGateway({labels: LABELS, filters: [stale]});
    const out = [];
    rebuildFilters_(out, true, false, {gw: gw, spec: SPEC, superseded: [{from: 'narrow@x.com'}]});
    assertEquals(gw.calls.removedFilters.length, 0, 'A hand-made superseded filter must survive');
    assert(out.join('\n').indexOf('MANUAL') !== -1, 'Should report it as MANUAL');
  }, results);

  // --- backup_ ---

  /**
   * Build a fake GmailLabel whose getThreads pages over generated thread ids.
   *
   * @param {string} name - Label name
   * @param {number} count - Number of threads on the label
   * @param {number} [failAt] - Throw when asked for a page starting here
   * @return {Object} Fake label
   */
  function fakeBackupLabel(name, count, failAt)
  {
    return {
      getName: function() { return name; },
      getThreads: function(start, max)
      {
        if (failAt !== undefined && start >= failAt)
        {
          // Deliberately not a transient message, so withRetry gives up at once
          // and selftest never sleeps through a real backoff.
          throw new Error('Label read failed (permanent)');
        }
        const page = [];
        for (let i = start; i < Math.min(start + max, count); i++)
        {
          const id = name + '#' + i;
          page.push({getId: function() { return id; }});
        }
        return page;
      }
    };
  }

  /**
   * Build a fake Script Properties store held in memory.
   *
   * @return {Object} Object with getProperty, setProperty and deleteProperty
   */
  function fakeProps()
  {
    const store = Object.create(null);
    return {
      getProperty: function(k) { return k in store ? store[k] : null; },
      setProperty: function(k, v) { store[k] = v; },
      deleteProperty: function(k) { delete store[k]; }
    };
  }

  runTest('backup_ lists every thread id and declares the backup complete', function()
  {
    const gw = fakeGateway({userLabels: [fakeBackupLabel('A', 2), fakeBackupLabel('B', 0)]});
    const out = [];
    backup_(out, {gw: gw, props: fakeProps()});
    const text = out.join('\n');
    assert(text.indexOf('### A (2)') !== -1 && text.indexOf('A#0,A#1') !== -1, 'Should list A\'s ids');
    assert(text.indexOf('### B (0)') !== -1, 'An empty label is listed as empty');
    assert(text.indexOf('BACKUP COMPLETE') !== -1, 'Should declare success');
  }, results);

  runTest('backup_ reports a label it cannot read and refuses to declare success', function()
  {
    // The first page is full, so the failure is on the second page: exactly the
    // case where a swallowed error would leave a plausible-looking partial list.
    const pageSize = CONSTANTS.THREAD_BATCH_SIZE;
    const gw = fakeGateway({userLabels: [fakeBackupLabel('A', pageSize + 5, pageSize)]});
    const out = [];
    backup_(out, {gw: gw, props: fakeProps()});
    const text = out.join('\n');
    assert(text.indexOf('READ FAILED') !== -1, 'Should mark the label as not backed up');
    assert(text.indexOf('BACKUP INCOMPLETE') !== -1, 'Should report the run incomplete');
    assert(text.indexOf('BACKUP COMPLETE') === -1, 'Must not declare success');
  }, results);

  runTest('backup_ refuses to use real Script Properties when props is not injected', function()
  {
    const gw = fakeGateway({userLabels: [fakeBackupLabel('A', 1)]});
    let message = '';
    try
    {
      backup_([], {gw: gw});
    }
    catch (e)
    {
      message = String(e && e.message);
    }
    assert(message.indexOf('refusing to use real Script Properties') !== -1,
      'A test that forgets props must be refused by the guard, not crash later');
  }, results);

  runTest('getAllThreadsStrict retries a transient page error and succeeds', function()
  {
    let calls = 0;
    const flaky = {
      getName: function() { return 'Flaky'; },
      getThreads: function(start, max)
      {
        calls++;
        if (calls === 1)
        {
          throw new Error('Service error: Gmail');
        }
        return [{getId: function() { return 't1'; }}];
      }
    };
    const threads = getAllThreadsStrict(flaky, {baseDelayMs: 1});
    assertEquals(threads.length, 1, 'Should return the page read on retry');
    assertEquals(calls, 2, 'Should have retried exactly once');
  }, results);

  runTest('backup_ pages past a full first page', function()
  {
    const pageSize = CONSTANTS.THREAD_BATCH_SIZE;
    const gw = fakeGateway({userLabels: [fakeBackupLabel('A', pageSize + 3)]});
    const out = [];
    backup_(out, {gw: gw, props: fakeProps()});
    assert(out.join('\n').indexOf('### A (' + (pageSize + 3) + ')') !== -1, 'Should count every thread');
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
    assertEquals(gatewayWrites(gw), 0, 'A double-labelling spec must not be written');
    assert(out.join('\n').indexOf('ABORTING') !== -1, 'Should say it aborted');
  }, results);

  runTest('rebuildFilters_ aborts when a target label is missing', function()
  {
    const gw = fakeGateway({labels: [], filters: []});
    rebuildFilters_([], true, false, {gw: gw, spec: SPEC, superseded: []});
    assertEquals(gatewayWrites(gw), 0, 'Missing destination must abort before writing');
  }, results);

  runTest('rebuildFilters_ deletes a superseded filter', function()
  {
    const stale = {id: 'old1', criteria: {from: 'narrow@x.com'}, action: {addLabelIds: [READING]}};
    const gw = fakeGateway({labels: LABELS, filters: [stale]});
    rebuildFilters_([], true, false,
      {gw: gw, spec: SPEC, superseded: [{from: 'narrow@x.com'}]});
    assertContains(gw.calls.removedFilters, 'old1', 'Superseded filter should go');
  }, results);

}

// ============================================================================
// SWEEP AND BACKUP TESTS
// ============================================================================

/**
 * Build a fake GmailThread carrying the given label names.
 *
 * @param {string} id - Thread id
 * @param {Array<string>} labelNames - Names of the labels on the thread
 * @param {string} [from] - Sender of the first message
 * @return {Object} Fake thread; .archived records any archive call
 */
function fakeThread(id, labelNames, from)
{
  const thread = {
    archived: false,
    getId: function() { return id; },
    getLabels: function()
    {
      return labelNames.map(function(n)
      {
        return {getName: function() { return n; }};
      });
    },
    getMessages: function()
    {
      return [{getFrom: function() { return from || ''; }, getPlainBody: function() { return ''; }}];
    },
    getFirstMessageSubject: function() { return 'subject ' + id; },
    getLastMessageDate: function() { return new Date(0); },
    getMessageCount: function() { return 1; },
    isUnread: function() { return false; },
    moveToArchive: function() { thread.archived = true; }
  };
  return thread;
}

/**
 * Build a fake destination label that records which threads it was added to.
 *
 * @param {string} name - Label name
 * @return {Object} Fake label with an .added array
 */
function fakeDestLabel(name)
{
  const label = {
    added: [],
    getName: function() { return name; },
    addToThread: function(t) { label.added.push(t.getId()); }
  };
  return label;
}

/**
 * Build a fake label for backup reads, listing the given threads.
 *
 * @param {string} name - Label name
 * @param {Array<Object>} threads - Fake threads on the label
 * @param {boolean} [unreadable] - Throw on every read
 * @return {Object} Fake label
 */
function fakeListLabel(name, threads, unreadable)
{
  return {
    getName: function() { return name; },
    getThreads: function(start, max)
    {
      if (unreadable)
      {
        throw new Error('Label read failed (permanent)');
      }
      return threads.slice(start, start + max);
    }
  };
}

/**
 * Build a fake Script Properties store held in memory.
 *
 * @return {Object} Store with getProperty, setProperty, deleteProperty and .data
 */
function fakePropStore()
{
  const data = Object.create(null);
  return {
    data: data,
    getProperty: function(k) { return k in data ? data[k] : null; },
    setProperty: function(k, v) { data[k] = v; },
    deleteProperty: function(k) { delete data[k]; }
  };
}

/**
 * Test suite for the daily inbox sweep, Pass F and the library backup.
 *
 * Each test drives the real function through fakes, so no test touches the
 * mailbox, Script Properties or Drive.
 *
 * @param {Object} results - Results accumulator
 */
function testSweepsAndBackups(results)
{
  Logger.log('=== Sweep and Backup Tests ===');

  const TOOL = {SpamChecked: 1, SuspectedSpam: 1};
  const SUSPECT = {SuspectedSpam: 1};
  const RULES = [['news.example', 'Reading']];

  // --- report helpers ---

  runTest('_filingLabels_ drops the spam tool labels from the plan', function()
  {
    assertDeepEquals(_filingLabels_(['Finance', 'SpamChecked', 'constructor'], TOOL), ['Finance', 'constructor'],
      'Spam tool labels are not filing labels; a prototype-named label is');
  }, results);

  runTest('_unplannedLabels_ lists only labels outside the plan and the spam tool', function()
  {
    assertDeepEquals(_unplannedLabels_(['Finance', 'SpamChecked', 'Old Stuff', 'constructor'],
      ['Finance'], TOOL), ['Old Stuff', 'constructor'],
      'Plan and spam-tool labels are covered; a prototype-named label is not');
  }, results);

  // --- _classifyThread_ ---

  runTest('_classifyThread_ calls a thread with a non-tool label filed', function()
  {
    assertEquals(_classifyThread_(fakeThread('t', ['SpamChecked', 'Finance']), TOOL, SUSPECT), 'filed',
      'Finance is a filing label');
  }, results);

  runTest('_classifyThread_ calls suspected spam suspect', function()
  {
    assertEquals(_classifyThread_(fakeThread('t', ['SpamChecked', 'SuspectedSpam']), TOOL, SUSPECT),
      'suspect', 'Suspected spam is left alone');
  }, results);

  runTest('_classifyThread_ calls a thread with only tool labels unfiled', function()
  {
    assertEquals(_classifyThread_(fakeThread('t', ['SpamChecked']), TOOL, SUSPECT), 'unfiled',
      'The spam checker label is not filing');
    assertEquals(_classifyThread_(fakeThread('t', []), TOOL, SUSPECT), 'unfiled', 'No labels at all');
  }, results);

  runTest('_classifyThread_ is not fooled by a label named like a prototype member', function()
  {
    assertEquals(_classifyThread_(fakeThread('t', ['constructor']), TOOL, SUSPECT), 'filed',
      'A real label called constructor is a filing label, not spam');
  }, results);

  // --- passInbox_ ---

  runTest('passInbox_ labels an unfiled inbox thread by sender rule', function()
  {
    const reading = fakeDestLabel('Reading');
    const gw = fakeGateway({labelsByName: {Reading: reading},
      inbox: [fakeThread('t1', ['SpamChecked'], 'Ann <ann@news.example>')]});
    passInbox_([], true, {gw: gw, rules: RULES, toolLabels: TOOL, suspectLabels: SUSPECT});
    assertDeepEquals(reading.added, ['t1'], 'Should file the thread under Reading');
  }, results);

  runTest('passInbox_ leaves filed and suspected-spam threads alone', function()
  {
    const reading = fakeDestLabel('Reading');
    const misc = fakeDestLabel('Misc');
    const gw = fakeGateway({labelsByName: {Reading: reading, Misc: misc}, inbox: [
      fakeThread('filed', ['Finance'], 'ann@news.example'),
      fakeThread('spam', ['SuspectedSpam'], 'ann@news.example')]});
    passInbox_([], true, {gw: gw, rules: RULES, toolLabels: TOOL, suspectLabels: SUSPECT});
    assertEquals(reading.added.length + misc.added.length, 0, 'Nothing should be labelled');
  }, results);

  runTest('passInbox_ dry run labels nothing', function()
  {
    const reading = fakeDestLabel('Reading');
    const gw = fakeGateway({labelsByName: {Reading: reading},
      inbox: [fakeThread('t1', [], 'ann@news.example')]});
    const out = [];
    passInbox_(out, false, {gw: gw, rules: RULES, toolLabels: TOOL, suspectLabels: SUSPECT});
    assertEquals(reading.added.length, 0, 'Dry run must not label');
    assert(out.join('\n').indexOf('WOULD LABEL -> Reading') !== -1, 'Should report what it would do');
  }, results);

  runTest('passInbox_ falls back to Misc when the rule label is missing', function()
  {
    const misc = fakeDestLabel('Misc');
    const gw = fakeGateway({labelsByName: {Misc: misc},
      inbox: [fakeThread('t1', [], 'ann@news.example')]});
    passInbox_([], true, {gw: gw, rules: RULES, toolLabels: TOOL, suspectLabels: SUSPECT});
    assertDeepEquals(misc.added, ['t1'], 'An unfiled thread must still land in a bucket');
  }, results);

  runTest('passInbox_ never archives', function()
  {
    const thread = fakeThread('t1', [], 'ann@news.example');
    const gw = fakeGateway({labelsByName: {Reading: fakeDestLabel('Reading')}, inbox: [thread]});
    passInbox_([], true, {gw: gw, rules: RULES, toolLabels: TOOL, suspectLabels: SUSPECT});
    assert(!thread.archived, 'The sweep labels only');
  }, results);

  // --- passF_ ---

  runTest('passF_ files a SpamChecked-only thread and clears its offset at the end', function()
  {
    const reading = fakeDestLabel('Reading');
    const sc = fakeListLabel('SpamChecked', [fakeThread('t1', ['SpamChecked'], 'ann@news.example')]);
    const gw = fakeGateway({labelsByName: {SpamChecked: sc, Reading: reading}});
    const props = fakePropStore();
    props.setProperty('passF_offset', '0');
    passF_([], true, {gw: gw, props: props, rules: RULES, toolLabels: TOOL, suspectLabels: SUSPECT});
    assertDeepEquals(reading.added, ['t1'], 'Should file the thread');
    assertNull(props.getProperty('passF_offset'), 'Reaching the end clears the resume point');
  }, results);

  runTest('passF_ dry run labels nothing and saves no offset', function()
  {
    const reading = fakeDestLabel('Reading');
    const sc = fakeListLabel('SpamChecked', [fakeThread('t1', ['SpamChecked'], 'ann@news.example')]);
    const gw = fakeGateway({labelsByName: {SpamChecked: sc, Reading: reading}});
    const props = fakePropStore();
    passF_([], false, {gw: gw, props: props, rules: RULES, toolLabels: TOOL, suspectLabels: SUSPECT});
    assertEquals(reading.added.length, 0, 'Dry run must not label');
    assertEquals(Object.keys(props.data).length, 0, 'Dry run must not save state');
  }, results);

  runTest('passF_ falls back to Misc when the rule label is missing', function()
  {
    const misc = fakeDestLabel('Misc');
    const sc = fakeListLabel('SpamChecked', [fakeThread('t1', ['SpamChecked'], 'ann@news.example')]);
    const gw = fakeGateway({labelsByName: {SpamChecked: sc, Misc: misc}});
    passF_([], true, {gw: gw, props: fakePropStore(), rules: RULES, toolLabels: TOOL, suspectLabels: SUSPECT});
    assertDeepEquals(misc.added, ['t1'], 'An unfiled thread must still land in a bucket');
  }, results);

  runTest('passF_ refuses to use real Script Properties when props is not injected', function()
  {
    let message = '';
    try
    {
      passF_([], false, {gw: fakeGateway({})});
    }
    catch (e)
    {
      message = String(e && e.message);
    }
    assert(message.indexOf('refusing to use real Script Properties') !== -1, 'Must be refused by the guard');
  }, results);

  // --- library backup ---

  runTest('collectBackupRows writes a thread under two labels once', function()
  {
    const shared = fakeThread('shared', ['A', 'B']);
    const rows = [];
    const result = collectBackupRows(
      [fakeListLabel('A', [shared]), fakeListLabel('B', [shared, fakeThread('b1', ['B'])])],
      new Date().getTime(), function(r) { rows.push(r[0]); });
    assertDeepEquals(rows, ['shared', 'b1'], 'Each thread once, in label order');
    assertEquals(result.skipped, 1, 'The second sighting is a skip');
    assertEquals(describeBackupProblems(result).length, 0, 'A clean run reports no problems');
  }, results);

  runTest('collectBackupRows retries a failed thread from its next label', function()
  {
    const shared = fakeThread('shared', ['A', 'B']);
    let calls = 0;
    const result = collectBackupRows(
      [fakeListLabel('A', [shared]), fakeListLabel('B', [shared])],
      new Date().getTime(), function()
      {
        calls++;
        if (calls === 1)
        {
          throw new Error('write failed');
        }
      });
    assertEquals(result.written, 1, 'The second label writes it');
    assertEquals(result.failedThreads, 0, 'A thread written in the end is not a failure');
  }, results);

  runTest('collectBackupRows stops at the time limit and says so', function()
  {
    // A start time an hour ago is past any budget.
    const result = collectBackupRows([fakeListLabel('A', [fakeThread('a1', ['A'])])],
      new Date().getTime() - 3600000, function() {});
    assert(result.timedOut, 'Should stop before reading');
    assertEquals(result.written, 0, 'Nothing should be written after the limit');
    assert(describeBackupProblems(result).join('; ').indexOf('stopped at the time limit') !== -1,
      'Should report the stop');
  }, results);

  runTest('collectBackupRows reports an unreadable label and an unwritable thread', function()
  {
    const result = collectBackupRows(
      [fakeListLabel('Broken', [], true), fakeListLabel('A', [fakeThread('a1', ['A'])])],
      new Date().getTime(), function() { throw new Error('write failed'); });
    const problems = describeBackupProblems(result).join('; ');
    assert(problems.indexOf('Broken') !== -1, 'Should name the unreadable label');
    assert(problems.indexOf('1 thread(s) could not be written') !== -1, 'Should count the unwritten thread');
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

  runTest('isTransientError detects Gmail service and server errors', function()
  {
    assert(isTransientError(new Error('Service error: Gmail')), 'Service error should retry');
    assert(isTransientError(new Error('We\'re sorry, a server error occurred. Please wait a bit and try again.')),
      'Server error should retry');
    assert(!isTransientError(new Error('A server error occurred while reading from storage. Error code PERMISSION_DENIED.')),
      'A permission error is permanent');
  }, results);

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
  testSweepsAndBackups(results);
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
