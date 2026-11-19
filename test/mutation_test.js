/**
 * Mutation tests for the safety guards in the toolkit, backup and migration code.
 *
 * A passing test suite only means something if it fails when the code breaks.
 * This deliberately breaks one guard at a time and asserts that the expected
 * test catches it. A SURVIVED mutant means that guard is not really covered.
 *
 * Run with:  node test/mutation_test.js
 *
 * The .gs files are loaded into a sandboxed Function scope with the Apps Script
 * globals stubbed out, so nothing here touches Gmail. _private_data.gs is
 * optional — every suite under test injects its own fixtures.
 */
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..') + path.sep;

// Mutations: [name, find, replace, testNamesExpectedToFail]
const MUTATIONS = [
  ['conflict map keys lose their prefix',
   "conflicts['dup|' + A.addr] =",
   "conflicts[A.addr] =",
   ['not confused by prototype-shaped criteria']],
  ['trigger install stacks duplicates',
   "const removed = _removeMaintenanceTriggers_(app);",
   "const removed = 0;",
   ['replaces rather than stacking duplicates']],
  ['trigger removal ignores the handler filter',
   "if (existing[i].getHandlerFunction() === _MAINTENANCE_HANDLER)",
   "if (true)",
   ['leaves unrelated triggers alone']],
  ['auth check removed from the router',
   "if (!_authorized_(e, out))",
   "if (false)",
   ['doPost refuses an unauthorised request before routing']],
  ['GET routes again',
   "return _textResponse_('DENIED — send requests as POST, with fn and token in the body');",
   "return _route_(e);",
   ['doGet never routes']],
  ['query-string token accepted',
   "if (e && typeof e.queryString === 'string' && /(^|&)token=/.test(e.queryString))",
   "if (false)",
   ['doPost refuses a token sent in the query string']],
  ['auth fails OPEN when unconfigured',
   "if (!expected) { out.push('DENIED — no token configured. Run setWebAppToken() from the Apps Script editor.'); return false; }",
   "if (!expected) { return true; }",
   ['fails closed when no token is configured']],
  ['token comparison always true',
   "if (!_constantTimeEquals_(given, expected))",
   "if (false)",
   ['rejects a missing or wrong token']],
  ['gateway fallback guard removed',
   "if (!deps.gw) { throw new Error('deps supplied without a gw gateway — refusing to fall back to live Gmail'); }",
   "if (false) { }",
   ['refuses to reach live Gmail']],
  ['dep resolution reverts to || semantics',
   "return (deps && deps[key] !== undefined) ? deps[key] : fallback;",
   "return (deps && deps[key]) || fallback;",
   ['keeps a falsy but valid injected value']],
  ['manual-edit guard removed',
   "if (state === 'manual' && !force) {", "if (false) {",
   ['does not overwrite a hand-edited filter']],
  ['conflict abort removed',
   "if (apply) { out.push('ABORTING — refusing to write a spec that double-labels.'); return; }", "if (false) { return; }",
   ['aborts on a conflicting spec']],
  ['failed create counted as success',
   "if (!res || !res.id) {", "if (false) {",
   ['reports a failed create']],
  ['unmanaged removes dropped',
   "const removes = (sp.skipInbox ? ['INBOX'] : []).concat(carried);", "const removes = (sp.skipInbox ? ['INBOX'] : []);",
   ['preserves unmanaged removeLabelIds']],
  ['superseded deletion skipped',
   "    if (!apply) { out.push('WOULD DELETE ' + label + '  (' + stale.id + ')'); continue; }",
   "    if (true) { continue; }",
   ['deletes a superseded filter']],
  // The original bug: reading through getAllThreadsFromLabel, which logs a
  // failed page and returns a partial list instead of throwing.
  ['backup read swallows errors again',
   "ids = getAllThreadsStrict(label)",
   "ids = getAllThreadsFromLabel(label)",
   ['backup_ reports a label it cannot read']],
  ['incomplete backup reported as complete',
   "if (failed > 0)",
   "if (false)",
   ['refuses to declare success']],
  ['forwarding filter treated as repairable',
   "if (adds.length === 0 && !dropsArchive && !_hasUnmanagedSettings_(prior))",
   "if (adds.length === 0 && !dropsArchive)",
   ['protects a filter that only forwards', 'does not overwrite a filter that forwards mail']],
  ['archive-only filter treated as repairable',
   "if (adds.length === 0 && !dropsArchive && !_hasUnmanagedSettings_(prior))",
   "if (adds.length === 0 && !_hasUnmanagedSettings_(prior))",
   ['protects an archive-only filter']],
  ['superseded hand-made filter deleted',
   "if (_hasUnmanagedSettings_(stale) && !force)",
   "if (false)",
   ['does not delete a superseded filter that forwards mail']],
  ['backup props guard removed',
   "if (!deps.props) { throw new Error('deps supplied without props — refusing to use real Script Properties'); }",
   "if (false) { }",
   ['backup_ refuses to use real Script Properties']],
  ['sweep classifier ignores suspected spam',
   "if (_hasOwn_(suspectLabels, n))",
   "if (false)",
   ['calls suspected spam suspect']],
  ['sweep classifier uses plain lookups again',
   "return Object.prototype.hasOwnProperty.call(map, key);",
   "return !!map[key];",
   ['not fooled by a label named like a prototype member', 'treats a label named like a prototype member as filing']],
  ['inbox sweep dry run writes',
   "if (apply) { let d = getDst(dest);",
   "if (true) { let d = getDst(dest);",
   ['passInbox_ dry run labels nothing']],
  ['inbox sweep Misc fallback removed',
   "d = getDst('Misc');",
   "d = null;",
   ['passInbox_ falls back to Misc when the rule label is missing']],
  ['pass F dry run labels',
   "if (apply) { let dst = getDst(destName);",
   "if (true) { let dst = getDst(destName);",
   ['passF_ dry run labels nothing']],
  ['pass F ignores which threads are already filed',
   "if (filedIds[id])",
   "if (false)",
   ['files only the SpamChecked threads that no filing label holds']],
  ['pass F labels suspected spam',
   "if (suspectIds[id])",
   "if (false)",
   ['files only the SpamChecked threads that no filing label holds']],
  ['pass F guesses past an unreadable label',
   "out.push('ABORT — could not read label \"' + name + '\": ' + ((e && e.message) || String(e))); out.push('Nothing was labelled. Re-run later.'); return;",
   "out.push('ABORT — could not read label \"' + name + '\": ' + ((e && e.message) || String(e))); out.push('Nothing was labelled. Re-run later.'); continue;",
   ['aborts without labelling when a filing label cannot be read']],
  ['pass F label-phase budget ignored',
   "if (now() - startTime > MAX_RUNTIME) { out.push('ABORT — reading labels used the whole time budget.');",
   "if (false) { out.push('ABORT — reading labels used the whole time budget.');",
   ['reading labels uses the whole budget']],
  ['pass F time budget ignored',
   "if (now() - startTime > MAX_RUNTIME) { remaining++; continue; }",
   "if (false) { remaining++; continue; }",
   ['stops at the time budget']],
  ['pass F Misc fallback removed',
   "dst = getDst('Misc');",
   "dst = null;",
   ['passF_ falls back to Misc when its rule label is missing']],
  ['backup writes a thread twice',
   "if (processedThreadIds[threadId])",
   "if (false)",
   ['writes a thread under two labels once']],
  ['backup ignores the time limit',
   "result.timedOut = true; break;",
   "",
   ['stops at the time limit']],
  ['counts include spam tool labels',
   "return !_hasOwn_(toolLabels, name); }); }",
   "return true; }); }",
   ['_filingLabels_ drops the spam tool labels']],
  ['diagnose treats plan labels as unplanned',
   "return !covered[name] && !_hasOwn_(toolLabels, name);",
   "return !_hasOwn_(toolLabels, name);",
   ['_unplannedLabels_ lists only labels outside the plan']],
  ['migration reads leniently again',
   "threads = getAllThreadsStrict(fromLabel, buildRetryOpts(batchStats));",
   "threads = getAllThreadsFromLabel(fromLabel);",
   ['migrateSingleLabel moves nothing and fails when a page cannot be read']],
  ['backup counts a recovered thread as failed',
   "delete failedThreadIds[threadId];",
   "",
   ['retries a failed thread from its next label']],
];

/**
 * Compile a literal source snippet into a whitespace-tolerant RegExp.
 *
 * Anchors used to be exact strings, which coupled them to the source
 * formatting: reformatting the file to Allman braces turned every mutation into
 * "anchor not found" and would have silently disarmed the suite. Matching runs
 * of whitespace as \s+ makes an anchor describe the code rather than its layout.
 *
 * @param {string} literal - Source snippet to match
 * @return {RegExp} Whitespace-tolerant pattern
 */
function anchor(literal)
{
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped.replace(/\s+/g, '\\s+'));
}

/**
 * Load the toolkit, its tests and stubbed Apps Script globals into one scope
 * and run the toolkit test suites.
 *
 * Apps Script evaluates every .gs file into a single global scope; concatenating
 * the sources into one Function body reproduces that.
 *
 * @param {Object<string, string>} sources - Source text of each mutable file
 *     (see MUTABLE), possibly mutated
 * @return {{passed: number, failed: number, errors: Array<Object>}} Suite
 *     results; failed is -1 if the sources did not load
 */
function runSuite(sources)
{
  const utils = fs.readFileSync(R + 'utils.gs', 'utf8');
  const tests = fs.readFileSync(R + 'tests.gs', 'utf8');
  // _private_data.gs is git-ignored, so a clean clone will not have it; see
  // test/private_stubs.js for why the stubs live in the test tooling.
  const PRIVATE_STUBS = require('./private_stubs.js');

  const privPath = R + '_private_data.gs';
  const priv = fs.existsSync(privPath) ? fs.readFileSync(privPath, 'utf8') : PRIVATE_STUBS;
  const prelude = `
    var Logger = { log: function () {} };
    var Gmail = {}, GmailApp = {};
    var _uuidSeq = 0;
    var Utilities = {
      sleep: function () {},
      getUuid: function () { _uuidSeq++; return 'abcdef01-2345-4678-9abc-def01234567' + (_uuidSeq % 10); }
    };
    var ContentService = {
      MimeType: { TEXT: 'TEXT' },
      createTextOutput: function (t) {
        return { _t: t, getContent: function () { return this._t; }, setMimeType: function () { return this; } };
      }
    };
    var _props = {};
    var PropertiesService = {
      getScriptProperties: function () {
        return {
          getProperty: function (k) { return Object.prototype.hasOwnProperty.call(_props, k) ? _props[k] : null; },
          setProperty: function (k, v) { _props[k] = v; },
          deleteProperty: function (k) { delete _props[k]; }
        };
      }
    };
  `;
  const body = prelude + priv + '\n' + utils + '\n' + MUTABLE.map(function(f)
  {
    return sources[f];
  }).join('\n') + '\n' + tests + `
    var results = {passed: 0, failed: 0, errors: []};
    testFilterSpec(results);
    testMutatingPaths(results);
    testSweepsAndBackups(results);
    return results;
  `;
  try
  {
    return new Function(body)();
  }
  catch (e)
  {
    return {passed: 0, failed: -1, errors: [{test: 'LOAD', error: e.message}]};
  }
}

// Mutations may target any source file, not just the toolkit: the maintenance
// trigger lives in admin.gs, and anchoring only in reorg_toolkit.gs silently
// reported those mutants as "anchor not found".
// Load order matters here though not in Apps Script: the harness concatenates
// every file into one function body, so CONFIG (reorganization.gs) must be
// declared before reorg_toolkit.gs reads it at load time.
const MUTABLE = ['reorganization.gs', 'reorg_toolkit.gs', 'admin.gs', 'backup.gs'];
const clean = {};
MUTABLE.forEach(function(f)
{
  clean[f] = fs.readFileSync(R + f, 'utf8');
});

/**
 * Build the source set for one suite run, substituting any mutated files.
 *
 * @param {Object<string, string>|null} overrides - Mutated source text keyed
 *     by file name, or null for the unmodified sources
 * @return {Object<string, string>} Source text by file name, to pass to runSuite
 */
function sourcesFrom(overrides)
{
  const sources = {};
  MUTABLE.forEach(function(f)
  {
    sources[f] = (overrides && overrides[f]) || clean[f];
  });
  return sources;
}

const base = runSuite(sourcesFrom(null));
console.log('baseline: ' + base.passed + ' passed, ' + base.failed + ' failed');
if (base.failed !== 0)
{
  console.log(JSON.stringify(base.errors, null, 2));
  process.exit(1);
}

let survivors = 0;
MUTATIONS.forEach(function(m)
{
  const [name, find, repl, expect] = m;
  const pattern = anchor(find);
  const target = MUTABLE.find(function(f)
  {
    return pattern.test(clean[f]);
  });
  if (!target)
  {
    console.log('SKIP  ' + name + ' — anchor not found');
    survivors++;
    return;
  }
  const overrides = {};
  overrides[target] = clean[target].replace(pattern, repl);
  const r = runSuite(sourcesFrom(overrides));
  const failedNames = r.errors.map(e => e.test).join(' | ');
  const caught = expect.every(frag => failedNames.includes(frag));
  console.log((caught ? 'KILLED  ' : 'SURVIVED ') + name + '  (' + r.failed + ' test(s) failed)');
  if (!caught)
  {
    survivors++;
    console.log('         failing: ' + (failedNames || 'none'));
  }
});
console.log('\n' + (MUTATIONS.length - survivors) + '/' + MUTATIONS.length + ' mutants killed');
process.exit(survivors ? 1 : 0);
