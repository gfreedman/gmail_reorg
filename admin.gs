/**
 * Functions you run by hand, kept out of the toolkit files so they are easy to
 * find in the Apps Script editor's Run menu.
 *
 * Apps Script evaluates every .gs file into one global scope, so these reach the
 * toolkit's functions and constants directly.
 */

// ============================================================================
// ONE-TIME SETUP
// ============================================================================

/**
 * Script Property holding the shared secret required by every Web App request.
 *
 * Kept in Script Properties rather than in source so it is never committed and
 * can be rotated without a redeploy.
 */
const _TOKEN_PROPERTY = 'WEBAPP_TOKEN';

/**
 * Generate and store a new Web App token, and write it to the execution log.
 *
 * Run from the Apps Script editor. Rotating is simply running it again: the old
 * token stops working immediately, which is the response to a leaked URL.
 *
 * Built from Utilities.getUuid(), which is backed by SecureRandom. The obvious
 * alternative — picking characters with Math.random() — is NOT suitable here:
 * V8's Math.random is a fast non-cryptographic PRNG whose internal state can be
 * recovered from a modest number of outputs, and this token is the only thing
 * standing between the deployment URL and full mailbox access. Two UUIDs give
 * 244 bits of entropy.
 *
 * The execution log keeps a copy of the token. Treat that log like the token
 * itself; rotating replaces the token, so an old copy in the log stops working.
 *
 * @return {string} The new token.
 */
function setWebAppToken()
{
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty(_TOKEN_PROPERTY, token);
  // The editor's Run button discards return values; the execution log is the only place it shows.
  Logger.log('New Web App token: ' + token);
  return token;
}

/**
 * Grant gmail.settings.basic by touching the filters API once from the editor.
 *
 * Run manually from the Apps Script editor and approve the consent screen; the
 * deployed Web App cannot request the scope for itself.
 *
 * @return {string} Confirmation message.
 */
function authorize()
{
  Gmail.Users.Settings.Filters.list('me');
  return 'authorized — gmail.settings.basic granted';
}

// ---------------------------------------------------------------------------
// Gmail gateway — every top-level Gmail call the toolkit's tested routes make
// (rebuildFilters_, backup_, passF_, passInbox_).
// Per-label reads go through the label objects it returns, not the gateway.
//
// Each takes an optional `deps` argument; tests pass a fake gateway
// plus fixture config so the real code paths run without touching the mailbox.
// Production callers omit it and get _GW below.
//
// Thread and label objects the gateway returns carry their own Gmail methods
// (getLabels, addToThread); tests substitute those with fakes too.
// ---------------------------------------------------------------------------
const _GW =
{
  listLabels: function()
  {
    return Gmail.Users.Labels.list('me').labels || [];
  },
  getUserLabels: function()
  {
    return GmailApp.getUserLabels();
  },
  getUserLabelByName: function(name)
  {
    return GmailApp.getUserLabelByName(name);
  },
  search: function(query, start, max)
  {
    return GmailApp.search(query, start, max);
  },
  listFilters: function()
  {
    return Gmail.Users.Settings.Filters.list('me').filter || [];
  },
  createFilter: function(resource)
  {
    return Gmail.Users.Settings.Filters.create(resource, 'me');
  },
  removeFilter: function(id)
  {
    return Gmail.Users.Settings.Filters.remove('me', id);
  }
};

// ============================================================================
// SCHEDULED MAINTENANCE
// ============================================================================

/**
 * Handler name for the maintenance trigger. Used to find and replace the
 * existing trigger, so installing twice cannot stack duplicates.
 */
const _MAINTENANCE_HANDLER = 'runMaintenance';

/**
 * Label inbox threads that have no user label apart from the spam checker's
 * "checked" label. Suspected spam is left alone.
 *
 * This is what the time-driven trigger calls. It runs inside the project rather
 * than over HTTP, so it needs no Web App token and no machine to be awake — the
 * failure mode that made Apple Mail unfit for filing in the first place.
 *
 * Labels only; it never archives and never trashes, so an unattended run cannot
 * hide mail from you. Idempotent, so a missed or repeated run is harmless.
 *
 * @return {string} Summary of what was labelled, also written to the log.
 */
function runMaintenance()
{
  const out = [];
  passInbox_(out, true);
  const summary = out.join('\n');
  Logger.log(summary);
  return summary;
}

/**
 * Install (or reinstall) the daily maintenance trigger.
 *
 * Run once from the Apps Script editor. Deletes any existing trigger for the
 * same handler first, so running it repeatedly leaves exactly one.
 *
 * @param {Object} [deps] - Test injection point; production omits it.
 * @param {Object} [deps.scriptApp] - Stand-in for ScriptApp.
 * @return {string} Description of the installed trigger.
 */
function installMaintenanceTrigger(deps)
{
  const app = (deps && deps.scriptApp) || ScriptApp;
  const removed = _removeMaintenanceTriggers_(app);
  app.newTrigger(_MAINTENANCE_HANDLER).timeBased().everyDays(1).atHour(3).create();
  return 'Installed daily ' + _MAINTENANCE_HANDLER + ' trigger at ~03:00' +
    (removed > 0 ? ' (replaced ' + removed + ' existing)' : '');
}

/**
 * Remove the maintenance trigger.
 *
 * @param {Object} [deps] - Test injection point; production omits it.
 * @param {Object} [deps.scriptApp] - Stand-in for ScriptApp.
 * @return {string} How many triggers were removed.
 */
function removeMaintenanceTrigger(deps)
{
  const app = (deps && deps.scriptApp) || ScriptApp;
  return 'Removed ' + _removeMaintenanceTriggers_(app) + ' trigger(s)';
}

/**
 * Delete every existing trigger for the maintenance handler.
 *
 * @param {Object} app - ScriptApp, or a stand-in.
 * @return {number} How many were deleted.
 */
function _removeMaintenanceTriggers_(app)
{
  const existing = app.getProjectTriggers() || [];
  let removed = 0;
  for (let i = 0; i < existing.length; i++)
  {
    if (existing[i].getHandlerFunction() === _MAINTENANCE_HANDLER)
    {
      app.deleteTrigger(existing[i]);
      removed++;
    }
  }
  return removed;
}
