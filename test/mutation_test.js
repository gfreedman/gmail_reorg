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
  ['non-empty source deleted anyway',
   "if (remaining.length === 0) {\n        _safeCall(function () { gw.deleteLabel(src); return null; }",
   "if (true) {\n        _safeCall(function () { gw.deleteLabel(src); return null; }",
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

function runSuite(toolkitSrc) {
  const utils = fs.readFileSync(R + 'utils.gs', 'utf8');
  const tests = fs.readFileSync(R + 'tests.gs', 'utf8');
  const privPath = R + '_private_data.gs';
  const priv = fs.existsSync(privPath) ? fs.readFileSync(privPath, 'utf8') : '';
  const prelude = `
    var Logger = { log: function () {} };
    var Gmail = {}, GmailApp = {}, PropertiesService = {},
        SpreadsheetApp = {}, DriveApp = {}, Utilities = { sleep: function () {} };
  `;
  const body = prelude + priv + '\n' + utils + '\n' + toolkitSrc + '\n' + tests + `
    var results = {passed: 0, failed: 0, errors: []};
    testFilterSpec(results);
    testMutatingPaths(results);
    return results;
  `;
  try { return new Function(body)(); }
  catch (e) { return {passed: 0, failed: -1, errors: [{test: 'LOAD', error: e.message}]}; }
}

const clean = fs.readFileSync(R + 'reorg_toolkit.gs', 'utf8');
const base = runSuite(clean);
console.log('baseline: ' + base.passed + ' passed, ' + base.failed + ' failed');
if (base.failed !== 0) { console.log(JSON.stringify(base.errors, null, 2)); process.exit(1); }

let survivors = 0;
MUTATIONS.forEach(function (m) {
  const [name, find, repl, expect] = m;
  if (!clean.includes(find)) { console.log('SKIP  ' + name + ' — anchor not found'); survivors++; return; }
  const r = runSuite(clean.replace(find, repl));
  const failedNames = r.errors.map(e => e.test).join(' | ');
  const caught = expect.every(frag => failedNames.includes(frag));
  console.log((caught ? 'KILLED  ' : 'SURVIVED ') + name + '  (' + r.failed + ' test(s) failed)');
  if (!caught) { survivors++; console.log('         failing: ' + (failedNames || 'none')); }
});
console.log('\n' + (MUTATIONS.length - survivors) + '/' + MUTATIONS.length + ' mutants killed');
process.exit(survivors ? 1 : 0);
