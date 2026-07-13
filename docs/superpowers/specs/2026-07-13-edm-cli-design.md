# EDM CLI (agent-friendly campaign tool)

## Problem

The EDM campaign tool only has a browser UI. An agent (or a human scripting things) has no way to create a campaign, set its HTML, pick recipients, or trigger a send without a browser session. We want a CLI that covers the core workflow — create campaign, write HTML content, select recipients, send, view history — while leaving the existing server/web app completely untouched.

## Non-goals

- No changes to `server/` or `web/` code, routes, DTOs, or DB schema.
- No image upload / management (web UI only).
- No admin / send-permission management (web UI only, `/admin` page).
- No local-dev-server support — targets the deployed production URL only (`https://optimal-dodo-5009.edgespark.app`, fixed default, not configurable via flag in v1).
- No password persistence — only the session cookie is cached locally.

## Structure

Standalone repo/project at `/Users/l13/Desktop/edm-cli` (separate from the `edm` monorepo that holds `server/` and `web/` — no shared files, no dependency between the two repos).

- Plain Node + TypeScript, run via `tsx` (no build step), exposed as a `bin` (`edm-cli`) via `npm link` or `npx tsx src/index.ts`.
- `commander` for subcommands/flags.
- Hand-rolled `fetch`-based HTTP client — no heavy SDK. It talks to the exact same `/api/campaigns/*`, `/api/campaigns/*/send*`, `/api/me` routes the web frontend already uses (mirrors the contract in the `edm` repo's `web/src/lib/api.ts`, referenced there for consistency but not imported).
- Session cookie cached at `~/.edm-cli/session.json`, file mode `600`.
- `SKILL.md` at the repo root — a reference doc for agents (this repo's Claude Code session or any other agent) describing every command, flags, auth flow, and safety rules, so an agent can drive the tool correctly without re-deriving this design.

## Auth

The deployed app gates all of `/api/*` behind a session cookie (enforced by the EdgeSpark platform edge, not app code — see `server/src/index.ts`'s `/api/campaigns/*` allowlist middleware, which only runs *after* the platform has already confirmed a session exists). There is no API-key/bearer-token path in this app, and one won't be added — this project previously removed a hardcoded-secret debug backdoor specifically for the security risk it posed (see `HANDOFF.md`), so a new shared-secret route is off the table.

Instead, the CLI performs the same login the browser does. The web bundle confirms the mechanism: `@edgespark/web` wraps Better Auth's client with `basePath: "/api/_es/auth"`, and `signIn.email(...)` POSTs to `{origin}/api/_es/auth/sign-in/email` with `credentials: "include"`, receiving a `Set-Cookie` session cookie back.

- `edm-cli login` — prompts for email, then a hidden password prompt (never echoed, never written to disk). POSTs to the same `/api/_es/auth/sign-in/email` endpoint. Captures the response's `Set-Cookie` header(s) and writes them to `~/.edm-cli/session.json`.
- Every other command reads that cached cookie and attaches it as a `Cookie:` header on requests to the production origin.
- On a 401 / `UNAUTHENTICATED` response, the CLI prints `Session expired or invalid — run "edm-cli login" again.` and exits non-zero. No silent re-auth, no stored password to retry with.
- `edm-cli whoami` — calls `GET /api/me`, prints `{ email, isSuperAdmin, canSend }`. Useful for an agent to confirm its session and send permission before doing anything else.
- `edm-cli logout` — deletes the cached session file.

This reuses the server's existing `ADMIN_EMAILS` allowlist and `canSend` permission checks as-is — the CLI is just another authenticated client, identical in privilege to a browser session for the same account.

**Implementation risk flagged:** the exact request/response shape of `/api/_es/auth/sign-in/email` (body field names, cookie name(s), whether it needs extra headers) is inferred from the minified `@edgespark/web` bundle, not from first-hand testing. The first implementation step should be a small standalone spike — log in via curl/a throwaway script with a real account and confirm the cookie round-trip — before building the rest of the CLI on top of it.

## Commands

All commands support `--json` for structured output (default is a compact human-readable summary). Destructive/irreversible commands (`send`, `resend-failed`, `delete`) require either an interactive `y/N` confirmation or an explicit `--yes` flag for non-interactive/agent use.

```
edm-cli login
edm-cli logout
edm-cli whoami

edm-cli campaign create --name <n> --subject <s> [--description <d>]
                         [--content-type html|text]      # default html
                         --file <path>                   # html or text body, per content-type
                         [--recipients all|active|plan_starter|plan_standard|plan_advanced|manual]
                         [--days N]                       # only with --recipients active
                         [--emails a@b.com,c@d.com]        # only with --recipients manual
                         [--test]

edm-cli campaign set-html <id> --file <path.html>
edm-cli campaign set-text <id> --file <path.txt>
edm-cli campaign set-recipients <id> --recipients ... [--days N] [--emails ...]
edm-cli campaign update <id> [--name <n>] [--subject <s>] [--description <d>]

edm-cli campaign list [--status draft|sending|completed|failed|pending] [--limit N] [--offset N]
edm-cli campaign get <id> [--full]        # --full includes raw htmlContent/textContent
edm-cli campaign logs <id> [--status pending|sent|failed] [--email <e>] [--limit N] [--offset N]
edm-cli campaign preview-recipients --recipients ... [--days N] [--emails ...]

edm-cli campaign send <id> [--yes]
edm-cli campaign resend-failed <id> [--yes]
edm-cli campaign delete <id> [--yes]
```

These map directly onto the existing routes in `server/src/routes/campaigns.ts` and `server/src/routes/send.ts` — `create`/`update`/`set-html`/`set-text`/`set-recipients` all go through `POST /api/campaigns` and `PUT /api/campaigns/:id` (the update DTO already supports partial updates), `list`/`get`/`logs`/`preview-recipients` are plain `GET`s, `send`/`resend-failed`/`delete` map 1:1 to their routes.

## Send behavior

The server does not drive sends to completion on its own — the caller (today, a browser tab) must repeatedly call a "process one chunk" endpoint until done. This is a deliberate, hard-won constraint documented in `HANDOFF.md`: self-invoking fetch loops inside the Worker are unreliable on this platform (`HTTP 522`), so the loop was moved to the client side. `edm-cli campaign send` becomes another such client:

1. Fetches the recipient count via preview, prints it, and asks for confirmation (`This will send real emails to N recipients. Continue? [y/N]`) unless `--yes`.
2. `POST /:id/send` to get a `generation` and process the first chunk.
3. Loop `POST /:id/send/continue` with `{ offset: 0, generation }` (the same idempotent contract the browser uses — `continueSend` re-derives the real offset server-side from `send_logs`) until the response has `done: true`. Print one progress line per chunk (`sent X / failed Y / total Z`).
4. Exit 0 if `completed: true`; otherwise print the server's `error` and exit non-zero (e.g. `"Campaign is already sending"` if a browser tab or another CLI invocation currently holds the active chain).
5. If the CLI process dies mid-send, nothing is lost — rerunning `edm-cli campaign send <id>` is exactly equivalent to clicking "Send" again in the web UI; it resumes from `send_logs`, gated by the same 2-minute stale-chain check.

`resend-failed` is a single request (`startResendFailed` runs synchronously server-side for the — typically small — set of failed recipients), so no chunk loop is needed there.

## Error handling

- Network/HTTP errors and non-2xx API responses print the server's `error` message (already a clean string on every route) and exit non-zero — no swallowing, no retries beyond what's inherent to the send loop.
- Validation errors (e.g. missing `--file` for `create` with `--content-type html`) are caught client-side before any request, mirroring the server DTOs' constraints so an agent gets a fast, clear failure instead of a 400 round-trip.

## `SKILL.md`

A Claude-Code-skill-shaped reference doc (plain markdown, not necessarily wired into `.claude/skills/` — lives at the repo root) covering:

- What this tool is for and when to use it vs. the web UI.
- Full command reference (mirrors the section above) with example invocations.
- The auth flow (`login` once interactively, cached session reused after).
- The safety rule: `send`/`resend-failed`/`delete` need explicit human-confirmed `--yes` — an agent must not pass `--yes` on its own initiative without the user having asked for the send.
- `--json` output shapes for each command, so an agent can parse results reliably.
