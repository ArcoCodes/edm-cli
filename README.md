# edm-cli

Agent-friendly command-line tool for the EDM campaign app. Talks to the already-deployed server at `https://optimal-dodo-5009.edgespark.app` over its existing `/api/*` routes — no changes to that server/web app.

See [`SKILL.md`](./SKILL.md) for the full command reference.

## Install

```bash
npm install
npm link   # exposes the `edm-cli` command globally
```

## Usage

```bash
edm-cli login       # one-time interactive login, caches a session cookie
edm-cli whoami
edm-cli campaign list
```

## Development

```bash
npm test        # runs the unit test suite (node:test via tsx)
npm run typecheck
```
