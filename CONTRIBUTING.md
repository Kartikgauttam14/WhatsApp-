# Contributing to Techzolo WhatsApp CRM

Use the [README](README.md) to configure and run the application locally.
Keep changes focused on a clear problem and describe the resulting behavior
in your pull request.

## Development checks

Run the checks relevant to your changes before opening a pull request:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

When changing interface copy, update all four catalogues in `messages/`
and preserve translation keys, ICU placeholders, and rich-text tags.
Use **Techzolo WhatsApp CRM** as the product name in every language.

Keep existing API key prefixes, webhook headers, MCP environment variables,
and saved preference keys compatible with deployed integrations.
Do not modify migrations that have already been applied; add a new migration
for database changes.

## Bug reports

Report reproducible issues in the
[project issue tracker](https://github.com/Kartikgauttam14/WhatsApp-/issues).
Include the commit, steps to reproduce, expected behavior, and relevant logs.
Remove passwords, tokens, customer data, and other secrets from logs.

For security issues, follow [SECURITY.md](.github/SECURITY.md).

## License

Contributions use the project's MIT [LICENSE](LICENSE). Preserve original
copyright notices and attribution when modifying inherited code.
