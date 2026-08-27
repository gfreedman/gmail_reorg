// ---------------------------------------------------------------------------
// Gmail reorg toolkit — logic only.
//
// All configuration (sender rules, addresses, thread IDs, label names) lives in
// _private_data.gs, which is git-ignored because it contains personal data.
// This file is safe to commit and review.
//
// Entry point is doGet(e): every route is dry-run by default and takes &apply=1
// to execute. All mutating routes are idempotent, checkpointed, and time-budgeted.
// ---------------------------------------------------------------------------




function _ck(scope, key) { PropertiesService.getScriptProperties().setProperty(scope + '_' + key, '1'); }
function _ckDone(scope, key) { return PropertiesService.getScriptProperties().getProperty(scope + '_' + key) === '1'; }
function _checkpoint(key) { _ck('passA', key); }
function _isDone(key) { return _ckDone('passA', key); }
function _clearPassACheckpoints() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(function (k) { if (k.indexOf('passA_') === 0) props.deleteProperty(k); });
}

function _safeCall(fn, desc, out) {
  try {
    return withRetry(fn, desc, { maxAttempts: 4, baseDelayMs: 1000 });
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (msg.toLowerCase().indexOf('not found') !== -1) {
      out.push('  warn: ' + desc + ' — Not found (likely already handled), skipping');
      return null;
    }
    throw e;
  }
}

function passA_(out, apply) {
  const startTime = new Date().getTime();
  const MAX_RUNTIME = 300000; // 5min budget within 6min Apps Script limit
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Pass A (resilient)');
  out.push('---');

  // 1. Ensure new destination labels exist (idempotent)
  _PASS_A_NEW_LABELS.forEach(function (name) {
    const existing = GmailApp.getUserLabelByName(name);
    if (!existing) {
      out.push((apply ? 'CREATE' : 'WOULD CREATE') + ' label: ' + name);
      if (apply) _safeCall(function () { return GmailApp.createLabel(name); }, 'createLabel ' + name, out);
    } else {
      out.push('exists: ' + name);
    }
  });
  out.push('');

  // 2. Migrate threads — per-source checkpoints, chunks of 50, per-chunk retry
  const migrations = _PASS_A_MIGRATIONS;
  let totalMigrated = 0;
  for (let i = 0; i < migrations.length; i++) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) {
      out.push('TIME BUDGET HIT — stopping, re-run to resume');
      out.push('Migrated this run: ' + totalMigrated);
      return;
    }
    const pair = migrations[i];
    const ckey = 'mig_' + pair[0];
    if (_isDone(ckey)) { out.push('  done already: ' + pair[0]); continue; }

    const src = GmailApp.getUserLabelByName(pair[0]);
    if (!src) { out.push('SKIP (no src): ' + pair[0]); if (apply) _checkpoint(ckey); continue; }
    const dst = apply ? GmailApp.getUserLabelByName(pair[1]) : null;
    const threads = getAllThreadsFromLabel(src);
    out.push((apply ? 'MIGRATE' : 'WOULD MIGRATE') + ' ' + threads.length + ' threads: ' + pair[0] + ' -> ' + pair[1]);
    if (apply && dst && threads.length > 0) {
      for (let j = 0; j < threads.length; j += 50) {
        const chunk = threads.slice(j, j + 50);
        _safeCall(function () { dst.addToThreads(chunk); return null; }, 'addToThreads ' + pair[1] + ' chunk ' + j, out);
        _safeCall(function () { src.removeFromThreads(chunk); return null; }, 'removeFromThreads ' + pair[0] + ' chunk ' + j, out);
      }
    }
    totalMigrated += threads.length;
    if (apply) _checkpoint(ckey);
  }
  out.push('Migrated this run: ' + totalMigrated);
  out.push('');

  // 3. Trash + delete defunct labels — per-label checkpoint, per-thread retry
  let totalTrashed = 0;
  for (let k = 0; k < _PASS_A_TRASH_LABELS.length; k++) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) {
      out.push('TIME BUDGET HIT — stopping, re-run to resume');
      out.push('Trashed this run: ' + totalTrashed);
      return;
    }
    const name = _PASS_A_TRASH_LABELS[k];
    const ckey = 'trash_' + name;
    if (_isDone(ckey)) { out.push('  done already: ' + name); continue; }

    const label = GmailApp.getUserLabelByName(name);
    if (!label) { out.push('skip (gone): ' + name); if (apply) _checkpoint(ckey); continue; }
    const threads = getAllThreadsFromLabel(label);
    out.push((apply ? 'TRASH+DELETE' : 'WOULD TRASH+DELETE') + ' ' + name + ' (' + threads.length + ' threads)');
    if (apply) {
      let trashedHere = 0;
      threads.forEach(function (t) {
        _safeCall(function () { t.moveToTrash(); return null; }, 'moveToTrash in ' + name, out);
        trashedHere++;
      });
      // Re-fetch in case anything new appeared; only delete label if truly empty
      const stillThere = label.getThreads(0, 1);
      if (stillThere.length === 0) {
        _safeCall(function () { GmailApp.deleteLabel(label); return null; }, 'deleteLabel ' + name, out);
      } else {
        out.push('  warn: ' + name + ' still has ' + stillThere.length + ' threads, not deleting label');
      }
      totalTrashed += trashedHere;
    }
    if (apply) _checkpoint(ckey);
  }
  out.push('Trashed this run: ' + totalTrashed);
  out.push('---');
  out.push('Pass A complete for this run. Re-run safe — checkpointed steps skipped.');
}


function _buildOverlapMap() {
  const threadNodes = {};
  const threadCache = {};
  Object.keys(_TREE).forEach(function (node) {
    _TREE[node].forEach(function (src) {
      const label = GmailApp.getUserLabelByName(src);
      if (!label) return;
      getAllThreadsFromLabel(label).forEach(function (t) {
        const id = t.getId();
        if (!threadNodes[id]) threadNodes[id] = [];
        if (threadNodes[id].indexOf(node) === -1) threadNodes[id].push(node);
        threadCache[id] = t;
      });
    });
  });
  return { threadNodes: threadNodes, threadCache: threadCache };
}

function reportCrossCategoryOverlaps_(out) {
  const m = _buildOverlapMap();
  const offenders = Object.keys(m.threadNodes).filter(function (id) { return m.threadNodes[id].length > 1; });
  out.push('Cross-category threads: ' + offenders.length);
  out.push('---');
  offenders.forEach(function (id) {
    const t = m.threadCache[id];
    const subj = t.getFirstMessageSubject();
    const sender = t.getMessages()[0].getFrom();
    const date = Utilities.formatDate(t.getLastMessageDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    out.push('[' + m.threadNodes[id].join(' + ') + ']  ' + date + '  ' + sender + '  | ' + subj);
  });
}

function preReorgCleanup_(out, apply) {
  const m = _buildOverlapMap();
  const offenders = Object.keys(m.threadNodes).filter(function (id) { return m.threadNodes[id].length > 1; });
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' pre-reorg cleanup');
  out.push('Cross-category threads found: ' + offenders.length);
  out.push('---');

  let removedCount = 0;
  let skippedCount = 0;
  const cache = {};

  offenders.forEach(function (id) {
    const t = m.threadCache[id];
    const nodes = m.threadNodes[id].slice().sort();
    const key = nodes.join('|');
    const winner = _WINNERS[key];
    if (!winner) {
      skippedCount++;
      out.push('SKIP (no winner rule): [' + key + ']  ' + t.getFirstMessageSubject());
      return;
    }
    const losers = nodes.filter(function (n) { return n !== winner; });
    losers.forEach(function (loserNode) {
      _TREE[loserNode].forEach(function (srcName) {
        if (!cache[srcName]) cache[srcName] = GmailApp.getUserLabelByName(srcName);
        const label = cache[srcName];
        if (!label) return;
        const threadLabelIds = t.getLabels().map(function (l) { return l.getName(); });
        if (threadLabelIds.indexOf(srcName) === -1) return;
        out.push((apply ? 'REMOVE' : 'WOULD REMOVE') + ' "' + srcName + '" from: ' + t.getFirstMessageSubject());
        if (apply) {
          label.removeFromThread(t);
        }
        removedCount++;
      });
    });
  });

  out.push('---');
  out.push('Labels removed: ' + removedCount);
  out.push('Skipped (no rule): ' + skippedCount);
}

function finalCounts_(out) {
  const planIds = {};
  Object.keys(_TREE).forEach(function (node) {
    const ids = {};
    // Count destination label (post-migration threads live here)
    const dst = GmailApp.getUserLabelByName(node);
    if (dst) getAllThreadsFromLabel(dst).forEach(function (t) {
      ids[t.getId()] = true; planIds[t.getId()] = true;
    });
    // Plus source labels (pre-migration threads still live here)
    _TREE[node].forEach(function (src) {
      const label = GmailApp.getUserLabelByName(src);
      if (!label) return;
      getAllThreadsFromLabel(label).forEach(function (t) {
        ids[t.getId()] = true;
        planIds[t.getId()] = true;
      });
    });
    out.push(node + ': ' + Object.keys(ids).length);
  });
  out.push('---');
  const planUnique = Object.keys(planIds).length;
  out.push('Plan unique threads: ' + planUnique);

  // SpamChecked
  const sc = GmailApp.getUserLabelByName('SpamChecked');
  const scIds = {};
  if (sc) getAllThreadsFromLabel(sc).forEach(function (t) { scIds[t.getId()] = true; });
  out.push('SpamChecked threads: ' + Object.keys(scIds).length);

  // SpamChecked-only (no plan label)
  let scOnly = 0;
  Object.keys(scIds).forEach(function (id) { if (!planIds[id]) scOnly++; });
  out.push('SpamChecked-only (no plan label): ' + scOnly);

  // Inbox (system label)
  const inboxCount = GmailApp.search('in:inbox', 0, 500).length;
  out.push('INBOX label (current view): ' + inboxCount + (inboxCount === 500 ? '+' : ''));

  // Total Gmail account (excl trash/spam)
  // Sample via search with batches — search returns max 500 per call, we paginate
  let total = 0;
  let start = 0;
  const batch = 500;
  while (true) {
    const got = GmailApp.search('in:anywhere -in:trash -in:spam', start, batch).length;
    total += got;
    if (got < batch) break;
    start += batch;
    if (start > 50000) break; // safety
  }
  out.push('Total Gmail threads (excl Trash/Spam): ' + total);
  out.push('Unaccounted (not in plan, not SpamChecked): ' + (total - planUnique - scOnly));

  // True received orphans (excludes sent items the user doesn't want labeled)
  let receivedOrphans = 0;
  let s2 = 0;
  while (true) {
    const got = GmailApp.search('has:nouserlabels -in:trash -in:spam -in:sent', s2, 500).length;
    receivedOrphans += got;
    if (got < 500) break;
    s2 += 500;
    if (s2 > 50000) break;
  }
  out.push('True received orphans (has:nouserlabels -in:sent): ' + receivedOrphans);
}

function diagnoseOrphans_(out) {
  // Plan source labels = considered "covered"
  const planSrcs = {};
  Object.keys(_TREE).forEach(function (node) {
    _TREE[node].forEach(function (src) { planSrcs[src] = true; });
  });
  // Also covered: spam tool labels
  ['SpamChecked', 'SuspectedSpam', 'SpamMissed'].forEach(function (n) { planSrcs[n] = true; });

  // 1. User labels NOT in plan and their thread counts
  const userLabels = GmailApp.getUserLabels();
  out.push('=== USER LABELS NOT IN PLAN ===');
  let unmappedLabelCount = 0;
  userLabels.forEach(function (l) {
    if (!planSrcs[l.getName()]) {
      const c = getThreadCountForLabel(l);
      if (c > 0) {
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
  while (true) {
    const got = GmailApp.search('has:nouserlabels -in:trash -in:spam', start, 500).length;
    trueOrphans += got;
    if (got < 500) break;
    start += 500;
    if (start > 50000) break;
  }
  out.push('=== TRULY UNLABELED (has:nouserlabels): ' + trueOrphans + ' ===');
  out.push('');

  // 3. Gmail Category breakdown for orphans
  out.push('=== GMAIL CATEGORIES (among unlabeled) ===');
  ['category:promotions', 'category:social', 'category:updates', 'category:forums', 'category:purchases'].forEach(function (cat) {
    let c = 0;
    let s = 0;
    while (true) {
      const got = GmailApp.search('has:nouserlabels -in:trash -in:spam ' + cat, s, 500).length;
      c += got;
      if (got < 500) break;
      s += 500;
      if (s > 50000) break;
    }
    out.push('  ' + cat + ': ' + c);
  });
  out.push('');

  // 4. Top sender domains among truly-orphan threads
  out.push('=== TOP 40 SENDER DOMAINS (among unlabeled, sampled 1000 most recent) ===');
  const sample = GmailApp.search('has:nouserlabels -in:trash -in:spam', 0, 500);
  const sample2 = GmailApp.search('has:nouserlabels -in:trash -in:spam', 500, 500);
  const all = sample.concat(sample2);
  const counts = {};
  all.forEach(function (t) {
    try {
      const from = t.getMessages()[0].getFrom();
      const match = from.match(/@([^>\s]+)/);
      if (match) {
        const dom = match[1].toLowerCase();
        counts[dom] = (counts[dom] || 0) + 1;
      }
    } catch (e) {}
  });
  const sorted = Object.keys(counts).map(function (k) { return [k, counts[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
  sorted.slice(0, 40).forEach(function (pair) { out.push('  ' + pair[1] + '  ' + pair[0]); });
}



function passB_(out, apply) {
  const startTime = new Date().getTime();
  const MAX_RUNTIME = 300000;
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Pass B (resilient)');
  out.push('---');

  // 1. Ensure new labels exist (idempotent)
  _PASS_B_NEW_LABELS.forEach(function (name) {
    const existing = GmailApp.getUserLabelByName(name);
    if (!existing) {
      out.push((apply ? 'CREATE' : 'WOULD CREATE') + ' label: ' + name);
      if (apply) _safeCall(function () { return GmailApp.createLabel(name); }, 'createLabel ' + name, out);
    } else {
      out.push('exists: ' + name);
    }
  });
  out.push('');

  // 2. Apply domain rules — restrict to orphan threads (has:nouserlabels)
  let totalLabeled = 0;
  for (let i = 0; i < _PASS_B_RULES.length; i++) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) {
      out.push('TIME BUDGET HIT — stopping, re-run to resume');
      out.push('Labeled this run: ' + totalLabeled);
      return;
    }
    const domain = _PASS_B_RULES[i][0];
    const destName = _PASS_B_RULES[i][1];
    const ckey = 'rule_' + domain + '_' + destName;
    if (_ckDone('passB', ckey)) { out.push('  done already: ' + domain + ' -> ' + destName); continue; }

    const query = 'from:' + domain + ' has:nouserlabels -in:trash -in:spam';
    const threads = _safeCall(function () { return GmailApp.search(query, 0, 500); }, 'search ' + domain, out) || [];

    out.push((apply ? 'LABEL' : 'WOULD LABEL') + ' ' + threads.length + ' threads: from:' + domain + ' -> ' + destName);
    if (apply && threads.length > 0) {
      const dst = GmailApp.getUserLabelByName(destName);
      if (!dst) { out.push('  ERROR: destination label missing: ' + destName); continue; }
      // Chunk 50 at a time with retry per chunk
      for (let j = 0; j < threads.length; j += 50) {
        const chunk = threads.slice(j, j + 50);
        _safeCall(function () { dst.addToThreads(chunk); return null; }, 'addToThreads ' + destName + ' chunk ' + j, out);
      }
    }
    totalLabeled += threads.length;
    if (apply) _ck('passB', ckey);
  }
  out.push('---');
  out.push('Labeled this run: ' + totalLabeled);
  out.push('Pass B complete for this run. Re-run safe.');
}





function passC_(out, apply) {
  const startTime = new Date().getTime();
  const MAX_RUNTIME = 300000;
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Pass C (resilient)');
  out.push('---');

  // 1. Create new labels
  _PASS_C_NEW_LABELS.forEach(function (name) {
    const existing = GmailApp.getUserLabelByName(name);
    if (!existing) {
      out.push((apply ? 'CREATE' : 'WOULD CREATE') + ' label: ' + name);
      if (apply) _safeCall(function () { return GmailApp.createLabel(name); }, 'createLabel ' + name, out);
    } else {
      out.push('exists: ' + name);
    }
  });
  out.push('');

  // 2. Apply extended sender rules to label real stuff
  let totalLabeled = 0;
  for (let i = 0; i < _PASS_C_LABEL_RULES.length; i++) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) {
      out.push('TIME BUDGET HIT — stopping mid-rules, re-run to resume');
      out.push('Labeled this run: ' + totalLabeled);
      return;
    }
    const domain = _PASS_C_LABEL_RULES[i][0];
    const destName = _PASS_C_LABEL_RULES[i][1];
    const ckey = 'rule_' + domain + '_' + destName;
    if (_ckDone('passC', ckey)) { out.push('  done already: ' + domain + ' -> ' + destName); continue; }
    const threads = _safeCall(function () { return GmailApp.search('from:' + domain + ' has:nouserlabels -in:trash -in:spam', 0, 500); }, 'search ' + domain, out) || [];
    out.push((apply ? 'LABEL' : 'WOULD LABEL') + ' ' + threads.length + ' threads: from:' + domain + ' -> ' + destName);
    if (apply && threads.length > 0) {
      const dst = GmailApp.getUserLabelByName(destName);
      if (!dst) { out.push('  ERROR: destination missing: ' + destName); continue; }
      for (let j = 0; j < threads.length; j += 50) {
        const chunk = threads.slice(j, j + 50);
        _safeCall(function () { dst.addToThreads(chunk); return null; }, 'addToThreads ' + destName + ' chunk ' + j, out);
      }
    }
    totalLabeled += threads.length;
    if (apply) _ck('passC', ckey);
  }
  out.push('Labeled this run: ' + totalLabeled);
  out.push('');

  // 3. Trash specific low-value sender domains
  let totalTargetedTrash = 0;
  for (let i = 0; i < _PASS_C_TRASH_DOMAINS.length; i++) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) {
      out.push('TIME BUDGET HIT — stopping mid-targeted-trash, re-run to resume');
      return;
    }
    const domain = _PASS_C_TRASH_DOMAINS[i];
    const ckey = 'trash_dom_' + domain;
    if (_ckDone('passC', ckey)) { out.push('  done already: trash ' + domain); continue; }
    const threads = _safeCall(function () { return GmailApp.search('from:' + domain + ' has:nouserlabels -in:trash -in:spam', 0, 500); }, 'search trash ' + domain, out) || [];
    out.push((apply ? 'TRASH' : 'WOULD TRASH') + ' ' + threads.length + ' threads from:' + domain);
    if (apply) {
      threads.forEach(function (t) {
        _safeCall(function () { t.moveToTrash(); return null; }, 'moveToTrash from:' + domain, out);
        totalTargetedTrash++;
      });
    }
    if (apply) _ck('passC', ckey);
  }
  out.push('Targeted-trash this run: ' + totalTargetedTrash);
  out.push('');

  // 4. Trash residue in promotions + updates categories (anything still orphan)
  let totalResidueTrash = 0;
  for (let i = 0; i < _PASS_C_CATEGORIES.length; i++) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) {
      out.push('TIME BUDGET HIT — stopping mid-residue-trash, re-run to resume');
      out.push('Residue trashed this run: ' + totalResidueTrash);
      return;
    }
    const cat = _PASS_C_CATEGORIES[i];
    const ckey = 'residue_' + cat;
    if (_ckDone('passC', ckey)) { out.push('  done already: residue ' + cat); continue; }
    let pageOffset = 0;
    let pageCount = 0;
    while (pageOffset < 5000) {
      const threads = _safeCall(function () { return GmailApp.search('has:nouserlabels -in:trash -in:spam category:' + cat, 0, 500); }, 'search residue ' + cat, out) || [];
      if (threads.length === 0) break;
      out.push((apply ? 'TRASH' : 'WOULD TRASH') + ' ' + threads.length + ' residue threads in category:' + cat + ' (page ' + pageCount + ')');
      if (!apply) break; // in dry-run, just report the first page
      threads.forEach(function (t) {
        _safeCall(function () { t.moveToTrash(); return null; }, 'moveToTrash residue ' + cat, out);
        totalResidueTrash++;
      });
      if (threads.length < 500) break;
      pageCount++;
    }
    if (apply) _ck('passC', ckey);
  }
  out.push('Residue trashed this run: ' + totalResidueTrash);
  out.push('---');
  out.push('Pass C complete for this run. Re-run safe.');
}

function inspectSenders_(out, domain) {
  // Cap at 250 messages — Apps Script 6-min limit can't handle more per-message metadata fetches
  // Exclude in:sent — user's own sent items aren't orphans
  out.push('=== TOP SENDER EMAILS in has:nouserlabels -in:sent from:' + domain + ' (sampled 250 most recent) ===');
  const query = (domain && domain !== 'all' ? 'from:' + domain + ' ' : '') + 'has:nouserlabels -in:trash -in:spam -in:sent';
  const MAX_SAMPLE = 250;
  const counts = {};
  let total = 0;
  const startTime = new Date().getTime();
  const resp = Gmail.Users.Messages.list('me', { q: query, maxResults: MAX_SAMPLE });
  if (resp.messages) {
    for (let i = 0; i < resp.messages.length; i++) {
      if (new Date().getTime() - startTime > 240000) {
        out.push('TIME BUDGET HIT — partial sample, ' + total + ' messages scanned');
        break;
      }
      try {
        const meta = Gmail.Users.Messages.get('me', resp.messages[i].id, { format: 'metadata', metadataHeaders: ['From'] });
        const headers = (meta.payload && meta.payload.headers) || [];
        for (let h = 0; h < headers.length; h++) {
          if (headers[h].name.toLowerCase() === 'from') {
            const match = headers[h].value.match(/[\w.+-]+@[\w.-]+/);
            if (match) {
              const addr = match[0].toLowerCase();
              counts[addr] = (counts[addr] || 0) + 1;
            }
            break;
          }
        }
        total++;
      } catch (e) {}
    }
  }
  out.push('Sampled: ' + total + ' messages');
  const sorted = Object.keys(counts).map(function (k) { return [k, counts[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
  out.push('');
  sorted.slice(0, 60).forEach(function (pair) {
    out.push('  ' + pair[1] + '  ' + pair[0]);
  });
}

function inspectCategory_(out, cat) {
  out.push('=== TOP SENDER DOMAINS in has:nouserlabels category:' + cat + ' ===');
  let all = [];
  let offset = 0;
  while (offset < 10000) {
    const got = GmailApp.search('has:nouserlabels -in:trash -in:spam category:' + cat, offset, 500);
    all = all.concat(got);
    if (got.length < 500) break;
    offset += 500;
  }
  out.push('Total threads: ' + all.length);
  const counts = {};
  all.forEach(function (t) {
    try {
      const from = t.getMessages()[0].getFrom();
      const match = from.match(/@([^>\s]+)/);
      if (match) {
        const dom = match[1].toLowerCase();
        counts[dom] = (counts[dom] || 0) + 1;
      }
    } catch (e) {}
  });
  const sorted = Object.keys(counts).map(function (k) { return [k, counts[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
  out.push('');
  sorted.slice(0, 50).forEach(function (pair) { out.push('  ' + pair[1] + '  ' + pair[0]); });
}


function recoverFromTrash_(out, apply) {
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' recover trashed receipts');
  out.push('---');
  let totalRecovered = 0;
  for (let i = 0; i < _PASS_C_RECOVER.length; i++) {
    const domain = _PASS_C_RECOVER[i][0];
    const destName = _PASS_C_RECOVER[i][1];
    const threads = _safeCall(function () { return GmailApp.search('from:' + domain + ' in:trash', 0, 500); }, 'search trash ' + domain, out) || [];
    out.push((apply ? 'RECOVER' : 'WOULD RECOVER') + ' ' + threads.length + ' threads from:' + domain + ' -> ' + destName);
    threads.slice(0, 3).forEach(function (t) {
      try { out.push('    ' + t.getMessages()[0].getFrom() + ' | ' + t.getFirstMessageSubject()); } catch (e) {}
    });
    if (apply && threads.length > 0) {
      const dst = GmailApp.getUserLabelByName(destName);
      if (!dst) { out.push('  ERROR: destination missing: ' + destName); continue; }
      const dstId = dst.getId ? dst.getId() : null;
      threads.forEach(function (t) {
        const id = t.getId();
        // Use Advanced Gmail API to remove TRASH and add destination label in one call
        _safeCall(function () {
          Gmail.Users.Threads.modify({ removeLabelIds: ['TRASH'] }, 'me', id);
          return null;
        }, 'untrash ' + domain, out);
        _safeCall(function () { dst.addToThread(t); return null; }, 'addLabel ' + destName, out);
      });
      totalRecovered += threads.length;
    }
  }
  out.push('---');
  out.push('Recovered this run: ' + totalRecovered);
}




function passD_(out, apply) {
  const startTime = new Date().getTime();
  const MAX_RUNTIME = 300000;
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Pass D (resilient)');
  out.push('---');

  // 1. Ensure new labels exist
  _PASS_D_NEW_LABELS.forEach(function (name) {
    const existing = GmailApp.getUserLabelByName(name);
    if (!existing) {
      out.push((apply ? 'CREATE' : 'WOULD CREATE') + ' label: ' + name);
      if (apply) _safeCall(function () { return GmailApp.createLabel(name); }, 'createLabel ' + name, out);
    } else {
      out.push('exists: ' + name);
    }
  });
  out.push('');

  // 2. Apply per-sender rules (restrict to has:nouserlabels -in:sent to avoid relabeling)
  let totalLabeled = 0;
  for (let i = 0; i < _PASS_D_LABEL_RULES.length; i++) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) {
      out.push('TIME BUDGET HIT — stopping mid-rules, re-run to resume');
      out.push('Labeled this run: ' + totalLabeled);
      return;
    }
    const sender = _PASS_D_LABEL_RULES[i][0];
    const destName = _PASS_D_LABEL_RULES[i][1];
    const ckey = 'rule_' + sender + '_' + destName;
    if (_ckDone('passD', ckey)) { out.push('  done already: ' + sender); continue; }
    const threads = _safeCall(function () { return GmailApp.search('from:' + sender + ' has:nouserlabels -in:trash -in:spam -in:sent', 0, 500); }, 'search ' + sender, out) || [];
    out.push((apply ? 'LABEL' : 'WOULD LABEL') + ' ' + threads.length + ' threads: ' + sender + ' -> ' + destName);
    if (apply && threads.length > 0) {
      const dst = GmailApp.getUserLabelByName(destName);
      if (!dst) { out.push('  ERROR: destination missing: ' + destName); continue; }
      for (let j = 0; j < threads.length; j += 50) {
        const chunk = threads.slice(j, j + 50);
        _safeCall(function () { dst.addToThreads(chunk); return null; }, 'addToThreads ' + destName + ' chunk ' + j, out);
      }
    }
    totalLabeled += threads.length;
    if (apply) _ck('passD', ckey);
  }
  out.push('Labeled this run: ' + totalLabeled);
  out.push('');

  // 3. Trash specific low-value sender domains
  let totalTrashed = 0;
  for (let i = 0; i < _PASS_D_TRASH_DOMAINS.length; i++) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) {
      out.push('TIME BUDGET HIT — stopping mid-trash, re-run to resume');
      return;
    }
    const domain = _PASS_D_TRASH_DOMAINS[i];
    const ckey = 'trash_' + domain;
    if (_ckDone('passD', ckey)) { out.push('  done already: trash ' + domain); continue; }
    const threads = _safeCall(function () { return GmailApp.search('from:' + domain + ' has:nouserlabels -in:trash -in:spam', 0, 500); }, 'search trash ' + domain, out) || [];
    out.push((apply ? 'TRASH' : 'WOULD TRASH') + ' ' + threads.length + ' threads from:' + domain);
    if (apply) {
      threads.forEach(function (t) {
        _safeCall(function () { t.moveToTrash(); return null; }, 'moveToTrash from:' + domain, out);
        totalTrashed++;
      });
    }
    if (apply) _ck('passD', ckey);
  }
  out.push('Targeted-trash this run: ' + totalTrashed);
  out.push('---');
  out.push('Pass D complete for this run. Re-run safe.');
}

function passE_misc_(out, apply) {
  const startTime = new Date().getTime();
  const MAX_RUNTIME = 300000;
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Pass E — label remaining received orphans as Misc');
  out.push('---');

  // 1. Ensure Misc label exists
  let dst = GmailApp.getUserLabelByName('Misc');
  if (!dst) {
    out.push((apply ? 'CREATE' : 'WOULD CREATE') + ' label: Misc');
    if (apply) dst = _safeCall(function () { return GmailApp.createLabel('Misc'); }, 'createLabel Misc', out);
  } else {
    out.push('exists: Misc');
  }

  // 2. Find all received orphans and label them
  const query = 'has:nouserlabels -in:trash -in:spam -in:sent';
  let totalLabeled = 0;
  let page = 0;
  while (page < 20) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) {
      out.push('TIME BUDGET HIT — stopping, re-run to resume');
      break;
    }
    // Always search from offset 0 — once labeled, threads exit the result set
    const threads = _safeCall(function () { return GmailApp.search(query, 0, 500); }, 'search orphans page ' + page, out) || [];
    if (threads.length === 0) break;
    out.push((apply ? 'LABEL' : 'WOULD LABEL') + ' ' + threads.length + ' orphans -> Misc' + (apply ? '' : ' (dry-run: not actually applied)'));
    if (!apply) break; // dry-run: show count of first page only
    for (let j = 0; j < threads.length; j += 50) {
      const chunk = threads.slice(j, j + 50);
      _safeCall(function () { dst.addToThreads(chunk); return null; }, 'addToThreads Misc chunk ' + j, out);
    }
    totalLabeled += threads.length;
    page++;
  }
  out.push('---');
  out.push('Labeled this run: ' + totalLabeled);
}







function passF_trashPolitical_(out, apply) {
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Pass F — trash political mailings');
  out.push('---');
  let trashed = 0;
  let kept = 0;

  // Pure-campaign senders: trash everything.
  _PASS_F_TRASH_PURE.forEach(function (domain) {
    const threads = _safeCall(function () {
      return GmailApp.search('from:' + domain + ' -in:trash -in:spam', 0, 500);
    }, 'search ' + domain, out) || [];
    out.push((apply ? 'TRASH' : 'WOULD TRASH') + ' ' + threads.length + ' threads from:' + domain);
    threads.slice(0, 2).forEach(function (t) { try { out.push('    e.g. ' + t.getFirstMessageSubject()); } catch (e) {} });
    if (apply) threads.forEach(function (t) {
      _safeCall(function () { t.moveToTrash(); return null; }, 'moveToTrash ' + domain, out); trashed++;
    });
  });

  // Keep receipts from the campaign sender, trash the rest.
  const keepers = _safeCall(function () {
    return GmailApp.search('from:' + _CAMPAIGN_DOMAIN + ' -in:trash -in:spam ' + _CONSERV_KEEP, 0, 500);
  }, 'search campaign keepers', out) || [];
  out.push((apply ? 'KEEP->' : 'WOULD KEEP->') + _CAMPAIGN_KEEP_LABEL + ' ' + keepers.length + ' ' + _CAMPAIGN_DOMAIN + ' threads');
  keepers.slice(0, 4).forEach(function (t) { try { out.push('    keep: ' + t.getFirstMessageSubject()); } catch (e) {} });
  if (apply && keepers.length > 0) {
    const dst = GmailApp.getUserLabelByName(_CAMPAIGN_KEEP_LABEL);
    if (dst) keepers.forEach(function (t) {
      _safeCall(function () { dst.addToThread(t); return null; }, 'label charitable', out); kept++;
    });
  }

  const trashees = _safeCall(function () {
    return GmailApp.search('from:' + _CAMPAIGN_DOMAIN + ' -in:trash -in:spam -subject:receipt -subject:contribution -subject:donation -subject:cancellation', 0, 500);
  }, 'search campaign trashees', out) || [];
  out.push(_CAMPAIGN_DOMAIN + ' campaign candidates: ' + trashees.length + ' (threads you replied to are protected -> Misc)');
  let skippedConvo = 0;
  trashees.forEach(function (t) {
    let userInvolved = false;
    try {
      const msgs = t.getMessages();
      for (let m = 0; m < msgs.length; m++) {
        if (msgs[m].getFrom().toLowerCase().indexOf(_USER_EMAIL) !== -1) { userInvolved = true; break; }
      }
    } catch (e) {}
    if (userInvolved) {
      skippedConvo++;
      out.push('    PROTECT (you replied) -> Misc: ' + (function () { try { return t.getFirstMessageSubject(); } catch (e) { return '?'; } })());
      if (apply) {
        const misc = GmailApp.getUserLabelByName('Misc');
        if (misc) _safeCall(function () { misc.addToThread(t); return null; }, 'label Misc convo', out);
      }
      return;
    }
    out.push('    ' + (apply ? 'TRASH' : 'WOULD TRASH') + ': ' + (function () { try { return t.getFirstMessageSubject(); } catch (e) { return '?'; } })());
    if (apply) { _safeCall(function () { t.moveToTrash(); return null; }, 'moveToTrash campaign sender', out); trashed++; }
  });

  out.push('---');
  out.push((apply ? ('Trashed: ' + trashed + ' · Kept as receipts: ' + kept + ' · Protected convos -> Misc: ' + skippedConvo) : 'Dry-run only') + '. Trash recoverable for 30 days.');
}

function _passF_dest(fromAddr, allRules) {
  const a = (fromAddr || '').toLowerCase();
  for (let i = 0; i < allRules.length; i++) {
    if (a.indexOf(allRules[i][0].toLowerCase()) !== -1) return allRules[i][1];
  }
  return 'Misc';
}

function passF_(out, apply) {
  const startTime = new Date().getTime();
  const MAX_RUNTIME = 300000;
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Pass F — capture SpamChecked-only received mail');
  out.push('---');

  const sc = GmailApp.getUserLabelByName('SpamChecked');
  if (!sc) { out.push('No SpamChecked label found'); return; }

  const allRules = [].concat(_MISC_TO, _PASS_F_RULES, _PASS_B_RULES, _PASS_C_LABEL_RULES, _PASS_D_LABEL_RULES);
  const dstCache = {};
  const getDst = function (name) {
    if (dstCache[name] === undefined) dstCache[name] = GmailApp.getUserLabelByName(name) || null;
    return dstCache[name];
  };

  const props = PropertiesService.getScriptProperties();
  // Offset is stable across runs: we never remove SpamChecked, so the set doesn't shift.
  let offset = apply ? parseInt(props.getProperty('passF_offset') || '0', 10) : 0;
  const PAGE = 100;
  let captured = 0;
  let skippedSuspect = 0;
  const routeCounts = {};
  const miscDomains = {};

  while (true) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) {
      out.push('TIME BUDGET HIT at offset ' + offset + ' — re-run to resume');
      break;
    }
    const threads = sc.getThreads(offset, PAGE);
    if (threads.length === 0) {
      out.push('Reached end of SpamChecked at offset ' + offset);
      if (apply) props.deleteProperty('passF_offset');
      break;
    }
    for (let i = 0; i < threads.length; i++) {
      const t = threads[i];
      const labels = t.getLabels();
      let hasOrg = false;
      let isSuspect = false;
      for (let k = 0; k < labels.length; k++) {
        const n = labels[k].getName();
        if (_SPAM_SUSPECT_LABELS[n]) isSuspect = true;
        else if (!_SPAM_TOOL_LABELS[n]) hasOrg = true;
      }
      if (hasOrg) continue;            // already in an org bucket — idempotent skip
      if (isSuspect) { skippedSuspect++; continue; } // leave suspected spam alone

      let from = '';
      try { from = t.getMessages()[0].getFrom(); } catch (e) {}
      const destName = _passF_dest(from, allRules);
      routeCounts[destName] = (routeCounts[destName] || 0) + 1;
      captured++;
      if (destName === 'Misc') {
        const m = from.match(/@([^>\s]+)/);
        if (m) { const d = m[1].toLowerCase(); miscDomains[d] = (miscDomains[d] || 0) + 1; }
      }
      if (apply) {
        let dst = getDst(destName);
        if (!dst) { out.push('  WARN dest missing: ' + destName + ' -> filing under Misc'); dst = getDst('Misc'); }
        if (dst) _safeCall(function () { dst.addToThread(t); return null; }, 'addLabel ' + destName, out);
      }
    }
    offset += threads.length;
    if (apply) props.setProperty('passF_offset', String(offset));
  }

  out.push('---');
  out.push('Captured (SpamChecked-only) this run: ' + captured);
  out.push('Skipped (suspected spam): ' + skippedSuspect);
  out.push('Routing breakdown:');
  Object.keys(routeCounts).sort(function (a, b) { return routeCounts[b] - routeCounts[a]; })
    .forEach(function (k) { out.push('  ' + routeCounts[k] + '  -> ' + k); });
  if (!apply) {
    out.push('');
    out.push('Top Misc-bound sender domains (candidates for new rules):');
    Object.keys(miscDomains).sort(function (a, b) { return miscDomains[b] - miscDomains[a]; })
      .slice(0, 50).forEach(function (d) { out.push('  ' + miscDomains[d] + '  ' + d); });
  }
  out.push((apply ? 'Applied.' : 'Dry-run only.') + ' Re-run safe (idempotent; offset checkpointed).');
}

// ---- Inbox sweep: ensure every inbox thread carries an org label ----
// INBOX is a location, not an org bucket. This labels inbox threads that lack any
// org label (routing via the same rules as Pass F, Misc fallback). Keeps everything
// in the inbox — never archives. Idempotent: already-labeled threads are skipped.
function passInbox_(out, apply) {
  const startTime = new Date().getTime();
  const MAX_RUNTIME = 300000;
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Inbox sweep — label inbox threads into org buckets (no archiving)');
  out.push('---');

  const allRules = [].concat(_MISC_TO, _PASS_F_RULES, _PASS_B_RULES, _PASS_C_LABEL_RULES, _PASS_D_LABEL_RULES);
  const dstCache = {};
  const getDst = function (name) {
    if (dstCache[name] === undefined) dstCache[name] = GmailApp.getUserLabelByName(name) || null;
    return dstCache[name];
  };

  let covered = 0, suspect = 0, labeled = 0, total = 0;
  const routeCounts = {};
  let offset = 0;
  const PAGE = 100;

  while (true) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) { out.push('TIME BUDGET HIT at offset ' + offset); break; }
    const threads = GmailApp.search('in:inbox', offset, PAGE);
    if (threads.length === 0) break;
    for (let i = 0; i < threads.length; i++) {
      const t = threads[i];
      total++;
      const labels = t.getLabels();
      let hasOrg = false, isSuspect = false;
      for (let k = 0; k < labels.length; k++) {
        const n = labels[k].getName();
        if (_SPAM_SUSPECT_LABELS[n]) isSuspect = true;
        else if (!_SPAM_TOOL_LABELS[n]) hasOrg = true;
      }
      if (hasOrg) { covered++; continue; }
      if (isSuspect) { suspect++; continue; }
      let from = '';
      try { from = t.getMessages()[0].getFrom(); } catch (e) {}
      const dest = _passF_dest(from, allRules);
      routeCounts[dest] = (routeCounts[dest] || 0) + 1;
      if (apply) {
        let d = getDst(dest);
        if (!d) { out.push('  WARN dest missing: ' + dest + ' -> Misc'); d = getDst('Misc'); }
        if (d) { _safeCall(function () { d.addToThread(t); return null; }, 'label ' + dest, out); labeled++; }
      } else {
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
    Object.keys(routeCounts).reduce(function (a, k) { return a + routeCounts[k]; }, 0)));
  out.push('Routing:');
  Object.keys(routeCounts).sort(function (a, b) { return routeCounts[b] - routeCounts[a]; })
    .forEach(function (k) { out.push('  ' + routeCounts[k] + ' -> ' + k); });
  out.push((apply ? 'Applied.' : 'Dry-run only.') + ' Inbox unchanged in place (no archiving).');
}


function flattenReading_(out, apply) {
  const startTime = new Date().getTime();
  const MAX_RUNTIME = 300000;
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Flatten Reading -> single folder');
  out.push('---');
  const dst = GmailApp.getUserLabelByName('Reading');
  if (!dst) { out.push('No Reading label found'); return; }

  let moved = 0;
  for (let s = 0; s < _READING_SOURCES.length; s++) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) { out.push('TIME BUDGET HIT — re-run to resume'); break; }
    const name = _READING_SOURCES[s];
    const src = GmailApp.getUserLabelByName(name);
    if (!src) { out.push('skip (already gone): ' + name); continue; }

    let movedHere = 0;
    let safety = 0;
    while (true) {
      if (new Date().getTime() - startTime > MAX_RUNTIME) { out.push('TIME BUDGET HIT mid-' + name); break; }
      const threads = src.getThreads(0, 50);
      if (threads.length === 0) break;
      if (!apply) { out.push('WOULD MOVE ' + threads.length + '+ from ' + name + ' -> Reading'); break; }
      _safeCall(function () { dst.addToThreads(threads); return null; }, 'addToThreads Reading', out);
      _safeCall(function () { src.removeFromThreads(threads); return null; }, 'removeFromThreads ' + name, out);
      moved += threads.length; movedHere += threads.length;
      if (++safety > 200) { out.push('safety stop on ' + name); break; }
    }
    if (apply) {
      out.push('MOVED ' + movedHere + ' from ' + name);
      const remaining = src.getThreads(0, 1);
      if (remaining.length === 0) {
        _safeCall(function () { GmailApp.deleteLabel(src); return null; }, 'deleteLabel ' + name, out);
        out.push('deleted empty label: ' + name);
      } else {
        out.push('NOT deleting ' + name + ' — still has threads');
      }
    }
  }
  out.push('---');
  out.push((apply ? 'Moved: ' + moved : 'Dry-run only') + '. Re-run safe (idempotent).');
}

// ---- Consolidate one community's mail into a single label ----
// Community mail (board, conference, events, newsletters) accumulates across
// several labels plus a stray one. Pull it into _PRODUCTBC_DEST. The query in
// _PRODUCTBC_QUERY excludes forwarded shopping receipts so those stay put.
// Label moves only — nothing is trashed.
function consolidateProductBC_(out, apply) {
  const startTime = new Date().getTime();
  const MAX_RUNTIME = 300000;
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Consolidate community mail -> ' + _PRODUCTBC_DEST);
  out.push('---');

  let dst = GmailApp.getUserLabelByName(_PRODUCTBC_DEST);
  if (!dst) {
    out.push((apply ? 'CREATE' : 'WOULD CREATE') + ' label: ' + _PRODUCTBC_DEST);
    if (apply) dst = _safeCall(function () { return GmailApp.createLabel(_PRODUCTBC_DEST); }, 'createLabel ' + _PRODUCTBC_DEST, out);
  } else {
    out.push('exists: ' + _PRODUCTBC_DEST);
  }

  const srcLabels = _PRODUCTBC_SOURCES
    .map(function (n) { return GmailApp.getUserLabelByName(n); })
    .filter(function (l) { return !!l; });

  // Community mail in those labels, minus forwarded shopping receipts.
  const q = _PRODUCTBC_QUERY;
  let moved = 0;
  let safety = 0;
  while (true) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) { out.push('TIME BUDGET HIT — re-run to resume'); break; }
    const threads = _safeCall(function () { return GmailApp.search(q, 0, 50); }, 'search community mail', out) || [];
    if (threads.length === 0) break;
    if (!apply) {
      out.push('WOULD MOVE ' + threads.length + '+ community threads -> ' + _PRODUCTBC_DEST + ' (sample below)');
      threads.slice(0, 8).forEach(function (t) { try { out.push('    ' + t.getMessages()[0].getFrom() + ' | ' + t.getFirstMessageSubject()); } catch (e) {} });
      break;
    }
    _safeCall(function () { dst.addToThreads(threads); return null; }, 'addToThreads ' + _PRODUCTBC_DEST, out);
    srcLabels.forEach(function (lbl) {
      _safeCall(function () { lbl.removeFromThreads(threads); return null; }, 'remove ' + lbl.getName(), out);
    });
    moved += threads.length;
    if (++safety > 100) { out.push('safety stop'); break; }
  }

  if (apply) {
    out.push('Moved: ' + moved);
    const stray = GmailApp.getUserLabelByName(_PRODUCTBC_STRAY);
    if (stray) {
      const remaining = stray.getThreads(0, 1);
      if (remaining.length === 0) {
        _safeCall(function () { GmailApp.deleteLabel(stray); return null; }, 'deleteLabel ' + _PRODUCTBC_STRAY, out);
        out.push('deleted empty label: ' + _PRODUCTBC_STRAY);
      } else {
        out.push('NOT deleting ' + _PRODUCTBC_STRAY + ' — still has threads');
      }
    }
  }
  out.push('---');
  out.push((apply ? 'Done.' : 'Dry-run only.') + ' Forwarded shopping receipts left in Receipts. Re-run safe.');
}



function _miscDest(from) {
  const a = (from || '').toLowerCase();
  for (let i = 0; i < _MISC_TRASH.length; i++) if (a.indexOf(_MISC_TRASH[i]) !== -1) return '__TRASH__';
  for (let i = 0; i < _MISC_TO.length; i++) if (a.indexOf(_MISC_TO[i][0]) !== -1) return _MISC_TO[i][1];
  return null;
}

function miscExtract_(out, apply) {
  const startTime = new Date().getTime();
  const MAX_RUNTIME = 280000;
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Misc extraction (user-directed clusters)');
  out.push('---');
  const misc = GmailApp.getUserLabelByName('Misc');
  if (!misc) { out.push('No Misc label'); return; }

  // Collect all Misc threads first (avoid mutation-during-pagination).
  let all = [];
  let offset = 0;
  while (true) {
    const page = misc.getThreads(offset, 100);
    if (page.length === 0) break;
    all = all.concat(page);
    offset += page.length;
    if (offset > 5000) break;
  }
  out.push('Misc threads to scan: ' + all.length);

  const dstCache = {};
  const getDst = function (n) { if (dstCache[n] === undefined) dstCache[n] = GmailApp.getUserLabelByName(n) || null; return dstCache[n]; };
  const counts = {};
  let moved = 0, trashed = 0;

  for (let i = 0; i < all.length; i++) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) { out.push('TIME BUDGET HIT at ' + i + ' — re-run to resume'); break; }
    const t = all[i];
    let from = '';
    try { from = t.getMessages()[0].getFrom(); } catch (e) {}
    const dest = _miscDest(from);
    if (!dest) continue;
    counts[dest] = (counts[dest] || 0) + 1;
    if (!apply) continue;
    if (dest === '__TRASH__') {
      _safeCall(function () { t.moveToTrash(); return null; }, 'trash misc', out); trashed++;
    } else {
      const d = getDst(dest);
      if (d) { _safeCall(function () { d.addToThread(t); return null; }, 'add ' + dest, out); _safeCall(function () { misc.removeFromThread(t); return null; }, 'remove Misc', out); moved++; }
    }
  }

  out.push('---');
  Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).forEach(function (k) { out.push('  ' + counts[k] + '  -> ' + (k === '__TRASH__' ? 'TRASH' : k)); });
  out.push((apply ? ('Moved: ' + moved + ' · Trashed: ' + trashed) : 'Dry-run only') + '. Re-run safe (idempotent).');
}

// ---- Misc breakdown: find natural clusters among Misc threads ----
function miscBreakdown_(out) {
  const startTime = new Date().getTime();
  const MAX_RUNTIME = 280000;
  const src = GmailApp.getUserLabelByName('Misc');
  if (!src) { out.push('No Misc label'); return; }
  const domainCounts = {};
  let scanned = 0;
  let offset = 0;
  const PAGE = 100;
  while (true) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) { out.push('TIME BUDGET HIT — partial (' + scanned + ' scanned)'); break; }
    const threads = src.getThreads(offset, PAGE);
    if (threads.length === 0) break;
    for (let i = 0; i < threads.length; i++) {
      try {
        const from = threads[i].getMessages()[0].getFrom();
        const m = from.match(/@([^>\s]+)/);
        if (m) { const d = m[1].toLowerCase().replace(/[">]+$/, ''); domainCounts[d] = (domainCounts[d] || 0) + 1; }
      } catch (e) {}
      scanned++;
    }
    offset += threads.length;
  }
  out.push('=== Misc sender-domain breakdown (' + scanned + ' threads scanned) ===');
  const sorted = Object.keys(domainCounts).map(function (k) { return [k, domainCounts[k]]; })
    .sort(function (a, b) { return b[1] - a[1]; });
  sorted.slice(0, 70).forEach(function (p) { out.push('  ' + p[1] + '  ' + p[0]); });
  out.push('---');
  out.push('Distinct domains: ' + sorted.length + ' · singletons: ' + sorted.filter(function (p) { return p[1] === 1; }).length);
}

// ---- Scope-free mailbox backup (label -> thread IDs) ----
// Emits, per user label, the list of thread IDs it contains. This is the restore
// key for the consolidation: to revert any move, recreate the old label and re-add
// it to these IDs. Uses only Gmail scope (no Sheets/Drive re-auth). getId() is cheap
// (no message fetch), so the whole mailbox dumps in one response; if it ever hits the
// time budget it checkpoints by label index and the caller appends across curls.
function backup_(out) {
  const startTime = new Date().getTime();
  const MAX_RUNTIME = 280000;
  const props = PropertiesService.getScriptProperties();
  const labels = GmailApp.getUserLabels();
  let labelIdx = parseInt(props.getProperty('backup_labelIdx') || '0', 10);
  if (labelIdx === 0) out.push('# Gmail label->threadID backup  ' + new Date().toISOString());
  for (; labelIdx < labels.length; labelIdx++) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) {
      out.push('# TIME BUDGET HIT at label ' + labelIdx + '/' + labels.length + ' — re-run to resume');
      props.setProperty('backup_labelIdx', String(labelIdx));
      return;
    }
    const label = labels[labelIdx];
    let ids = [];
    try { ids = getAllThreadsFromLabel(label).map(function (t) { return t.getId(); }); } catch (e) {}
    out.push('### ' + label.getName() + ' (' + ids.length + ')');
    out.push(ids.join(','));
  }
  props.deleteProperty('backup_labelIdx');
  out.push('# BACKUP COMPLETE — ' + labels.length + ' labels');
}

// ---- Structural consolidation: collapse old verbose tree into the new one ----
// Driven by _TREE (new node -> [old source labels]). Moves threads from each old
// source into its new node label, then deletes the emptied source. Label moves
// only — no mail deleted. Checkpointed per node, time-budgeted, retry-wrapped.
function consolidate_(out, apply) {
  const startTime = new Date().getTime();
  const MAX_RUNTIME = 280000;
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Structural consolidation (old -> new via _TREE)');
  out.push('---');
  let grandTotal = 0;
  const nodes = Object.keys(_TREE);
  for (let n = 0; n < nodes.length; n++) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) { out.push('TIME BUDGET HIT — re-run to resume'); break; }
    const node = nodes[n];
    const sources = _TREE[node];
    if (!sources.length) continue; // new labels with no old source — already final
    if (apply && _ckDone('consol', node)) { out.push('done already: ' + node); continue; }

    let dst = GmailApp.getUserLabelByName(node);
    if (!dst) {
      out.push((apply ? 'CREATE' : 'WOULD CREATE') + ' label: ' + node);
      if (apply) dst = _safeCall(function () { return GmailApp.createLabel(node); }, 'create ' + node, out);
    }
    let nodeMoved = 0;
    for (let s = 0; s < sources.length; s++) {
      const srcName = sources[s];
      const src = GmailApp.getUserLabelByName(srcName);
      if (!src) { out.push('  (already gone) ' + srcName); continue; }
      const threads = getAllThreadsFromLabel(src);
      out.push('  ' + (apply ? 'MOVE ' : 'WOULD MOVE ') + threads.length + ' : ' + srcName + ' -> ' + node);
      if (apply && threads.length && dst) {
        for (let i = 0; i < threads.length; i += 50) {
          const chunk = threads.slice(i, i + 50);
          _safeCall(function () { dst.addToThreads(chunk); return null; }, 'add ' + node, out);
          _safeCall(function () { src.removeFromThreads(chunk); return null; }, 'remove ' + srcName, out);
        }
        if (src.getThreads(0, 1).length === 0) {
          _safeCall(function () { GmailApp.deleteLabel(src); return null; }, 'delete ' + srcName, out);
          out.push('    deleted empty: ' + srcName);
        }
      }
      nodeMoved += threads.length;
    }
    grandTotal += nodeMoved;
    if (apply) _ck('consol', node);
  }
  out.push('---');
  out.push((apply ? 'Moved total: ' : 'Would move total: ') + grandTotal);

  if (!apply) {
    const inPlan = {};
    Object.keys(_TREE).forEach(function (nd) { inPlan[nd] = 1; _TREE[nd].forEach(function (s) { inPlan[s] = 1; }); });
    ['SpamChecked', 'SuspectedSpam', 'SpamMissed', 'Notes'].forEach(function (n) { inPlan[n] = 1; });
    out.push('');
    out.push('Coverage check — labels NOT touched by consolidation (will remain):');
    GmailApp.getUserLabels().forEach(function (l) {
      const nm = l.getName();
      if (!inPlan[nm]) { out.push('  ' + nm + ': ' + getThreadCountForLabel(l)); }
    });
  }
}


function cleanupOldParents_(out, apply) {
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Delete empty old-tree labels');
  out.push('---');
  GmailApp.getUserLabels().forEach(function (label) {
    const name = label.getName();
    const isOld = _OLD_PREFIXES.some(function (p) { return name === p || name.indexOf(p + '/') === 0; });
    if (!isOld) return;
    const remaining = label.getThreads(0, 1).length;
    if (remaining === 0) {
      out.push((apply ? 'DELETE ' : 'WOULD DELETE ') + name);
      if (apply) _safeCall(function () { GmailApp.deleteLabel(label); return null; }, 'delete ' + name, out);
    } else {
      out.push('  NOT empty (' + remaining + '+), keeping: ' + name);
    }
  });
  out.push('---');
  out.push(apply ? 'Done.' : 'Dry-run only.');
}




function inboxTriage_(out, apply) {
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Inbox triage');
  out.push('---');
  // 1. Relabel
  Object.keys(_TRIAGE_RELABEL).forEach(function (id) {
    const t = GmailApp.getThreadById(id);
    if (!t) { out.push('  (missing) ' + id); return; }
    const spec = _TRIAGE_RELABEL[id];
    const add = GmailApp.getUserLabelByName(spec[0]);
    out.push((apply ? 'RELABEL ' : 'would relabel ') + '+' + spec[0] + (spec[1].length ? ' -' + spec[1].join(',') : '') + '  | ' + t.getFirstMessageSubject());
    if (apply) {
      if (add) _safeCall(function () { add.addToThread(t); return null; }, 'add ' + spec[0], out);
      spec[1].forEach(function (rn) { const r = GmailApp.getUserLabelByName(rn); if (r) _safeCall(function () { r.removeFromThread(t); return null; }, 'rm ' + rn, out); });
    }
  });
  out.push('');
  // 2. Trash
  _TRIAGE_TRASH.forEach(function (id) {
    const t = GmailApp.getThreadById(id);
    if (!t) { out.push('  (missing) ' + id); return; }
    out.push((apply ? 'TRASH ' : 'would trash ') + t.getFirstMessageSubject());
    if (apply) _safeCall(function () { t.moveToTrash(); return null; }, 'trash ' + id, out);
  });
  out.push('');
  // 3. Archive everything in inbox except the keepers
  const keep = {}; _TRIAGE_KEEP.forEach(function (id) { keep[id] = 1; });
  let archived = 0, kept = 0;
  const inbox = GmailApp.search('in:inbox', 0, 100);
  inbox.forEach(function (t) {
    if (keep[t.getId()]) { kept++; out.push('KEEP in inbox: ' + t.getFirstMessageSubject()); return; }
    if (apply) { _safeCall(function () { t.moveToArchive(); return null; }, 'archive', out); }
    archived++;
  });
  out.push('---');
  out.push((apply ? 'Archived: ' : 'Would archive: ') + archived + ' · Kept in inbox: ' + kept + ' · Trashed: ' + _TRIAGE_TRASH.length);
}

// Run this ONCE from the Apps Script editor (Run ▶) and approve the consent screen.
// It touches the filters API so Google grants gmail.settings.basic; after that the
// listfilters and rebuildfilters routes work over curl.
function authorize() {
  Gmail.Users.Settings.Filters.list('me');
  return 'authorized — gmail.settings.basic granted';
}



function mergeDrift_(out, apply) {
  const startTime = new Date().getTime();
  const MAX_RUNTIME = 300000;
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Merge Apple Mail drift labels into the plan');
  out.push('---');

  let moved = 0;
  for (let i = 0; i < _DRIFT_MERGES.length; i++) {
    if (new Date().getTime() - startTime > MAX_RUNTIME) { out.push('TIME BUDGET HIT — re-run to resume'); break; }
    const srcName = _DRIFT_MERGES[i].src;
    const dstName = _DRIFT_MERGES[i].dst;
    const src = GmailApp.getUserLabelByName(srcName);
    if (!src) { out.push('skip (already gone): ' + srcName); continue; }
    const dst = GmailApp.getUserLabelByName(dstName);
    if (!dst) { out.push('SKIP ' + srcName + ' — destination missing: ' + dstName); continue; }

    let movedHere = 0, safety = 0;
    while (true) {
      if (new Date().getTime() - startTime > MAX_RUNTIME) { out.push('TIME BUDGET HIT mid-' + srcName); break; }
      const threads = src.getThreads(0, 50);
      if (threads.length === 0) break;
      if (!apply) { out.push('WOULD MOVE ' + threads.length + '+ from ' + srcName + ' -> ' + dstName); break; }
      _safeCall(function () { dst.addToThreads(threads); return null; }, 'addToThreads ' + dstName, out);
      _safeCall(function () { src.removeFromThreads(threads); return null; }, 'removeFromThreads ' + srcName, out);
      moved += threads.length; movedHere += threads.length;
      if (++safety > 200) { out.push('safety stop on ' + srcName); break; }
    }
    if (apply) {
      out.push('MOVED ' + movedHere + ' from ' + srcName + ' -> ' + dstName);
      const remaining = src.getThreads(0, 1);
      if (remaining.length === 0) {
        _safeCall(function () { GmailApp.deleteLabel(src); return null; }, 'deleteLabel ' + srcName, out);
        out.push('deleted empty label: ' + srcName);
      } else {
        out.push('NOT deleting ' + srcName + ' — still has threads');
      }
    }
  }

  out.push('--- childless parents ---');
  for (let j = 0; j < _DRIFT_SHELLS.length; j++) {
    const name = _DRIFT_SHELLS[j];
    const label = GmailApp.getUserLabelByName(name);
    if (!label) { out.push('skip (already gone): ' + name); continue; }
    if (label.getThreads(0, 1).length > 0) { out.push('NOT deleting ' + name + ' — still has threads'); continue; }
    if (!apply) { out.push('WOULD DELETE empty: ' + name); continue; }
    _safeCall(function () { GmailApp.deleteLabel(label); return null; }, 'deleteLabel ' + name, out);
    out.push('deleted empty label: ' + name);
  }

  out.push('---');
  out.push((apply ? 'Moved: ' + moved : 'Dry-run only') + '. Re-run safe (idempotent).');
}



function _filterSig_(from, query) { return (from || '') + '||' + (query || ''); }

// Gmail's from: matching is substring-based and EVERY matching filter fires — there
// is no first-match-wins — so two spec entries that can match the same message will
// both label it. Detected statically before anything is written.
function _specAddresses_(sp) {
  if (sp.query) { return ['query::' + String(sp.query).toLowerCase()]; }
  return String(sp.from).toLowerCase().split(/\s+or\s+/)
    .map(function (t) { return t.trim(); })
    .filter(function (t) { return t.length > 0; });
}

// `spec` is injectable so this can be tested without the private data file.
function _specConflicts_(spec) {
  const list = spec || _FILTER_SPEC;
  const conflicts = {};
  const tokens = [];
  for (let i = 0; i < list.length; i++) {
    const sp = list[i];
    const tag = sp.label + ' (' + (sp.from || sp.query) + ')';
    _specAddresses_(sp).forEach(function (a) { tokens.push({ idx: i, tag: tag, addr: a }); });
  }
  for (let x = 0; x < tokens.length; x++) {
    for (let y = 0; y < tokens.length; y++) {
      const A = tokens[x], B = tokens[y];
      if (A.idx === B.idx) { continue; }
      const aIsQuery = A.addr.indexOf('query::') === 0, bIsQuery = B.addr.indexOf('query::') === 0;
      if ((aIsQuery || bIsQuery) && A.addr !== B.addr) { continue; }
      if (A.addr === B.addr) {
        conflicts['dup|' + A.addr] = 'duplicate criterion "' + A.addr + '" in ' + A.tag + ' AND ' + B.tag;
      } else if (B.addr.indexOf(A.addr) !== -1) {
        conflicts['sub|' + A.addr + '|' + B.addr] = '"' + A.addr + '" (' + A.tag +
          ') also substring-matches "' + B.addr + '" (' + B.tag + ') — both filters would fire';
      }
    }
  }
  return Object.keys(conflicts).map(function (k) { return conflicts[k]; });
}

// 'ok'     — matches spec exactly (extra removeLabelIds are allowed and preserved)
// 'repair' — empty action: orphaned when the reorg deleted its target, no user intent to keep
// 'manual' — someone edited this filter by hand; never overwritten without &force=1
function _classifyFilter_(prior, want, skipInbox) {
  const adds = (prior.action && prior.action.addLabelIds) || [];
  const rem = (prior.action && prior.action.removeLabelIds) || [];
  const inboxOk = skipInbox ? rem.indexOf('INBOX') !== -1 : rem.indexOf('INBOX') === -1;
  if (adds.length === 1 && adds[0] === want && inboxOk) { return 'ok'; }
  if (adds.length === 0) { return 'repair'; }
  return 'manual';
}

function rebuildFilters_(out, apply, force) {
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' Rebuild delivery filters (replaces deleted Apple Mail rules)' +
    (force ? '  [FORCE — will overwrite hand-edited filters]' : ''));
  out.push('---');

  const conflicts = _specConflicts_();
  if (conflicts.length) {
    out.push('SPEC CONFLICTS — ' + conflicts.length + ' found:');
    conflicts.forEach(function (c) { out.push('  !! ' + c); });
    if (apply) { out.push('ABORTING — refusing to write a spec that double-labels.'); return; }
    out.push('Fix _FILTER_SPEC before applying.');
  } else {
    out.push('spec conflict check: clean (' + _FILTER_SPEC.length + ' entries)');
  }
  out.push('---');

  const labelId = {};
  (Gmail.Users.Labels.list('me').labels || []).forEach(function (l) { labelId[l.name] = l.id; });

  const missing = _FILTER_SPEC.filter(function (sp) { return !labelId[sp.label]; });
  if (missing.length) {
    missing.forEach(function (sp) { out.push('ABORT — target label missing: ' + sp.label); });
    return;
  }

  const existing = Gmail.Users.Settings.Filters.list('me').filter || [];
  const bySig = {};
  existing.forEach(function (f) {
    const c = f.criteria || {};
    bySig[_filterSig_(c.from, c.query)] = f;
  });

  let created = 0, repaired = 0, ok = 0, skipped = 0;
  const touched = {};
  const failures = [];

  for (let i = 0; i < _FILTER_SPEC.length; i++) {
    const sp = _FILTER_SPEC[i];
    const want = labelId[sp.label];
    const prior = bySig[_filterSig_(sp.from, sp.query)];
    const desc = (sp.from ? 'from=' + sp.from : 'query=' + sp.query) + ' -> ' + sp.label +
      (sp.skipInbox ? ' [skip inbox]' : ' [keep in inbox]');

    // Carry over removeLabelIds this spec does not manage, so a repair never
    // silently drops settings configured outside _FILTER_SPEC.
    let carried = [];

    if (prior) {
      touched[prior.id] = true;
      const adds = (prior.action && prior.action.addLabelIds) || [];
      const rem = (prior.action && prior.action.removeLabelIds) || [];
      carried = rem.filter(function (id) { return id !== 'INBOX'; });
      const state = _classifyFilter_(prior, want, sp.skipInbox);

      if (state === 'ok') { out.push('OK      ' + desc); ok++; continue; }
      if (state === 'manual' && !force) {
        out.push('MANUAL  ' + desc);
        out.push('        hand-edited: add=[' + adds.join(',') + '] remove=[' + rem.join(',') +
          '] — left alone, re-run with &force=1 to overwrite');
        skipped++; continue;
      }
      if (!apply) {
        out.push((state === 'manual' ? 'OVERWRITE' : 'REPAIR  ') + ' ' + desc +
          '  (was add=[' + adds.join(',') + '] remove=[' + rem.join(',') + '])');
        repaired++; continue;
      }
      _safeCall(function () { Gmail.Users.Settings.Filters.remove('me', prior.id); return null; },
        'remove filter ' + prior.id, out);
    } else {
      if (!apply) { out.push('CREATE  ' + desc); created++; continue; }
    }

    // The Gmail filters API has no update method — Google documents delete-then-create,
    // so a repair is briefly filter-less. A create that fails after the delete is
    // reported as FAILED and listed under ACTION REQUIRED, never counted as success.
    const criteria = {};
    if (sp.from) { criteria.from = sp.from; }
    if (sp.query) { criteria.query = sp.query; }
    const removes = (sp.skipInbox ? ['INBOX'] : []).concat(carried);
    const action = { addLabelIds: [want] };
    if (removes.length) { action.removeLabelIds = removes; }

    let res = null, errMsg = null;
    try {
      res = Gmail.Users.Settings.Filters.create({ criteria: criteria, action: action }, 'me');
    } catch (err) {
      errMsg = (err && err.message) || String(err);
    }
    if (!res || !res.id) {
      out.push('FAILED  ' + desc + (prior ? '   *** prior filter was deleted — SENDER NOW UNFILED ***' : ''));
      failures.push(desc + (prior ? '  [prior filter deleted — sender unfiled]' : '') +
        '  — ' + (errMsg || 'create returned no id'));
      continue;
    }
    if (prior) { repaired++; } else { created++; }
    out.push((prior ? 'REPAIRED ' : 'CREATED  ') + desc + '  id=' + res.id +
      (carried.length ? '  (preserved remove=[' + carried.join(',') + '])' : ''));
  }

  out.push('--- superseded by a broader filter ---');
  for (let k = 0; k < _FILTER_SUPERSEDED.length; k++) {
    const sup = _FILTER_SUPERSEDED[k];
    const stale = bySig[_filterSig_(sup.from, sup.query)];
    const label = sup.from ? 'from=' + sup.from : 'query=' + sup.query;
    if (!stale) { out.push('skip (already gone): ' + label); continue; }
    touched[stale.id] = true;
    if (!apply) { out.push('WOULD DELETE ' + label + '  (' + stale.id + ')'); continue; }
    _safeCall(function () { Gmail.Users.Settings.Filters.remove('me', stale.id); return null; },
      'remove filter ' + stale.id, out);
    out.push('deleted superseded filter: ' + label);
  }

  out.push('--- filters left untouched (not in spec) ---');
  existing.forEach(function (f) {
    if (touched[f.id]) { return; }
    const c = f.criteria || {}, a = f.action || {};
    const adds = (a.addLabelIds || []).join(',');
    out.push('  ' + f.id + '  ' + (c.from ? 'from=' + c.from : 'query=' + (c.query || '(none)')) +
      '  add=[' + adds + ']' + (adds ? '' : '  <-- DEAD, no label applied'));
  });

  out.push('---');
  out.push((apply ? 'Created ' + created + ', repaired ' + repaired + ', already correct ' + ok
    : 'Dry-run: would create ' + created + ', repair ' + repaired + '; ' + ok + ' already correct') +
    (skipped ? ', ' + skipped + ' hand-edited SKIPPED' : '') +
    '. Re-run safe (idempotent).');

  if (failures.length) {
    out.push('');
    out.push('*** ACTION REQUIRED — ' + failures.length + ' filter(s) failed to write ***');
    failures.forEach(function (f) { out.push('  ' + f); });
    out.push('Re-run to retry; any sender marked "unfiled" has no delivery filter right now.');
  }
}


function linkedinNoiseBackfill_(out, apply) {
  out.push((apply ? 'APPLY' : 'DRY-RUN') + ' LinkedIn noise: ' + _LINKEDIN_NOISE_SRC + ' -> ' + _LINKEDIN_NOISE_DST);
  const jobs = GmailApp.getUserLabelByName(_LINKEDIN_NOISE_SRC);
  const misc = GmailApp.getUserLabelByName(_LINKEDIN_NOISE_DST);
  if (!jobs || !misc) { out.push('ABORT — ' + _LINKEDIN_NOISE_SRC + ' or ' + _LINKEDIN_NOISE_DST + ' missing'); return; }
  let moved = 0, safety = 0;
  while (true) {
    const threads = GmailApp.search(_LINKEDIN_NOISE_Q, 0, 50);
    if (threads.length === 0) break;
    if (!apply) { out.push('WOULD MOVE ' + threads.length + '+ threads'); break; }
    _safeCall(function () { misc.addToThreads(threads); return null; }, 'addToThreads Misc', out);
    _safeCall(function () { jobs.removeFromThreads(threads); return null; }, 'removeFromThreads ' + _LINKEDIN_NOISE_SRC, out);
    moved += threads.length;
    if (++safety > 50) { out.push('safety stop'); break; }
  }
  out.push((apply ? 'Moved ' + moved : 'Dry-run only') + '. Re-run safe (idempotent).');
}

function doGet(e) {
  const out = [];
  const fn = (e && e.parameter && e.parameter.fn) || 'overlaps';
  const apply = !!(e && e.parameter && e.parameter.apply === '1');
  try {
    if (fn === 'overlaps') {
      reportCrossCategoryOverlaps_(out);
    } else if (fn === 'cleanup') {
      preReorgCleanup_(out, apply);
    } else if (fn === 'counts') {
      finalCounts_(out);
    } else if (fn === 'diagnose') {
      diagnoseOrphans_(out);
    } else if (fn === 'passA') {
      passA_(out, apply);
    } else if (fn === 'passB') {
      passB_(out, apply);
    } else if (fn === 'passC') {
      passC_(out, apply);
    } else if (fn === 'inspect') {
      const cat = (e && e.parameter && e.parameter.cat) || 'updates';
      inspectCategory_(out, cat);
    } else if (fn === 'recover') {
      recoverFromTrash_(out, apply);
    } else if (fn === 'passD') {
      passD_(out, apply);
    } else if (fn === 'passE') {
      passE_misc_(out, apply);
    } else if (fn === 'passFtrash') {
      passF_trashPolitical_(out, apply);
    } else if (fn === 'inbox') {
      passInbox_(out, apply);
    } else if (fn === 'flattenReading') {
      flattenReading_(out, apply);
    } else if (fn === 'productbc') {
      consolidateProductBC_(out, apply);
    } else if (fn === 'miscbreak') {
      miscBreakdown_(out);
    } else if (fn === 'miscextract') {
      miscExtract_(out, apply);
    } else if (fn === 'backup') {
      backup_(out);
    } else if (fn === 'consolidate') {
      consolidate_(out, apply);
    } else if (fn === 'cleanupparents') {
      cleanupOldParents_(out, apply);
    } else if (fn === 'driftmerge') {
      mergeDrift_(out, apply);
    } else if (fn === 'linkedinnoise') {
      linkedinNoiseBackfill_(out, apply);
    } else if (fn === 'nutrilawn') {
      consolidateNutriLawn_(out, apply);
    } else if (fn === 'selftest') {
      const r = runAllTests();
      out.push('Tests: ' + r.passed + ' passed, ' + r.failed + ' failed');
      r.errors.forEach(function (err) { out.push('  FAIL ' + err.test + ': ' + err.error); });
    } else if (fn === 'listfilters') {
      listFilters_(out);
    } else if (fn === 'rebuildfilters') {
      rebuildFilters_(out, apply, !!(e && e.parameter && e.parameter.force === '1'));
    } else if (fn === 'inboxtriage') {
      inboxTriage_(out, apply);
    } else if (fn === 'passF') {
      passF_(out, apply);
    } else if (fn === 'passFreset') {
      PropertiesService.getScriptProperties().deleteProperty('passF_offset');
      out.push('passF_offset checkpoint cleared');
    } else if (fn === 'inspectSenders') {
      const dom = (e && e.parameter && e.parameter.domain) || 'gmail.com';
      inspectSenders_(out, dom);
    } else {
      out.push('Unknown fn: ' + fn);
    }
  } catch (err) {
    out.push('ERROR: ' + err.message);
    out.push(err.stack || '');
  }
  return ContentService.createTextOutput(out.join('\n')).setMimeType(ContentService.MimeType.TEXT);
}

// ---- Read-only: dump every Gmail filter, resolving label IDs to names ----
// Flags filters whose destination is an old-tree label (any name not in the
// final plan) or a label that no longer exists. Needs gmail.settings.basic —
// if curl says "do not have permission", run listFiltersNow() from the editor.
function listFilters_(out) {
  const labelName = {};
  (Gmail.Users.Labels.list('me').labels || []).forEach(function (l) { labelName[l.id] = l.name; });
  const PLAN = _PLAN_LABELS;

  const all = Gmail.Users.Settings.Filters.list('me').filter || [];
  out.push('Total filters: ' + all.length);
  out.push('---');

  const suspect = [];
  all.forEach(function (f) {
    const c = f.criteria || {}, a = f.action || {};
    const crit = ['from', 'to', 'subject', 'query', 'negatedQuery', 'hasAttachment']
      .filter(function (k) { return c[k]; })
      .map(function (k) { return k + '=' + c[k]; }).join(' ');
    const adds = (a.addLabelIds || []).map(function (id) {
      return labelName[id] ? labelName[id] : id + '(DELETED)';
    });
    const rem = (a.removeLabelIds || []).map(function (id) {
      return labelName[id] ? labelName[id] : id;
    });
    const bad = adds.filter(function (n) {
      return n.indexOf('(DELETED)') !== -1 ||
        (n !== 'TRASH' && n !== 'SPAM' && PLAN.indexOf(n) === -1);
    });
    out.push((bad.length ? '!! ' : '   ') + f.id);
    out.push('      criteria: ' + (crit || '(none)'));
    out.push('      add: [' + adds.join(', ') + ']' + (rem.length ? '  remove: [' + rem.join(', ') + ']' : ''));
    if (bad.length) { suspect.push({ id: f.id, crit: crit, bad: bad }); }
  });

  out.push('---');
  out.push('Filters targeting off-plan or deleted labels: ' + suspect.length);
  suspect.forEach(function (s) {
    out.push('  ' + s.id + '  ' + s.crit + '  ->  ' + s.bad.join(', '));
  });
}

// Fallback when the deployed web-app token lacks gmail.settings.basic:
// run this from the Apps Script editor (Run) and read the execution log.
function listFiltersNow() {
  const out = [];
  listFilters_(out);
  const log = out.join('\n');
  Logger.log(log);
  return log;
}
