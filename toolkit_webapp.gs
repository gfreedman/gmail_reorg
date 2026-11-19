// ---------------------------------------------------------------------------
// Gmail reorg toolkit — Web App entry points and access control.
//
// doPost is the only way in: it checks the token (sent in the POST body, never
// the URL) and routes to one maintenance function. doGet always refuses.
// Shared settings and helpers live in reorg_toolkit.gs.
// ---------------------------------------------------------------------------

/**
 * Compare two strings without short-circuiting on the first differing byte.
 *
 * The timing signal over HTTPS is small, but a token check is exactly the place
 * where leaking one is avoidable for three lines of code.
 *
 * @param {string} a - First string.
 * @param {string} b - Second string.
 * @return {boolean} True if equal.
 */
function _constantTimeEquals_(a, b)
{
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length)
  {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++)
  {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Authorise a Web App request.
 *
 * The deployment is ANYONE_ANONYMOUS and executes as the deploying user, so a
 * request carries full Gmail authority: without this check anyone holding the
 * URL could rewrite every Gmail filter via rebuildfilters with apply=1 or dump
 * every thread id via backup. An unguessable URL is not an access control: URLs
 * leak through shell history, proxy logs and clipboards. For the same reason the
 * token travels in the POST body, never the URL (see doPost).
 *
 * Fails closed: if no token has been configured, every route is refused rather
 * than left open.
 *
 * @param {Object} e - Apps Script event object.
 * @param {Array<string>} out - Accumulator for the response.
 * @return {boolean} True if the request may proceed.
 */
function _authorized_(e, out)
{
  const expected = PropertiesService.getScriptProperties().getProperty(_TOKEN_PROPERTY);
  if (!expected)
  {
    out.push('DENIED — no token configured. Run setWebAppToken() from the Apps Script editor.');
    return false;
  }
  const given = (e && e.parameter && e.parameter.token) || '';
  if (!_constantTimeEquals_(given, expected))
  {
    // Deliberately says nothing about which route was requested or why the
    // token failed.
    out.push('DENIED');
    return false;
  }
  return true;
}

/**
 * Wrap text as a plain-text Web App response.
 *
 * @param {string} text - Response body.
 * @return {TextOutput} Plain-text response.
 */
function _textResponse_(text)
{
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Web App GET entry point: always refused.
 *
 * A token in a URL leaks into browser history, proxy logs and copied links, so
 * the toolkit takes requests only as POST with the token in the body. GET never
 * reads a token and never routes.
 *
 * @param {Object} e - Apps Script event object (unused).
 * @return {TextOutput} A refusal.
 */
function doGet(e)
{
  return _textResponse_('DENIED — send requests as POST, with fn and token in the body');
}

/**
 * Web App POST entry point.
 *
 * Refuses a token sent in the query string even on POST, so the URL never
 * carries the secret. Otherwise routes like the old GET entry point did.
 *
 * @param {Object} e - Apps Script event object; e.parameter merges query and body.
 * @return {TextOutput} Plain-text result of the requested route.
 */
function doPost(e)
{
  if (e && typeof e.queryString === 'string' && /(^|&)token=/.test(e.queryString))
  {
    return _textResponse_('DENIED');
  }
  return _route_(e);
}

/**
 * Route an authorised request to one maintenance function.
 *
 * Every mutating route is a dry run unless apply=1. Errors are caught and returned as
 * text so a failure is visible in the response rather than only in the log.
 *
 * @param {Object} e - Apps Script event object carrying the request parameters.
 * @return {TextOutput} Plain-text result of the requested route.
 */
function _route_(e)
{
  const out = [];
  if (!_authorized_(e, out))
  {
    return _textResponse_(out.join('\n'));
  }
  const fn = (e && e.parameter && e.parameter.fn) || '';
  const apply = !!(e && e.parameter && e.parameter.apply === '1');
  try
  {
    if (fn === 'counts')
    {
      finalCounts_(out);
    }
    else if (fn === 'diagnose')
    {
      diagnoseOrphans_(out);
    }
    else if (fn === 'inspect')
    {
      const cat = (e && e.parameter && e.parameter.cat) || 'updates';
      inspectCategory_(out, cat);
    }
    else if (fn === 'inbox')
    {
      passInbox_(out, apply);
    }
    else if (fn === 'miscbreak')
    {
      miscBreakdown_(out);
    }
    else if (fn === 'backup')
    {
      backup_(out);
    }
    else if (fn === 'selftest')
    {
      const r = runAllTests();
      out.push('Tests: ' + r.passed + ' passed, ' + r.failed + ' failed');
      r.errors.forEach(function(err)
      {
        out.push('  FAIL ' + err.test + ': ' + err.error);
      });
    }
    else if (fn === 'listfilters')
    {
      listFilters_(out);
    }
    else if (fn === 'rebuildfilters')
    {
      rebuildFilters_(out, apply, !!(e && e.parameter && e.parameter.force === '1'));
    }
    else if (fn === 'passF')
    {
      passF_(out, apply);
    }
    else if (fn === 'inspectSenders')
    {
      const dom = (e && e.parameter && e.parameter.domain) || 'gmail.com';
      inspectSenders_(out, dom);
    }
    else
    {
      out.push('Unknown fn: ' + fn);
    }
  }
  catch (err)
  {
    // The stack goes to the execution log, not to the response: the caller
    // gets enough to report the failure, not the internals to probe it.
    out.push('ERROR: ' + err.message);
    Logger.log(err.stack || String(err));
  }
  return _textResponse_(out.join('\n'));
}
