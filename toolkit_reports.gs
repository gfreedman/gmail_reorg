// ---------------------------------------------------------------------------
// Gmail reorg toolkit — read-only reports and the restore backup.
//
// Counts against the plan labels, orphan diagnosis, sender and category
// breakdowns, and a label -> thread-id dump for restoring after a bad sweep.
// Shared settings and helpers live in reorg_toolkit.gs.
// ---------------------------------------------------------------------------

/**
 * List the filing labels in the plan: every plan label the spam tool does not own.
 *
 * @param {Array<string>} plan - The plan's label names.
 * @param {Object} toolLabels - Names of every label the spam tool owns.
 * @return {Array<string>} Plan labels that count as filing.
 */
function _filingLabels_(plan, toolLabels)
{
  return plan.filter(function(name)
  {
    return !_hasOwn_(toolLabels, name);
  });
}

/**
 * List the user labels that are neither in the plan nor owned by the spam tool.
 *
 * @param {Array<string>} userLabelNames - Names of every user label in the account.
 * @param {Array<string>} plan - The plan's label names.
 * @param {Object} toolLabels - Names of every label the spam tool owns.
 * @return {Array<string>} Labels outside the plan, in the order given.
 */
function _unplannedLabels_(userLabelNames, plan, toolLabels)
{
  const covered = Object.create(null);
  plan.forEach(function(name)
  {
    covered[name] = true;
  });
  return userLabelNames.filter(function(name)
  {
    return !covered[name] && !_hasOwn_(toolLabels, name);
  });
}

/**
 * Report authoritative per-label counts and reconcile them against the mailbox.
 *
 * Counts every filing label in _PLAN_LABELS. The reconciliation matters more
 * than the counts: it is what surfaces threads that belong to no plan label. A
 * label that cannot be read is reported as READ FAILED, and the output warns
 * which totals are then off. Stops counting labels at the time budget and says
 * so, rather than being killed with no output.
 *
 * @param {Array<string>} out - Accumulator for output lines; returned to the caller as text.
 */
function finalCounts_(out)
{
  const startTime = new Date().getTime();
  const planIds = Object.create(null);
  let readFailures = 0;
  let timedOut = false;
  _filingLabels_(_PLAN_LABELS, _SPAM_TOOL_LABELS).forEach(function(name)
  {
    if (timedOut || new Date().getTime() - startTime > _RUNTIME_MS_LARGE_OUTPUT)
    {
      timedOut = true;
      return;
    }
    const label = GmailApp.getUserLabelByName(name);
    if (!label)
    {
      out.push(name + ': (label missing)');
      return;
    }
    let threads;
    try
    {
      threads = getAllThreadsStrict(label);
    }
    catch (e)
    {
      readFailures++;
      out.push(name + ': READ FAILED — ' + ((e && e.message) || String(e)));
      return;
    }
    threads.forEach(function(t)
    {
      planIds[t.getId()] = true;
    });
    out.push(name + ': ' + threads.length);
  });
  out.push('---');
  if (timedOut)
  {
    out.push('TIME BUDGET HIT — remaining labels were not counted; the totals below are incomplete.');
    return;
  }
  const planUnique = Object.keys(planIds).length;
  out.push('Plan unique threads: ' + planUnique);

  // SpamChecked
  const sc = GmailApp.getUserLabelByName('SpamChecked');
  const scIds = Object.create(null);
  if (sc)
  {
    try
    {
      getAllThreadsStrict(sc).forEach(function(t)
      {
        scIds[t.getId()] = true;
      });
    }
    catch (e)
    {
      readFailures++;
      out.push('SpamChecked: READ FAILED — ' + ((e && e.message) || String(e)));
    }
  }
  out.push('SpamChecked threads: ' + Object.keys(scIds).length);
  if (readFailures > 0)
  {
    out.push('WARNING: ' + readFailures + ' label(s) could not be read. Plan unique, SpamChecked and ' +
      'SpamChecked-only undercount; Unaccounted overstates.');
  }

  // SpamChecked-only (no plan label)
  let scOnly = 0;
  Object.keys(scIds).forEach(function(id)
  {
    if (!planIds[id]) scOnly++;
  });
  out.push('SpamChecked-only (no plan label): ' + scOnly);

  // Inbox (system label)
  const inboxCount = GmailApp.search('in:inbox', 0, _PAGE_SIZE).length;
  out.push('INBOX label (current view): ' + inboxCount + (inboxCount === _PAGE_SIZE ? '+' : ''));

  // Total Gmail account (excl trash/spam)
  // Sample via search with batches — search returns max 500 per call, we paginate
  let total = 0;
  let start = 0;
  const batch = _PAGE_SIZE;
  while (true)
  {
    const got = GmailApp.search('in:anywhere -in:trash -in:spam', start, batch).length;
    total += got;
    if (got < batch) break;
    start += batch;
    if (start > _SCAN_MAX_THREADS) break; // safety
  }
  out.push('Total Gmail threads (excl Trash/Spam): ' + total);
  out.push('Unaccounted (not in plan, not SpamChecked): ' + (total - planUnique - scOnly));

  // True received orphans (excludes sent items the user doesn't want labeled)
  let receivedOrphans = 0;
  let s2 = 0;
  while (true)
  {
    const got = GmailApp.search('has:nouserlabels -in:trash -in:spam -in:sent', s2, _PAGE_SIZE).length;
    receivedOrphans += got;
    if (got < _PAGE_SIZE) break;
    s2 += _PAGE_SIZE;
    if (s2 > _SCAN_MAX_THREADS) break;
  }
  out.push('True received orphans (has:nouserlabels -in:sent): ' + receivedOrphans);
}

/**
 * Break down unlabelled mail by category and sender so it can be triaged.
 *
 * @param {Array<string>} out - Accumulator for output lines; returned to the caller as text.
 */
function diagnoseOrphans_(out)
{
  // 1. User labels outside the plan (and not the spam tool's) and their thread counts.
  // The helper works on names; the loop below needs the label objects to count them.
  const userLabels = GmailApp.getUserLabels();
  const unplanned = Object.create(null);
  _unplannedLabels_(userLabels.map(function(l)
  {
    return l.getName();
  }), _PLAN_LABELS, _SPAM_TOOL_LABELS).forEach(function(name)
  {
    unplanned[name] = true;
  });
  out.push('=== USER LABELS NOT IN PLAN ===');
  let unmappedLabelCount = 0;
  userLabels.forEach(function(l)
  {
    if (unplanned[l.getName()])
    {
      const c = getThreadCountForLabel(l);
      if (c < 0)
      {
        out.push('  ' + l.getName() + ': READ FAILED');
        unmappedLabelCount++;
      }
      else if (c > 0)
      {
        out.push('  ' + l.getName() + ': ' + c);
        unmappedLabelCount++;
      }
    }
  });
  out.push('(' + unmappedLabelCount + ' unmapped labels with content)');
  out.push('');

  // 2. Truly-orphan threads (no user labels at all)
  let trueOrphans = 0;
  let start = 0;
  while (true)
  {
    const got = GmailApp.search('has:nouserlabels -in:trash -in:spam', start, _PAGE_SIZE).length;
    trueOrphans += got;
    if (got < _PAGE_SIZE) break;
    start += _PAGE_SIZE;
    if (start > _SCAN_MAX_THREADS) break;
  }
  out.push('=== TRULY UNLABELED (has:nouserlabels): ' + trueOrphans + ' ===');
  out.push('');

  // 3. Gmail Category breakdown for orphans
  out.push('=== GMAIL CATEGORIES (among unlabeled) ===');
  ['category:promotions', 'category:social', 'category:updates', 'category:forums', 'category:purchases'].forEach(function(cat)
  {
    let c = 0;
    let s = 0;
    while (true)
    {
      const got = GmailApp.search('has:nouserlabels -in:trash -in:spam ' + cat, s, _PAGE_SIZE).length;
      c += got;
      if (got < _PAGE_SIZE) break;
      s += _PAGE_SIZE;
      if (s > _SCAN_MAX_THREADS) break;
    }
    out.push('  ' + cat + ': ' + c);
  });
  out.push('');

  // 4. Top sender domains among truly-orphan threads
  out.push('=== TOP ' + _TOP_N + ' SENDER DOMAINS (among unlabeled, sampled ' +
    (_PAGE_SIZE * 2) + ' most recent) ===');
  const sample = GmailApp.search('has:nouserlabels -in:trash -in:spam', 0, _PAGE_SIZE);
  const sample2 = GmailApp.search('has:nouserlabels -in:trash -in:spam', _PAGE_SIZE, _PAGE_SIZE);
  const all = sample.concat(sample2);
  // Null-prototype map: the keys below come from message headers or label names,
  // which are outside our control. On a plain object a key of __proto__ or
  // constructor resolves to something on Object.prototype instead of an own
  // property, silently corrupting the tally.
  const counts = Object.create(null);
  all.forEach(function(t)
  {
    try
    {
      const from = t.getMessages()[0].getFrom();
      const match = from.match(/@([^>\s]+)/);
      if (match)
      {
        const dom = match[1].toLowerCase();
        counts[dom] = (counts[dom] || 0) + 1;
      }
    }
    catch (e)
    {
      // Best-effort: sample text enriches a report, it never gates the run.
      // Contrast backup_, where a suppressed read would have hidden data loss.
    }
  });
  const sorted = Object.keys(counts).map(function(k)
  {
    return [k, counts[k]];
  }).sort(function(a, b)
  {
    return b[1] - a[1];
  });
  sorted.slice(0, _TOP_N).forEach(function(pair)
  {
    out.push('  ' + pair[1] + '  ' + pair[0]);
  });
}

/**
 * List the most frequent senders within one domain among unlabelled mail.
 *
 * @param {Array<string>} out - Accumulator for output lines; returned to the caller as text.
 * @param {string} domain - Domain to inspect, e.g. "gmail.com".
 */
function inspectSenders_(out, domain)
{
  // Cap at 250 messages — Apps Script 6-min limit can't handle more per-message metadata fetches
  // Exclude in:sent — user's own sent items aren't orphans
  out.push('=== TOP SENDER EMAILS in has:nouserlabels -in:sent from:' + domain +
    ' (sampled ' + MAX_SAMPLE + ' most recent) ===');
  const query = (domain && domain !== 'all' ? 'from:' + domain + ' ' : '') + 'has:nouserlabels -in:trash -in:spam -in:sent';
  const MAX_SAMPLE = 250;
  // Null-prototype map: the keys below come from message headers or label names,
  // which are outside our control. On a plain object a key of __proto__ or
  // constructor resolves to something on Object.prototype instead of an own
  // property, silently corrupting the tally.
  const counts = Object.create(null);
  let total = 0;
  const startTime = new Date().getTime();
  const resp = Gmail.Users.Messages.list('me',
  {
    q: query,
    maxResults: MAX_SAMPLE
  });
  if (resp.messages)
  {
    for (let i = 0; i < resp.messages.length; i++)
    {
      if (new Date().getTime() - startTime > _RUNTIME_MS)
      {
        out.push('TIME BUDGET HIT — partial sample, ' + total + ' messages scanned');
        break;
      }
      try
      {
        const meta = Gmail.Users.Messages.get('me', resp.messages[i].id,
        {
          format: 'metadata',
          metadataHeaders: ['From']
        });
        const headers = (meta.payload && meta.payload.headers) || [];
        for (let h = 0; h < headers.length; h++)
        {
          if (headers[h].name.toLowerCase() === 'from')
          {
            const match = headers[h].value.match(/[\w.+-]+@[\w.-]+/);
            if (match)
            {
              const addr = match[0].toLowerCase();
              counts[addr] = (counts[addr] || 0) + 1;
            }
            break;
          }
        }
        total++;
      }
      catch (e)
      {
        // Best-effort: sample text enriches a report, it never gates the run.
        // Contrast backup_, where a suppressed read would have hidden data loss.
      }
    }
  }
  out.push('Sampled: ' + total + ' messages');
  const sorted = Object.keys(counts).map(function(k)
  {
    return [k, counts[k]];
  }).sort(function(a, b)
  {
    return b[1] - a[1];
  });
  out.push('');
  sorted.slice(0, 60).forEach(function(pair)
  {
    out.push('  ' + pair[1] + '  ' + pair[0]);
  });
}

/**
 * Sample unlabelled mail in one Gmail category to judge how to file it.
 *
 * @param {Array<string>} out - Accumulator for output lines; returned to the caller as text.
 * @param {string} cat - Gmail category, e.g. "promotions".
 */
function inspectCategory_(out, cat)
{
  out.push('=== TOP SENDER DOMAINS in has:nouserlabels category:' + cat + ' ===');
  let all = [];
  let offset = 0;
  while (offset < _SWEEP_MAX_THREADS)
  {
    const got = GmailApp.search('has:nouserlabels -in:trash -in:spam category:' + cat, offset, _PAGE_SIZE);
    all = all.concat(got);
    if (got.length < _PAGE_SIZE) break;
    offset += _PAGE_SIZE;
  }
  out.push('Total threads: ' + all.length);
  // Null-prototype map: the keys below come from message headers or label names,
  // which are outside our control. On a plain object a key of __proto__ or
  // constructor resolves to something on Object.prototype instead of an own
  // property, silently corrupting the tally.
  const counts = Object.create(null);
  all.forEach(function(t)
  {
    try
    {
      const from = t.getMessages()[0].getFrom();
      const match = from.match(/@([^>\s]+)/);
      if (match)
      {
        const dom = match[1].toLowerCase();
        counts[dom] = (counts[dom] || 0) + 1;
      }
    }
    catch (e)
    {
      // Best-effort: sample text enriches a report, it never gates the run.
      // Contrast backup_, where a suppressed read would have hidden data loss.
    }
  });
  const sorted = Object.keys(counts).map(function(k)
  {
    return [k, counts[k]];
  }).sort(function(a, b)
  {
    return b[1] - a[1];
  });
  out.push('');
  sorted.slice(0, 50).forEach(function(pair)
  {
    out.push('  ' + pair[1] + '  ' + pair[0]);
  });
}

// ---- Misc breakdown: find natural clusters among Misc threads ----
/**
 * Tally Misc by sender domain, to find clusters worth extracting.
 *
 * @param {Array<string>} out - Accumulator for output lines; returned to the caller as text.
 */
function miscBreakdown_(out)
{
  const startTime = new Date().getTime();
  const MAX_RUNTIME = _RUNTIME_MS_LARGE_OUTPUT;
  const src = GmailApp.getUserLabelByName('Misc');
  if (!src)
  {
    out.push('No Misc label');
    return;
  }
  const domainCounts = {};
  let scanned = 0;
  let offset = 0;
  const PAGE = _LABEL_PAGE_SIZE;
  while (true)
  {
    if (new Date().getTime() - startTime > MAX_RUNTIME)
    {
      out.push('TIME BUDGET HIT — partial (' + scanned + ' scanned)');
      break;
    }
    const threads = src.getThreads(offset, PAGE);
    if (threads.length === 0) break;
    for (let i = 0; i < threads.length; i++)
    {
      try
      {
        const from = threads[i].getMessages()[0].getFrom();
        const m = from.match(/@([^>\s]+)/);
        if (m)
        {
          const d = m[1].toLowerCase().replace(/[">]+$/, '');
          domainCounts[d] = (domainCounts[d] || 0) + 1;
        }
      }
      catch (e)
      {
        // Best-effort: sample text enriches a report, it never gates the run.
        // Contrast backup_, where a suppressed read would have hidden data loss.
      }
      scanned++;
    }
    offset += threads.length;
  }
  out.push('=== Misc sender-domain breakdown (' + scanned + ' threads scanned) ===');
  const sorted = Object.keys(domainCounts).map(function(k)
    {
      return [k, domainCounts[k]];
    })
    .sort(function(a, b)
    {
      return b[1] - a[1];
    });
  sorted.slice(0, 70).forEach(function(p)
  {
    out.push('  ' + p[1] + '  ' + p[0]);
  });
  out.push('---');
  out.push('Distinct domains: ' + sorted.length + ' · singletons: ' + sorted.filter(function(p)
  {
    return p[1] === 1;
  }).length);
}

// ---- Scope-free mailbox backup (label -> thread IDs) ----
// Emits, per user label, the list of thread IDs it contains. This is the restore
// key for label changes: to revert a move, recreate the old label and re-add it
// to these IDs. Uses only Gmail scope (no Sheets/Drive re-auth). getId() is cheap
// (no message fetch), so the whole mailbox dumps in one response; if it ever hits the
// time budget it checkpoints by label index and the caller appends across curls.
/**
 * Dump every label and its thread ids as text, for restore after a bad sweep.
 *
 * Deliberately scope-free: it uses only the Gmail scope, so taking a backup
 * never triggers a Sheets or Drive re-authorisation. Resumable via checkpoint.
 *
 * A label whose threads cannot be read is reported as READ FAILED and the run
 * refuses to declare success, because an empty list would otherwise be
 * indistinguishable from a label that is genuinely empty.
 *
 * @param {Array<string>} out - Accumulator for output lines; returned to the caller as text.
 * @param {Object} [deps] - Test injection point: {gw, props}. Production omits it.
 * @throws {Error} If deps is supplied without props (see _depProps_).
 */
function backup_(out, deps)
{
  const startTime = new Date().getTime();
  const gw = _depGw_(deps);
  const props = _depProps_(deps);
  const labels = gw.getUserLabels();
  let labelIdx = parseInt(props.getProperty('backup_labelIdx') || '0', 10);
  let failed = parseInt(props.getProperty('backup_failed') || '0', 10);
  if (labelIdx === 0)
  {
    out.push('# Gmail label->threadID backup  ' + new Date().toISOString());
  }
  for (; labelIdx < labels.length; labelIdx++)
  {
    if (new Date().getTime() - startTime > _RUNTIME_MS_LARGE_OUTPUT)
    {
      out.push('# TIME BUDGET HIT at label ' + labelIdx + '/' + labels.length + ' — re-run to resume');
      props.setProperty('backup_labelIdx', String(labelIdx));
      props.setProperty('backup_failed', String(failed));
      return;
    }
    const label = labels[labelIdx];
    // A read failure here must NOT be swallowed. An empty id list is
    // indistinguishable from a label that genuinely has no threads, so a
    // silently-caught error would produce a backup that looks complete and
    // restores nothing. Mark the label and refuse to declare success.
    let ids = null;
    try
    {
      ids = getAllThreadsStrict(label).map(function(t)
      {
        return t.getId();
      });
    }
    catch (e)
    {
      failed++;
      out.push('### ' + label.getName() + ' (READ FAILED — NOT BACKED UP)');
      out.push('# error: ' + ((e && e.message) || String(e)));
      continue;
    }
    out.push('### ' + label.getName() + ' (' + ids.length + ')');
    out.push(ids.join(','));
  }
  props.deleteProperty('backup_labelIdx');
  props.deleteProperty('backup_failed');
  if (failed > 0)
  {
    out.push('# BACKUP INCOMPLETE — ' + failed + ' of ' + labels.length +
      ' label(s) could not be read. Re-run before relying on this backup.');
    return;
  }
  out.push('# BACKUP COMPLETE — ' + labels.length + ' labels');
}
