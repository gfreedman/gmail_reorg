/**
 * Stand-ins for the git-ignored _private_data.gs, used when it is absent.
 *
 * The production code deliberately does NOT tolerate a missing configuration
 * (it must raise rather than degrade into an empty run), so the stubs live
 * here, in the test tooling, instead of in the shipped code. Every suite under
 * test injects its own fixtures, so the values are never read; they exist only
 * so the sources load and so the static check sees every name defined.
 */
module.exports = [
  'const _FILTER_SPEC = [];',
  'const _FILTER_SUPERSEDED = [];',
  'const _MISC_TO = [];',
  'const _PASS_B_RULES = [];',
  'const _PASS_C_LABEL_RULES = [];',
  'const _PASS_D_LABEL_RULES = [];',
  'const _PASS_F_RULES = [];',
  'const _SPAM_TOOL_LABELS = {};',
  'const _SPAM_SUSPECT_LABELS = {};',
  'const _PLAN_LABELS = [];'
].join('\n');
