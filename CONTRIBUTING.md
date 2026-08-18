# Contributing to WebRTC Signaling Server

Thank you for your interest in contributing! Please follow these guidelines.

## Code Style
- Use **camelCase** for variables, functions, and methods.
- Socket.IO event names must be in **kebab-case** (e.g., `create-room`, `join-room`).
- Environment variables: **UPPER_SNAKE_CASE**.
- Indentation: 2 spaces.
- Use `const` and `let`; avoid `var`.
- All comments and documentation must be in **English**.

## Documentation
- All public functions should have a **JSDoc** block describing parameters and return values.
- Add inline comments for non‑obvious logic.

## Commit Messages
- Use the imperative mood ("Add feature", not "Added feature").
- Start with a capital letter.
- Keep the first line under 72 characters.
- Reference issues if applicable.

## Testing
- Run `npm test` before submitting a pull request.
- Ensure all existing tests pass.

## Pull Requests
- Open a clear description of the changes.
- Link any related issues.
- Keep PRs focused on a single logical change.

## Security
- If you discover a vulnerability, please report it privately via email (see README).
- Do not open a public issue for security flaws.

Thank you for helping make this project better!