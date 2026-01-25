# Contributing to Gmail Reorganization Library

Thank you for your interest in contributing! This project helps people organize their Gmail inbox chaos.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
- [Development Guidelines](#development-guidelines)
- [Privacy Guidelines](#privacy-guidelines)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Never share personal data in issues or PRs

## Getting Started

### Prerequisites

- Google Account with Gmail
- Access to [Google Apps Script](https://script.google.com)
- Basic JavaScript knowledge
- Git for version control

### Setting Up Development Environment

1. Fork this repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/gmail-reorganization.git
   ```
3. Create a new Apps Script project for testing
4. Copy the `.gs` files to your test project

### Optional: Using clasp (CLI)

For a better development experience, you can use [clasp](https://github.com/google/clasp):

```bash
npm install -g @google/clasp
clasp login
clasp create --title "Gmail Reorg Dev"
clasp push
```

## How to Contribute

### Reporting Issues

Before creating an issue:
1. Search existing issues to avoid duplicates
2. Use the appropriate issue template
3. **Never include personal data** (label names, emails, etc.)

Include:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Apps Script execution logs (sanitized)

### Suggesting Features

We welcome feature suggestions! Please:
1. Check if it's already been suggested
2. Explain the use case clearly
3. Consider implementation complexity

### Submitting Code

1. Fork the repository
2. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. Make your changes
4. Test thoroughly
5. Submit a Pull Request

## Development Guidelines

### Code Style

#### Naming Conventions
```javascript
// Functions: camelCase, verb-first
function createBackup() { }
function validateLabelName() { }

// Variables: camelCase
var labelData = [];
var threadCount = 0;

// Constants: UPPER_SNAKE_CASE
var MAX_RUNTIME_MS = 300000;
var BATCH_SIZE = 100;
```

#### Function Documentation
```javascript
/**
 * Brief description of what the function does
 *
 * @param {string} labelName - Description of parameter
 * @param {boolean} [optional] - Optional parameters in brackets
 * @return {Object} Description of return value
 */
function exampleFunction(labelName, optional) {
  // Implementation
}
```

#### Error Handling
```javascript
// Good: Specific error handling with logging
try {
  var label = GmailApp.createLabel(name);
  log('Created: ' + name);
} catch (e) {
  logError('Failed to create "' + name + '": ' + e.message);
  // Handle or propagate appropriately
}

// Bad: Silent failures
try {
  var label = GmailApp.createLabel(name);
} catch (e) {
  // Never silently ignore errors
}
```

### Architecture Guidelines

#### File Organization
- `utils.gs` - Core utilities (load order: first)
- `backup.gs` - Backup functionality
- `analysis.gs` - Label analysis
- `reorganization.gs` - Migration execution
- `examples.gs` - Example scripts

#### Shared Functions
All shared functions should be in `utils.gs`. Never duplicate functions across files.

#### State Management
Use `PropertiesService.getScriptProperties()` for:
- Migration progress
- Statistics
- User preferences

### Google Apps Script Best Practices

1. **Respect execution limits**
   - 6-minute max execution time
   - Implement batch processing
   - Save state for resume capability

2. **Minimize API calls**
   ```javascript
   // Good: Batch operations
   label.addToThreads(threadBatch);

   // Bad: Individual operations
   for (var i = 0; i < threads.length; i++) {
     label.addToThread(threads[i]); // Too many API calls
   }
   ```

3. **Use appropriate logging**
   ```javascript
   log('Info message');      // Normal operations
   logWarning('Warning');    // Potential issues
   logError('Error');        // Failures
   ```

## Privacy Guidelines

### CRITICAL: Never Commit Personal Information

**Do NOT commit:**
- Actual Gmail label names
- Email addresses
- Thread IDs or message content
- Spreadsheet URLs
- Any personally identifiable information

**Use generic examples:**
```javascript
// Good
{from: 'OldLabel/Project', to: 'Work/Projects'}

// Bad - contains personal info
{from: 'John Smith/2023 Tax Return', to: 'Finance/Taxes'}
```

### Before Every Commit

Run through this checklist:
- [ ] No personal label names
- [ ] No email addresses
- [ ] No specific project/company names
- [ ] No URLs to personal resources
- [ ] Examples use generic placeholders

## Testing

### Manual Testing Checklist

Before submitting a PR:

1. **Dry Run Mode**
   - [ ] All functions work with `DRY_RUN: true`
   - [ ] Correct output in logs

2. **Validation**
   - [ ] `validatePlan()` catches errors appropriately
   - [ ] Warnings are helpful and accurate

3. **Edge Cases**
   - [ ] Empty labels handled correctly
   - [ ] Non-existent labels handled gracefully
   - [ ] Special characters in label names
   - [ ] Very long label names

4. **Performance**
   - [ ] Works with small label sets (<10 labels)
   - [ ] Works with medium sets (50-100 labels)
   - [ ] Handles timeout gracefully for large sets

5. **Resume Capability**
   - [ ] State saves correctly
   - [ ] Resume picks up where it left off
   - [ ] `resetMigrations()` clears state

### Test Scenarios

```javascript
// Test with various label structures
var testCases = [
  'SimpleLabel',
  'Parent/Child',
  'Deep/Nested/Label/Name',
  'Label with spaces',
  'Label-with-dashes',
  'Label_with_underscores',
  'Label.with.dots'
];
```

## Submitting Changes

### Pull Request Process

1. **Update documentation** if adding features
2. **Add changelog entry** in CHANGELOG.md
3. **Use clear commit messages**:
   ```
   feat: Add support for nested label detection
   fix: Handle empty label names gracefully
   docs: Update README with new examples
   refactor: Centralize logging functions
   ```

4. **PR Description should include**:
   - What the change does
   - Why it's needed
   - How it was tested
   - Any breaking changes

### Review Process

1. Maintainer reviews code
2. Automated checks (if any) must pass
3. Changes requested → update and push
4. Approved → merged

### After Merge

- Delete your feature branch
- Pull latest main to your fork
- Celebrate! 🎉

## Questions?

- Open an issue with the "question" label
- Check existing issues and discussions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for helping make Gmail organization easier for everyone!
