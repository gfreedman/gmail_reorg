// ---------------------------------------------------------------------------
// Gmail reorg toolkit — shared settings and helpers.
//
// The toolkit is split by job: toolkit_webapp.gs (entry points and access
// control), toolkit_filters.gs, toolkit_filing.gs and toolkit_reports.gs. Apps
// Script loads every .gs file into one global scope, so they need no imports.
//
// All configuration (sender rules, addresses, label names) lives in
// _private_data.gs, which is git-ignored because it contains personal data.
// These files are safe to commit and review.
//
// Entry point is doPost(e) in toolkit_webapp.gs: every mutating route is a dry
// run unless given apply=1. Mutating routes are idempotent and time-budgeted,
// so a timed-out run is safe to repeat. backup saves its place and resumes;
// passF and inbox simply start again, skipping whatever is already filed.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Operational limits.
//
// These were previously inline literals repeated across the file, at values that
// disagreed with each other for no stated reason. Naming them makes the intent
// checkable and the disagreements visible.
// ---------------------------------------------------------------------------

// Gmail returns at most 500 threads per search call. This is an API hard limit,
// not a tunable: a short page is how the paging loops detect the end of results.
const _PAGE_SIZE = 500;

// Apps Script kills an execution at 6 minutes. Every long-running route stops at
// CONFIG.MAX_RUNTIME_MS, leaving the rest of the buffer to flush output; a re-run
// then resumes from a saved position or rescans, skipping what is already done.
const _RUNTIME_MS = (typeof CONFIG !== 'undefined' && CONFIG.MAX_RUNTIME_MS) || 300000;

// Routes that accumulate a large response body (backup_, miscBreakdown_) stop
// 20s earlier, because serialising that body happens after the loop exits and
// still has to fit inside the same 6 minutes.
const _RUNTIME_MS_LARGE_OUTPUT = _RUNTIME_MS - 20000;

// Ceilings on how far a read-only diagnostic will page before reporting what it
// has. A mailbox larger than this gets a sampled answer rather than a hung run.
const _SCAN_MAX_THREADS = 50000;
const _SWEEP_MAX_THREADS = 10000;

// GmailLabel.getThreads() pages independently of search(); keep the two
// limits distinct so a change to one cannot silently retune the other.
const _LABEL_PAGE_SIZE = 100;

// How many rows a 'top N' diagnostic prints.
const _TOP_N = 40;

/**
 * Run a Gmail operation with retry, treating "not found" as already handled.
 *
 * Gmail reports an already-deleted label or thread as an error. Because every
 * route here is idempotent and re-runnable, that case means the work is done
 * rather than that something failed, so it is logged and skipped.
 *
 * @param {Function} fn - Operation to run; may be called more than once.
 * @param {string} desc - Human-readable description used in log lines.
 * @param {Array<string>} out - Accumulator for output lines; returned to the caller as text.
 * @return {*} Whatever fn returns, or null if the target was already gone.
 */
function _safeCall(fn, desc, out)
{
  try
  {
    // No overrides: withRetry already falls back to CONFIG.MAX_RETRIES and
    // CONFIG.RETRY_BASE_DELAY_MS. Passing literals here made those knobs inert
    // for every route in this file.
    return withRetry(fn, desc);
  }
  catch (e)
  {
    const msg = (e && e.message) || String(e);
    if (msg.toLowerCase().indexOf('not found') !== -1)
    {
      out.push('  warn: ' + desc + ' — Not found (likely already handled), skipping');
      return null;
    }
    throw e;
  }
}

/**
 * Test whether a set (a plain object of names) holds a key as its own property.
 *
 * Plain lookups would find Object.prototype members, so a label named
 * constructor or toString would look like a member of every set.
 *
 * @param {Object} map - Set of names.
 * @param {string} key - Name to look up.
 * @return {boolean} True if key is an own property of map.
 */
function _hasOwn_(map, key)
{
  return Object.prototype.hasOwnProperty.call(map, key);
}

// Deliberately NOT `deps.x || fallback`: an empty string or 0 is a valid config
// value, and `||` would silently swap it for production data. Tests would then
// pass while exercising the real spec instead of their fixture.
//
// Callers pass the production constant directly as `fallback`. Because JS
// evaluates arguments eagerly that constant is read even when deps overrides it,
// so a missing _private_data.gs raises a ReferenceError immediately. That is the
// intended behaviour — an absent configuration must abort the run, not quietly
// reduce it to a no-op that reports success. Tests declare their own stubs (see
// test/mutation_test.js) rather than making this file tolerate the gap.
/**
 * Resolve one injected dependency, falling back to production configuration.
 *
 * @param {Object} [deps] - Injected dependencies, or null in production.
 * @param {string} key - Dependency name.
 * @param {*} fallback - Production value.
 * @return {*} The injected value if present, otherwise the fallback.
 */
function _dep_(deps, key, fallback)
{
  return (deps && deps[key] !== undefined) ? deps[key] : fallback;
}

// Resolve the Gmail gateway.
//
// If a caller supplies `deps` at all it is a test, so a missing or misspelled
// `gw` key must fail loudly rather than fall through to _GW and mutate the real
// mailbox. Silence here would be the most expensive bug in this file.
/**
 * Resolve the Gmail gateway, refusing to default it once deps is supplied.
 *
 * @param {Object} [deps] - Injected dependencies, or null in production.
 * @return {Object} Gateway to use.
 * @throws {Error} If deps is supplied without a gw key.
 */
function _depGw_(deps)
{
  if (!deps)
  {
    return _GW;
  }
  if (!deps.gw)
  {
    throw new Error('deps supplied without a gw gateway — refusing to fall back to live Gmail');
  }
  return deps.gw;
}

/**
 * Resolve the Script Properties store, refusing to default it once deps is supplied.
 *
 * Same reasoning as _depGw_: a test that forgets props must fail loudly rather
 * than read or overwrite a real resume checkpoint.
 *
 * @param {Object} [deps] - Injected dependencies, or null in production.
 * @return {Object} Properties store to use.
 * @throws {Error} If deps is supplied without a props key.
 */
function _depProps_(deps)
{
  if (!deps)
  {
    return PropertiesService.getScriptProperties();
  }
  if (!deps.props)
  {
    throw new Error('deps supplied without props — refusing to use real Script Properties');
  }
  return deps.props;
}
