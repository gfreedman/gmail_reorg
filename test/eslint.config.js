/**
 * ESLint configuration for test/lint.js, which checks every .gs file joined
 * into one script, the way Apps Script sees them: one shared global scope.
 *
 * Only rules that catch real defects are on. Style is left to review.
 */
const APPS_SCRIPT_GLOBALS = [
  'CacheService', 'ContentService', 'DriveApp', 'Gmail', 'GmailApp', 'HtmlService',
  'LockService', 'Logger', 'PropertiesService', 'ScriptApp', 'Session', 'SpreadsheetApp',
  'Utilities'
];

const globals = {};
APPS_SCRIPT_GLOBALS.forEach(function(name)
{
  globals[name] = 'readonly';
});

module.exports = [
  {
    languageOptions: {ecmaVersion: 2020, sourceType: 'script', globals: globals},
    rules: {
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-const-assign': 'error',
      'no-unreachable': 'error',
      'no-self-assign': 'error',
      'no-unsafe-finally': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error'
    }
  }
];
