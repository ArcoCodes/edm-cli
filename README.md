# edm-cli

Agent-friendly command-line tool for the EDM campaign app. Talks to the already-deployed server at `https://optimal-dodo-5009.edgespark.app` over its existing `/api/*` routes — no changes to that server/web app.

See [`SKILL.md`](./SKILL.md) for the full command reference.

## Install

### For an agent (Claude Code, Codex, or any shell-driven agent)

The repo is public on GitHub (not published to the npm registry), so install it straight from the git URL — one command, no cloning, no auth needed:

```bash
npm install -g git+https://github.com/ArcoCodes/edm-cli.git
```

This pulls the repo, installs its dependencies (`commander`, `tsx`), and symlinks the `edm-cli` bin globally — verified to work end-to-end. Re-run the same command to pick up updates (npm will refetch the `main` branch).

An agent should install once at the start of a session (or check `edm-cli --help` succeeds before assuming it's missing), then use the commands documented in [`SKILL.md`](./SKILL.md). Note that `edm-cli login` is interactive (masked password prompt) — an agent should ask the human running it to log in themselves rather than attempting it non-interactively; see the Safety rule in `SKILL.md`.

### For local development on this repo

```bash
git clone git@github.com:ArcoCodes/edm-cli.git
cd edm-cli
npm install
npm link   # exposes the `edm-cli` command globally, pointing at this working copy
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
