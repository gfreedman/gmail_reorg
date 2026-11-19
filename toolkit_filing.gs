// ---------------------------------------------------------------------------
// Gmail reorg toolkit — filing mail that has no label yet.
//
// passInbox_ (the daily maintenance run) labels unfiled inbox threads; passF_
// files SpamChecked mail that no filing label holds. Both label only and never
// archive. Shared settings and helpers live in reorg_toolkit.gs.
// ---------------------------------------------------------------------------

/**
 * Resolve the destination label for a sender under the Pass F rules.
 *
 * @param {string} fromAddr - Sender address.
 * @param {Array<Object>} allRules - Rule table to match against.
 * @return {string} Destination label name, or 'Misc' if no rule matches.
 */
function _passF_dest(fromAddr, allRules)
{
  const a = (fromAddr || '').toLowerCase();
  for (let i = 0; i < allRules.length; i++)
  {
    if (a.indexOf(allRules[i][0].toLowerCase()) !== -1) return allRules[i][1];
  }
  return 'Misc';
}

/**
 * Decide whether a thread is already filed, suspected spam, or still unfiled.
 *
 * Labels the spam-checking tool owns do not count as filing. A thread carrying
 * one of its "suspect" labels is left alone even if it has no other label.
 * Lookups use hasOwnProperty, so a label named like an Object.prototype member
 * (constructor, toString) is never mistaken for a spam-tool label.
 *
 * @param {GmailThread} thread - Thread to inspect.
 * @param {Object} toolLabels - Names of every label the spam tool owns.
 * @param {Object} suspectLabels - Names of the spam tool's "suspect" labels.
 * @return {string} 'filed', 'suspect' or 'unfiled'.
 */
function _classifyThread_(thread, toolLabels, suspectLabels)
{
  const labels = thread.getLabels();
  let isSuspect = false;
  for (let k = 0; k < labels.length; k++)
  {
    const n = labels[k].getName();
    if (_hasOwn_(suspectLabels, n))
    {
      isSuspect = true;
    }
    else if (!_hasOwn_(toolLabels, n))
    {
      return 'filed';
    }
  }
  return isSuspect ? 'suspect' : 'unfiled';
}

/**
 * Pass F: file mail the spam tool has seen but that carries no other user label.
 *
 * Works from thread-id sets, not per-thread label reads. It reads each user
 * label's thread ids once, then looks closely only at SpamChecked threads that
 * appear in no filing label. Asking each of thousands of threads for its labels
 * created one Gmail proxy object per label per thread, and Apps Script failed
 * partway with "Could not locate target object".
 *
 * Nothing is saved between runs: after an apply run, filed threads drop out of
 * the set, so the next run picks up where it stopped. The time budget is
 * checked after each label read, and before each unfiled thread, since reading
 * its sender is the slow step.
 *
 * Labels are read one after another, not as a snapshot. A thread moved out of a
 * label mid-read can be missed and get a second label; at a 03:00 run that
 * window is negligible.
 *
 * @param {Array<string>} out - Accumulator for output lines; returned to the caller as text.
 * @param {boolean} apply - False for a dry run that only reports; true to execute.
 * @param {Object} [deps] - Test injection point: {gw, rules, toolLabels,
 *     suspectLabels, now}. Production omits it.
 */
function passF_(out, apply, deps)
{
  const now = _dep_(deps, 'now', function()
  {
    return new Date().getTime();
  });
  const startTime = now();
  const MAX_RUNTIME = _RUNTIME_MS;
  const gw = _depGw_(deps);
  // The _PASS_*_RULES tables are named after the original reorg passes, which are
  // gone; the sender rules they hold are still current.
  const allRules = _dep_(deps, 'rules',
    [].concat(_MISC_TO, _PASS_F_RULES, _PASS_B_RULES, _PASS_C_LABEL_RULES, _PASS_D_LABEL_RULES));
  const toolLabels = _dep_(deps, 'toolLabels', _SPAM_TOOL_LABELS);
  const suspectLabels = _dep_(deps, 'suspectLabels', _SPAM_SUSPECT_LABELS);
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Pass F — capture SpamChecked-only received mail');
  out.push('---');

  // Null-prototype sets keyed on thread ids, so an id can never collide with
  // something on Object.prototype.
  const filedIds = Object.create(null);
  const suspectIds = Object.create(null);
  let sc = null;
  const userLabels = gw.getUserLabels();
  for (let i = 0; i < userLabels.length; i++)
  {
    const label = userLabels[i];
    const name = label.getName();
    if (name === 'SpamChecked')
    {
      sc = label;
    }
    const target = _hasOwn_(suspectLabels, name) ? suspectIds : (_hasOwn_(toolLabels, name) ? null : filedIds);
    if (!target)
    {
      continue;
    }
    // A label that cannot be read would make its threads look unfiled and get
    // them a second label, so stop rather than guess.
    let threads;
    try
    {
      threads = getAllThreadsStrict(label);
    }
    catch (e)
    {
      out.push('ABORT — could not read label "' + name + '": ' + ((e && e.message) || String(e)));
      out.push('Nothing was labelled. Re-run later.');
      return;
    }
    for (let k = 0; k < threads.length; k++)
    {
      target[threads[k].getId()] = true;
    }
    // Reading labels leaves no partial progress to keep, so stop with a clear
    // message rather than run into the hard limit with no output at all.
    if (now() - startTime > MAX_RUNTIME)
    {
      out.push('ABORT — reading labels used the whole time budget.');
      out.push('Nothing was labelled. Re-run later.');
      return;
    }
  }
  if (!sc)
  {
    out.push('No SpamChecked label found');
    return;
  }

  // Null-prototype map keyed on label names, so a key can never collide with
  // something on Object.prototype such as __proto__ or constructor.
  const dstCache = Object.create(null);
  /**
   * @param {string} name - Destination label name.
   * @return {GmailLabel|null} The label, looked up once per run.
   */
  const getDst = function(name)
  {
    if (dstCache[name] === undefined)
    {
      dstCache[name] = gw.getUserLabelByName(name) || null;
    }
    return dstCache[name];
  };

  let scThreads;
  try
  {
    scThreads = getAllThreadsStrict(sc);
  }
  catch (e)
  {
    out.push('ABORT — could not read SpamChecked: ' + ((e && e.message) || String(e)));
    out.push('Nothing was labelled. Re-run later.');
    return;
  }

  let captured = 0;
  let skippedSuspect = 0;
  let remaining = 0;
  const routeCounts = {};
  const miscDomains = {};

  for (let i = 0; i < scThreads.length; i++)
  {
    const t = scThreads[i];
    const id = t.getId();
    if (filedIds[id])
    {
      continue; // already in an org bucket — idempotent skip
    }
    if (suspectIds[id])
    {
      skippedSuspect++; // leave suspected spam alone
      continue;
    }
    if (now() - startTime > MAX_RUNTIME)
    {
      remaining++;
      continue;
    }

    let from = '';
    try
    {
      from = t.getMessages()[0].getFrom();
    }
    catch (e)
    {
      // Best-effort: the sender only picks a destination; Misc is the fallback.
    }
    const destName = _passF_dest(from, allRules);
    routeCounts[destName] = (routeCounts[destName] || 0) + 1;
    captured++;
    if (destName === 'Misc')
    {
      const m = from.match(/@([^>\s]+)/);
      if (m)
      {
        const d = m[1].toLowerCase();
        miscDomains[d] = (miscDomains[d] || 0) + 1;
      }
    }
    if (apply)
    {
      let dst = getDst(destName);
      if (!dst)
      {
        out.push('  WARN dest missing: ' + destName + ' -> filing under Misc');
        dst = getDst('Misc');
      }
      if (dst)
      {
        _safeCall(function()
        {
          dst.addToThread(t);
          return null;
        }, 'addLabel ' + destName, out);
      }
    }
  }

  out.push('---');
  if (remaining > 0)
  {
    out.push('TIME BUDGET HIT — ' + remaining + ' unfiled thread(s) not reached' +
      (apply ? '; re-run to continue' : ''));
  }
  out.push('SpamChecked threads: ' + scThreads.length);
  out.push('Captured (SpamChecked-only) this run: ' + captured);
  out.push('Skipped (suspected spam): ' + skippedSuspect);
  out.push('Routing breakdown:');
  Object.keys(routeCounts).sort(function(a, b)
    {
      return routeCounts[b] - routeCounts[a];
    })
    .forEach(function(k)
    {
      out.push('  ' + routeCounts[k] + '  -> ' + k);
    });
  if (!apply)
  {
    out.push('');
    out.push('Top Misc-bound sender domains (candidates for new rules):');
    Object.keys(miscDomains).sort(function(a, b)
      {
        return miscDomains[b] - miscDomains[a];
      })
      .slice(0, 50).forEach(function(d)
      {
        out.push('  ' + miscDomains[d] + '  ' + d);
      });
  }
  out.push((apply ? 'Applied.' : 'Dry-run only.') + ' Re-run safe (idempotent).');
}

// ---- Inbox sweep: ensure every inbox thread carries an org label ----
// INBOX is a location, not an org bucket. This labels inbox threads that lack any
// org label (routing via the same rules as Pass F, Misc fallback). Keeps everything
// in the inbox — never archives. Idempotent: already-labeled threads are skipped.
/**
 * Label inbox threads that have no user label apart from the spam checker's
 * "checked" label. Suspected spam is left alone. Labels only; never archives.
 *
 * @param {Array<string>} out - Accumulator for output lines; returned to the caller as text.
 * @param {boolean} apply - False for a dry run that only reports; true to execute.
 * @param {Object} [deps] - Test injection point: {gw, rules, toolLabels,
 *     suspectLabels}. Production omits it.
 */
function passInbox_(out, apply, deps)
{
  const startTime = new Date().getTime();
  const MAX_RUNTIME = _RUNTIME_MS;
  const gw = _depGw_(deps);
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Inbox sweep — label inbox threads into org buckets (no archiving)');
  out.push('---');

  // The _PASS_*_RULES tables are named after the original reorg passes, which are
  // gone; the sender rules they hold are still current.
  const allRules = _dep_(deps, 'rules',
    [].concat(_MISC_TO, _PASS_F_RULES, _PASS_B_RULES, _PASS_C_LABEL_RULES, _PASS_D_LABEL_RULES));
  const toolLabels = _dep_(deps, 'toolLabels', _SPAM_TOOL_LABELS);
  const suspectLabels = _dep_(deps, 'suspectLabels', _SPAM_SUSPECT_LABELS);
  // Null-prototype map keyed on label names, so a key can never collide with
  // something on Object.prototype such as __proto__ or constructor.
  const dstCache = Object.create(null);
  /**
   * @param {string} name - Destination label name.
   * @return {GmailLabel|null} The label, looked up once per run.
   */
  const getDst = function(name)
  {
    if (dstCache[name] === undefined)
    {
      dstCache[name] = gw.getUserLabelByName(name) || null;
    }
    return dstCache[name];
  };

  let covered = 0,
    suspect = 0,
    labeled = 0,
    total = 0;
  const routeCounts = {};
  let offset = 0;
  const PAGE = _LABEL_PAGE_SIZE;

  while (true)
  {
    if (new Date().getTime() - startTime > MAX_RUNTIME)
    {
      out.push('TIME BUDGET HIT at offset ' + offset);
      break;
    }
    const threads = gw.search('in:inbox', offset, PAGE);
    if (threads.length === 0) break;
    for (let i = 0; i < threads.length; i++)
    {
      const t = threads[i];
      total++;
      const state = _classifyThread_(t, toolLabels, suspectLabels);
      if (state === 'filed')
      {
        covered++;
        continue;
      }
      if (state === 'suspect')
      {
        suspect++;
        continue;
      }
      let from = '';
      try
      {
        from = t.getMessages()[0].getFrom();
      }
      catch (e)
      {
        // Best-effort: sample text enriches a report, it never gates the run.
        // Contrast backup_, where a suppressed read would have hidden data loss.
      }
      const dest = _passF_dest(from, allRules);
      routeCounts[dest] = (routeCounts[dest] || 0) + 1;
      if (apply)
      {
        let d = getDst(dest);
        if (!d)
        {
          out.push('  WARN dest missing: ' + dest + ' -> Misc');
          d = getDst('Misc');
        }
        if (d)
        {
          _safeCall(function()
          {
            d.addToThread(t);
            return null;
          }, 'label ' + dest, out);
          labeled++;
        }
      }
      else
      {
        out.push('  WOULD LABEL -> ' + dest + '  <- ' + from);
      }
    }
    offset += threads.length;
  }

  out.push('---');
  out.push('Inbox threads scanned: ' + total);
  out.push('Already in an org bucket: ' + covered);
  out.push('Suspected-spam (left alone): ' + suspect);
  out.push((apply ? 'Labeled now: ' + labeled : 'Uncovered (would label): ' +
    Object.keys(routeCounts).reduce(function(a, k)
    {
      return a + routeCounts[k];
    }, 0)));
  out.push('Routing:');
  Object.keys(routeCounts).sort(function(a, b)
    {
      return routeCounts[b] - routeCounts[a];
    })
    .forEach(function(k)
    {
      out.push('  ' + routeCounts[k] + ' -> ' + k);
    });
  out.push((apply ? 'Applied.' : 'Dry-run only.') + ' Inbox unchanged in place (no archiving).');
}
