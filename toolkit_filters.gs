// ---------------------------------------------------------------------------
// Gmail reorg toolkit — delivery filters.
//
// Rebuilds the account's Gmail filters from _FILTER_SPEC without overwriting
// hand-made ones, and lists them for review. Shared settings and helpers live
// in reorg_toolkit.gs.
// ---------------------------------------------------------------------------

/**
 * Build the key identifying a filter by its criteria.
 *
 * From and query are kept in separate halves so a from and a query with the
 * same text never collide.
 *
 * @param {string} [from] - Sender criterion.
 * @param {string} [query] - Raw query criterion.
 * @return {string} Signature key.
 */
function _filterSig_(from, query)
{
  return (from || '') + '||' + (query || '');
}

// Gmail runs EVERY matching filter — there is no first-match-wins — so two spec
// entries that can match the same message will both label it. Detected statically
// before anything is written.
//
// The subsumption test below asks whether one criterion is a substring of another.
// That is a deliberate over-approximation of Gmail's actual from: matching, which
// tokenises rather than matching raw substrings: it can report a conflict that
// Gmail would not produce, but it cannot miss one of the bare-domain conflicts
// this exists to catch. False positives are cheap (fix the spec); a false negative
// means silent double-labelling.
/**
 * Split one filter spec entry into the individual criteria it matches on.
 *
 * @param {Object} sp - Filter spec entry.
 * @return {Array<string>} Lowercased addresses, or a namespaced query token.
 */
function _specAddresses_(sp)
{
  if (sp.query)
  {
    return ['query::' + String(sp.query).toLowerCase()];
  }
  return String(sp.from).toLowerCase().split(/\s+or\s+/)
    .map(function(t)
    {
      return t.trim();
    })
    .filter(function(t)
    {
      return t.length > 0;
    });
}

// `spec` is injectable so this can be tested without the private data file.
/**
 * Find spec entries that could both match one message and so double-label it.
 *
 * @param {Array<Object>} [spec] - Spec to check; defaults to _FILTER_SPEC.
 * @return {Array<string>} Human-readable conflict descriptions; empty if clean.
 */
function _specConflicts_(spec)
{
  const list = spec || _FILTER_SPEC;
  const conflicts = {};
  const tokens = [];
  for (let i = 0; i < list.length; i++)
  {
    const sp = list[i];
    const tag = sp.label + ' (' + (sp.from || sp.query) + ')';
    _specAddresses_(sp).forEach(function(a)
    {
      tokens.push(
      {
        idx: i,
        tag: tag,
        addr: a
      });
    });
  }
  for (let x = 0; x < tokens.length; x++)
  {
    for (let y = 0; y < tokens.length; y++)
    {
      const A = tokens[x],
        B = tokens[y];
      if (A.idx === B.idx)
      {
        continue;
      }
      const aIsQuery = A.addr.indexOf('query::') === 0,
        bIsQuery = B.addr.indexOf('query::') === 0;
      if ((aIsQuery || bIsQuery) && A.addr !== B.addr)
      {
        continue;
      }
      if (A.addr === B.addr)
      {
        conflicts['dup|' + A.addr] = 'duplicate criterion "' + A.addr + '" in ' + A.tag + ' AND ' + B.tag;
      }
      else if (B.addr.indexOf(A.addr) !== -1)
      {
        conflicts['sub|' + A.addr + '|' + B.addr] = '"' + A.addr + '" (' + A.tag +
          ') also substring-matches "' + B.addr + '" (' + B.tag + ') — both filters would fire';
      }
    }
  }
  return Object.keys(conflicts).map(function(k)
  {
    return conflicts[k];
  });
}

// 'ok'     — adds exactly the spec's label with the spec's inbox setting (extra
//            removeLabelIds, forwarding or criteria are left as they are)
// 'repair' — adds no label and carries nothing else hand-made: orphaned when the
//            reorg deleted its target, so there is no user intent to keep
// 'manual' — anything else, including a filter that forwards mail, has extra
//            criteria such as a subject, or archives mail the spec keeps in the
//            inbox; not overwritten without &force=1
/**
 * Decide whether an existing filter is correct, repairable, or hand-edited.
 *
 * Matching is by from+query only, and a rewrite keeps only removeLabelIds, so
 * a filter with any other action or criterion must never count as repairable:
 * overwriting it would drop a forward or widen the filter.
 *
 * @param {Object} prior - Existing Gmail filter resource.
 * @param {string} want - Label id the spec expects.
 * @param {boolean} skipInbox - Whether the spec expects INBOX to be removed.
 * @return {string} One of 'ok', 'repair' or 'manual'.
 */
function _classifyFilter_(prior, want, skipInbox)
{
  const adds = (prior.action && prior.action.addLabelIds) || [];
  const rem = (prior.action && prior.action.removeLabelIds) || [];
  const inboxOk = skipInbox ? rem.indexOf('INBOX') !== -1 : rem.indexOf('INBOX') === -1;
  if (adds.length === 1 && adds[0] === want && inboxOk)
  {
    return 'ok';
  }
  // An orphan that archived its mail (removes INBOX) for a sender the spec keeps
  // in the inbox: a rewrite would drop the archiving, so it is not an orphan to fix.
  const dropsArchive = !skipInbox && rem.indexOf('INBOX') !== -1;
  if (adds.length === 0 && !dropsArchive && !_hasUnmanagedSettings_(prior))
  {
    return 'repair';
  }
  return 'manual';
}

/**
 * Report whether a filter carries settings a rebuild would not recreate.
 *
 * A rebuild writes only from/query criteria, addLabelIds and removeLabelIds.
 * Any other criterion (to, subject, hasAttachment...) or action (forward) with a
 * value set is something a person configured. A value counts as unset if it is
 * undefined, null, an empty string or false. size and sizeComparison count only
 * when sizeComparison is 'larger' or 'smaller', so an API default such as
 * 'unspecified' with size 0 cannot block a repair.
 *
 * @param {Object} prior - Existing Gmail filter resource.
 * @return {boolean} True if any unmanaged criterion or action is set.
 */
function _hasUnmanagedSettings_(prior)
{
  const managedCriteria = ['from', 'query'];
  const managedActions = ['addLabelIds', 'removeLabelIds'];
  const sizeFields = ['size', 'sizeComparison'];
  /**
   * @param {*} v - Field value.
   * @return {boolean} False for undefined, null, '' and false.
   */
  const isSet = function(v)
  {
    return v !== undefined && v !== null && v !== '' && v !== false;
  };
  const criteria = prior.criteria || {};
  const action = prior.action || {};
  const sizeRule = criteria.sizeComparison === 'larger' || criteria.sizeComparison === 'smaller';
  const extraCriteria = sizeRule || Object.keys(criteria).some(function(k)
  {
    return managedCriteria.indexOf(k) === -1 && sizeFields.indexOf(k) === -1 && isSet(criteria[k]);
  });
  const extraAction = Object.keys(action).some(function(k)
  {
    return managedActions.indexOf(k) === -1 && isSet(action[k]);
  });
  return extraCriteria || extraAction;
}

/**
 * Bring the account's delivery filters in line with _FILTER_SPEC.
 *
 * Refuses to write a spec that would double-label, does not overwrite a filter
 * someone configured by hand (different labels or inbox setting, forwarding, or
 * extra criteria) unless forced, and reports a failed write rather than counting
 * it as a success.
 *
 * @param {Array<string>} out - Accumulator for output lines; returned to the caller as text.
 * @param {boolean} apply - False for a dry run that only reports; true to execute.
 * @param {boolean} force - True to overwrite hand-edited filters.
 * @param {Object} [deps] - Test injection point. See _depGw_; production omits it.
 */
function rebuildFilters_(out, apply, force, deps)
{
  const gw = _depGw_(deps);
  const spec = _dep_(deps, 'spec', _FILTER_SPEC);
  const superseded = _dep_(deps, 'superseded', _FILTER_SUPERSEDED);
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Rebuild delivery filters (replaces deleted Apple Mail rules)' +
    (force ? '  [FORCE — will overwrite hand-edited filters]' : ''));
  out.push('---');

  const conflicts = _specConflicts_(spec);
  if (conflicts.length)
  {
    out.push('SPEC CONFLICTS — ' + conflicts.length + ' found:');
    conflicts.forEach(function(c)
    {
      out.push('  !! ' + c);
    });
    if (apply)
    {
      out.push('ABORTING — refusing to write a spec that double-labels.');
      return;
    }
    out.push('Fix _FILTER_SPEC before applying.');
  }
  else
  {
    out.push('spec conflict check: clean (' + spec.length + ' entries)');
  }
  out.push('---');

  const labelId = {};
  gw.listLabels().forEach(function(l)
  {
    labelId[l.name] = l.id;
  });

  const missing = spec.filter(function(sp)
  {
    return !labelId[sp.label];
  });
  if (missing.length)
  {
    missing.forEach(function(sp)
    {
      out.push('ABORT — target label missing: ' + sp.label);
    });
    return;
  }

  const existing = gw.listFilters();
  const bySig = {};
  existing.forEach(function(f)
  {
    const c = f.criteria ||
    {};
    bySig[_filterSig_(c.from, c.query)] = f;
  });

  let created = 0,
    repaired = 0,
    ok = 0,
    skipped = 0;
  const touched = {};
  const failures = [];

  for (let i = 0; i < spec.length; i++)
  {
    const sp = spec[i];
    const want = labelId[sp.label];
    const prior = bySig[_filterSig_(sp.from, sp.query)];
    const desc = (sp.from ? 'from=' + sp.from : 'query=' + sp.query) + ' -> ' + sp.label +
      (sp.skipInbox ? ' [skip inbox]' : ' [keep in inbox]');

    // Carry over removeLabelIds this spec does not manage, so a repair never
    // silently drops settings configured outside _FILTER_SPEC.
    let carried = [];

    if (prior)
    {
      touched[prior.id] = true;
      const adds = (prior.action && prior.action.addLabelIds) || [];
      const rem = (prior.action && prior.action.removeLabelIds) || [];
      carried = rem.filter(function(id)
      {
        return id !== 'INBOX';
      });
      const state = _classifyFilter_(prior, want, sp.skipInbox);

      if (state === 'ok')
      {
        out.push('OK      ' + desc);
        ok++;
        continue;
      }
      if (state === 'manual' && !force)
      {
        out.push('MANUAL  ' + desc);
        out.push('        hand-edited: add=[' + adds.join(',') + '] remove=[' + rem.join(',') + ']' +
          (_hasUnmanagedSettings_(prior) ? ' plus forwarding or extra criteria' : '') +
          ' — left alone, re-run with &force=1 to overwrite');
        skipped++;
        continue;
      }
      if (!apply)
      {
        out.push((state === 'manual' ? 'OVERWRITE' : 'REPAIR  ') + ' ' + desc +
          '  (was add=[' + adds.join(',') + '] remove=[' + rem.join(',') + '])');
        repaired++;
        continue;
      }
      _safeCall(function()
        {
          gw.removeFilter(prior.id);
          return null;
        },
        'remove filter ' + prior.id, out);
    }
    else
    {
      if (!apply)
      {
        out.push('CREATE  ' + desc);
        created++;
        continue;
      }
    }

    // The Gmail filters API has no update method — Google documents delete-then-create,
    // so a repair is briefly filter-less. A create that fails after the delete is
    // reported as FAILED and listed under ACTION REQUIRED, never counted as success.
    const criteria = {};
    if (sp.from)
    {
      criteria.from = sp.from;
    }
    if (sp.query)
    {
      criteria.query = sp.query;
    }
    const removes = (sp.skipInbox ? ['INBOX'] : []).concat(carried);
    const action = {addLabelIds: [want]};
    if (removes.length)
    {
      action.removeLabelIds = removes;
    }

    let res = null,
      errMsg = null;
    try
    {
      res = gw.createFilter(
      {
        criteria: criteria,
        action: action
      });
    }
    catch (err)
    {
      errMsg = (err && err.message) || String(err);
    }
    if (!res || !res.id)
    {
      out.push('FAILED  ' + desc + (prior ? '   *** prior filter was deleted — SENDER NOW UNFILED ***' : ''));
      failures.push(desc + (prior ? '  [prior filter deleted — sender unfiled]' : '') +
        '  — ' + (errMsg || 'create returned no id'));
      continue;
    }
    if (prior)
    {
      repaired++;
    }
    else
    {
      created++;
    }
    out.push((prior ? 'REPAIRED ' : 'CREATED  ') + desc + '  id=' + res.id +
      (carried.length ? '  (preserved remove=[' + carried.join(',') + '])' : ''));
  }

  out.push('--- superseded by a broader filter ---');
  for (let k = 0; k < superseded.length; k++)
  {
    const sup = superseded[k];
    const stale = bySig[_filterSig_(sup.from, sup.query)];
    const label = sup.from ? 'from=' + sup.from : 'query=' + sup.query;
    if (!stale)
    {
      out.push('skip (already gone): ' + label);
      continue;
    }
    touched[stale.id] = true;
    if (_hasUnmanagedSettings_(stale) && !force)
    {
      out.push('MANUAL  superseded ' + label + ' has forwarding or extra criteria — left alone,' +
        ' re-run with &force=1 to delete');
      skipped++;
      continue;
    }
    if (!apply)
    {
      out.push('WOULD DELETE ' + label + '  (' + stale.id + ')');
      continue;
    }
    _safeCall(function()
      {
        gw.removeFilter(stale.id);
        return null;
      },
      'remove filter ' + stale.id, out);
    out.push('deleted superseded filter: ' + label);
  }

  out.push('--- filters left untouched (not in spec) ---');
  existing.forEach(function(f)
  {
    if (touched[f.id])
    {
      return;
    }
    const c = f.criteria ||
      {},
      a = f.action ||
      {};
    const adds = (a.addLabelIds || []).join(',');
    out.push('  ' + f.id + '  ' + (c.from ? 'from=' + c.from : 'query=' + (c.query || '(none)')) +
      '  add=[' + adds + ']' + (adds ? '' : '  <-- DEAD, no label applied'));
  });

  out.push('---');
  out.push((apply ? 'Created ' + created + ', repaired ' + repaired + ', already correct ' + ok :
      'Dry-run: would create ' + created + ', repair ' + repaired + '; ' + ok + ' already correct') +
    (skipped ? ', ' + skipped + ' hand-edited SKIPPED' : '') +
    '. Re-run safe (idempotent).');

  if (failures.length)
  {
    out.push('');
    out.push('*** ACTION REQUIRED — ' + failures.length + ' filter(s) failed to write ***');
    failures.forEach(function(f)
    {
      out.push('  ' + f);
    });
    out.push('Re-run to retry; any sender marked "unfiled" has no delivery filter right now.');
  }
}

// ---- Read-only: dump every Gmail filter, resolving label IDs to names ----
// Flags filters whose destination is an old-tree label (any name not in the
// final plan) or a label that no longer exists. Needs gmail.settings.basic —
// if curl says "do not have permission", run listFiltersNow() from the editor.
/**
 * Dump every Gmail filter, resolving label ids and flagging off-plan targets.
 *
 * @param {Array<string>} out - Accumulator for output lines; returned to the caller as text.
 */
function listFilters_(out)
{
  const labelName = {};
  (Gmail.Users.Labels.list('me').labels || []).forEach(function(l)
  {
    labelName[l.id] = l.name;
  });
  const PLAN = _PLAN_LABELS;

  const all = Gmail.Users.Settings.Filters.list('me').filter || [];
  out.push('Total filters: ' + all.length);
  out.push('---');

  const suspect = [];
  all.forEach(function(f)
  {
    const c = f.criteria ||
      {},
      a = f.action ||
      {};
    const crit = ['from', 'to', 'subject', 'query', 'negatedQuery', 'hasAttachment']
      .filter(function(k)
      {
        return c[k];
      })
      .map(function(k)
      {
        return k + '=' + c[k];
      }).join(' ');
    const adds = (a.addLabelIds || []).map(function(id)
    {
      return labelName[id] ? labelName[id] : id + '(DELETED)';
    });
    const rem = (a.removeLabelIds || []).map(function(id)
    {
      return labelName[id] ? labelName[id] : id;
    });
    const bad = adds.filter(function(n)
    {
      return n.indexOf('(DELETED)') !== -1 ||
        (n !== 'TRASH' && n !== 'SPAM' && PLAN.indexOf(n) === -1);
    });
    out.push((bad.length ? '!! ' : '   ') + f.id);
    out.push('      criteria: ' + (crit || '(none)'));
    out.push('      add: [' + adds.join(', ') + ']' + (rem.length ? '  remove: [' + rem.join(', ') + ']' : ''));
    if (bad.length)
    {
      suspect.push(
      {
        id: f.id,
        crit: crit,
        bad: bad
      });
    }
  });

  out.push('---');
  out.push('Filters targeting off-plan or deleted labels: ' + suspect.length);
  suspect.forEach(function(s)
  {
    out.push('  ' + s.id + '  ' + s.crit + '  ->  ' + s.bad.join(', '));
  });
}

// Fallback when the deployed web-app token lacks gmail.settings.basic:
// run this from the Apps Script editor (Run) and read the execution log.
/**
 * Run listFilters_ from the Apps Script editor when curl lacks the scope.
 *
 * @return {string} The filter listing.
 */
function listFiltersNow()
{
  const out = [];
  listFilters_(out);
  const log = out.join('\n');
  Logger.log(log);
  return log;
}
