# Contributing

## Reporting Issues

- Search existing issues before opening a new one
- **Never include personal data** (label names, email addresses, thread IDs)
- Include sanitized Apps Script execution logs when relevant

## Submitting Code

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/name`
3. Test thoroughly (run `runAllTests()`)
4. Submit a Pull Request with a description of what, why, and how it was tested

## Code Style

- `const`/`let` — never `var`
- camelCase for functions and variables; `UPPER_SNAKE_CASE` for constants
- JSDoc on all public functions (`@param`, `@return`)
- Use `Object.keys()` rather than `for...in`
- Batch all Gmail API calls — never operate per-thread in a loop
- Allman brace style (opening brace on its own line)

## Privacy

Never commit personal Gmail data. Use generic placeholders in examples:

```javascript
// Good
{from: 'OldLabel/Project', to: 'Work/Projects'}

// Bad — contains personal info
{from: 'John Smith/2023 Tax Return', to: 'Finance/Taxes'}
```

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
