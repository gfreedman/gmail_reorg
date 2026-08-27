/**
 * Mutation tests for the mutating routes in reorg_toolkit.gs.
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
  ['auth check removed from doGet',
   "if (!_authorized_(e, out))",
   "if (false)",
   ['doGet refuses an unauthorised request before routing']],
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
  // Anchored on the gw.deleteLabel(src) call that follows, because three
  // separate functions contain an identical `remaining.length === 0` check and a
  // looser anchor silently mutates the wrong one.
  ['non-empty source deleted anyway',
   "if (remaining.length === 0) { _safeCall(function() { gw.deleteLabel(src);",
   "if (true) { _safeCall(function() { gw.deleteLabel(src);",
   ['keeps a source that still has threads']],
  ['empty-shell guard removed',
   "if (label.getThreads(0, 1).length > 0) { out.push('NOT deleting ' + name + ' — still has threads'); continue; }",
   "if (false) { continue; }",
   ['deletes an empty shell but not a populated one']],
  ['backfill label existence check removed',
   "if (!jobs || !misc) { out.push('ABORT — ' + srcName + ' or ' + dstName + ' missing'); return; }",
   "if (false) { return; }",
   ['aborts when a label is missing']],
  ['superseded deletion skipped',
   "    if (!apply) { out.push('WOULD DELETE ' + label + '  (' + stale.id + ')'); continue; }",
   "    if (true) { continue; }",
   ['deletes a superseded filter']],
  ['dry-run guard removed in mergeDrift',
   "if (!apply) { out.push('WOULD MOVE ' + threads.length + '+ from ' + srcName + ' -> ' + dstName); break; }", "if (false) { break; }",
   ['mergeDrift_ dry-run writes nothing']],
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
function anchor(literal) {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped.replace(/\s+/g, '\\s+'));
}

function runSuite(sources) {
  const utils = fs.readFileSync(R + 'utils.gs', 'utf8');
  const tests = fs.readFileSync(R + 'tests.gs', 'utf8');
  // _private_data.gs is git-ignored, so a clean clone will not have it. The
  // production code deliberately does NOT tolerate its absence — a missing
  // configuration must raise rather than degrade into an empty run — so the
  // stubs live here, in the harness, instead of in the shipped code. Every
  // suite exercised below injects its own fixtures, so the values are never
  // read; they exist only to satisfy the eager argument evaluation in _dep_.
  const PRIVATE_STUBS = [
    'const _FILTER_SPEC = [];',
    'const _FILTER_SUPERSEDED = [];',
    'const _DRIFT_MERGES = [];',
    'const _DRIFT_SHELLS = [];',
    'const _LINKEDIN_NOISE_SRC = null;',
    'const _LINKEDIN_NOISE_DST = null;',
    'const _LINKEDIN_NOISE_Q = null;'
  ].join('\n');

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
    var _unusedProps = {},
        SpreadsheetApp = {}, DriveApp = {};
  `;
  const body = prelude + priv + '\n' + utils + '\n' + sources.toolkit + '\n' + sources.admin + '\n' + tests + `
    var results = {passed: 0, failed: 0, errors: []};
    testFilterSpec(results);
    testMutatingPaths(results);
    return results;
  `;
  try { return new Function(body)(); }
  catch (e) { return {passed: 0, failed: -1, errors: [{test: 'LOAD', error: e.message}]}; }
}

// Mutations may target any source file, not just the toolkit: the maintenance
// trigger lives in admin.gs, and anchoring only in reorg_toolkit.gs silently
// reported those mutants as "anchor not found".
const MUTABLE = ['reorg_toolkit.gs', 'admin.gs'];
const clean = {};
MUTABLE.forEach(function (f) { clean[f] = fs.readFileSync(R + f, 'utf8'); });

function sourcesFrom(overrides) {
  return {
    toolkit: (overrides && overrides['reorg_toolkit.gs']) || clean['reorg_toolkit.gs'],
    admin: (overrides && overrides['admin.gs']) || clean['admin.gs']
  };
}

const base = runSuite(sourcesFrom(null));
console.log('baseline: ' + base.passed + ' passed, ' + base.failed + ' failed');
if (base.failed !== 0) { console.log(JSON.stringify(base.errors, null, 2)); process.exit(1); }

let survivors = 0;
MUTATIONS.forEach(function (m) {
  const [name, find, repl, expect] = m;
  const pattern = anchor(find);
  const target = MUTABLE.find(function (f) { return pattern.test(clean[f]); });
  if (!target) { console.log('SKIP  ' + name + ' — anchor not found'); survivors++; return; }
  const overrides = {};
  overrides[target] = clean[target].replace(pattern, repl);
  const r = runSuite(sourcesFrom(overrides));
  const failedNames = r.errors.map(e => e.test).join(' | ');
  const caught = expect.every(frag => failedNames.includes(frag));
  console.log((caught ? 'KILLED  ' : 'SURVIVED ') + name + '  (' + r.failed + ' test(s) failed)');
  if (!caught) { survivors++; console.log('         failing: ' + (failedNames || 'none')); }
});
console.log('\n' + (MUTATIONS.length - survivors) + '/' + MUTATIONS.length + ' mutants killed');
process.exit(survivors ? 1 : 0);
