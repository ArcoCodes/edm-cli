# edm-cli

Agent-friendly CLI for the EDM campaign tool at `https://optimal-dodo-5009.edgespark.app`. Use this instead of asking the user to drive the web UI when you need to create a campaign, set its content, choose recipients, send it, or inspect send history.

Every command supports `--json` (put it right after `edm-cli`, before the subcommand: `edm-cli --json campaign list`) for structured output. Without it, output is short human-readable lines.

## Setup (one-time, human does this)

```
edm-cli login
```
Prompts for email + password interactively (password is masked, never stored). The session cookie is cached at `~/.edm-cli/session.json` (mode 600) and reused by every other command. An agent should never run `login` on the user's behalf or ask the user to paste a password into chat — tell the user to run it themselves in their own terminal.

`edm-cli whoami` confirms the session is valid and shows `canSend` (whether this account is allowed to actually send campaigns).

## Safety rule

`campaign send`, `campaign resend-failed`, and `campaign delete` have real, irreversible effects (real emails to real people; permanent deletion). They prompt for interactive `y/N` confirmation by default. Pass `--yes` to skip the prompt **only** when the user has explicitly asked for that action in this turn — never add `--yes` on your own initiative to "save a round trip."

## Commands

```
edm-cli login
edm-cli logout
edm-cli whoami [--json]

edm-cli campaign create --name <n> --subject <s> [--description <d>]
                         [--content-type html|text]        # default html
                         --file <path>                      # HTML or text body
                         [--recipients all|active|plan_starter|plan_standard|plan_advanced|manual]
                         [--days N]                         # only with --recipients active (default 30)
                         [--emails a@b.com,c@d.com]          # only with --recipients manual
                         [--test]
                         [--json]

edm-cli campaign set-html <id> --file <path.html>
edm-cli campaign set-text <id> --file <path.txt>
edm-cli campaign set-recipients <id> --recipients <type> [--days N] [--emails ...]
edm-cli campaign update <id> [--name <n>] [--subject <s>] [--description <d>]

edm-cli campaign list [--status draft|sending|completed|failed|pending] [--limit N] [--offset N] [--json]
edm-cli campaign get <id> [--full] [--json]        # --full includes raw htmlContent/textContent
edm-cli campaign logs <id> [--status pending|sent|failed] [--email <e>] [--limit N] [--offset N] [--json]
edm-cli campaign preview-recipients --recipients <type> [--days N] [--emails ...] [--json]

edm-cli campaign send <id> [--yes]
edm-cli campaign resend-failed <id> [--yes]
edm-cli campaign delete <id> [--yes]
```

## Typical flow

```
edm-cli campaign create --name "July newsletter" --subject "What's new in July" \
  --file ./newsletter.html --recipients active --days 30
# -> prints the new campaign id, e.g. Created campaign 3f2a...

edm-cli campaign preview-recipients --recipients active --days 30
# -> sanity-check the recipient count before sending

edm-cli campaign send 3f2a... --yes   # only after the user has explicitly asked to send
```

## `--json` output shapes

- `whoami`: `{ email, isSuperAdmin, canSend }`
- `campaign create/update/set-html/set-text/set-recipients/get`: `{ ...Campaign }` (id, name, subject, status, contentType, htmlContent, textContent, recipientFilter (JSON string), sentCount, failedCount, totalRecipients, etc.)
- `campaign list`: `[ ...Campaign ]`
- `campaign logs`: `[ { id, campaignId, recipientEmail, status, error, ... } ]`
- `campaign preview-recipients`: `{ count }`
- `campaign send`: final chunk result `{ done, completed, generation, sentCount, failedCount, totalRecipients, error? }`
- `campaign resend-failed`: `{ status }`

## Errors

Non-zero exit code on any failure. The error message printed to stderr is the server's own message where available (e.g. `Campaign not found`, `Cannot edit while sending`, `Sending is not enabled for your account`). A `401`/session error means the cached session expired — tell the user to run `edm-cli login` again.
