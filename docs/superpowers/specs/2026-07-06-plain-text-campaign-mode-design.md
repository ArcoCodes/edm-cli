# Plain-text campaign mode

## Problem

EDM campaigns currently only support HTML content. Some campaigns are better sent as plain text (no design, no images) but the editor forces an HTML editor + live preview even when that's not needed.

## Goals

- Let a campaign be authored as either HTML (existing behavior) or plain text.
- A button near the existing image/placeholder controls lets the user pick the mode.
- Plain-text mode has no live preview, no image insertion, no placeholder-replace control.
- Switching between HTML and Text mode in the editor does not lose either version's content.
- Plain-text sends do not attempt open/click tracking (no pixel, no link rewriting) since that requires HTML.

## Non-goals

- No placeholder/variable substitution in plain text (e.g. recipient name).
- No image support in plain text.
- No automatic HTML→text or text→HTML conversion when switching modes.

## Data model

Add two columns to `campaigns` (migration alongside existing `drizzle/000x_*.sql` files):

- `content_type` text NOT NULL DEFAULT `'html'` — `'html' | 'text'`
- `text_content` text — nullable, holds the plain-text body when authored

`html_content` is unchanged and keeps holding the HTML body regardless of which mode is currently active. Both fields persist independently; toggling the mode in the UI just changes which field is edited/displayed and which field is used at send time.

## API / DTOs

`packages/edm-worker/server/src/dtos/campaigns.ts`:
- `createCampaignDTO` / `updateCampaignDTO` gain:
  - `contentType: z.enum(['html', 'text']).default('html')`
  - `textContent: z.string().optional()`
  - `htmlContent` becomes optional (currently required) since a pure-text campaign may never populate it.
- Service layer (`services/campaigns.ts`) validates that the content field matching the active `contentType` is non-empty before allowing save-as-non-draft actions that require content (send). Draft saves can be lenient (matches today's "Save Draft" not requiring subject/name to be non-empty via UI, but content is already required today — keep requiring non-empty content for whichever mode is active on every save, consistent with current `min(1)` behavior).

`web/src/lib/api.ts`:
- `Campaign` interface gains `contentType: 'html' | 'text'` and `textContent: string | null`.
- `createCampaign`/`updateCampaign` payload types include `contentType` and `textContent`.

## Editor UI (`campaign-edit.tsx`)

- New state: `contentType` (`'html' | 'text'`, loaded from campaign or defaults to `'html'` for new campaigns), `textContent`.
- Toggle control (simple two-option button group or `<select>`) placed where "Replace Placeholder" currently sits, to the left of the image/placeholder controls.
- When `contentType === 'html'`: current layout/behavior unchanged exactly (CodeMirror `HtmlEditor`, Preview pane, Replace Placeholder select, Insert Image button all shown).
- When `contentType === 'text'`:
  - "Replace Placeholder" select and "Insert Image" button (and its popover) are not rendered.
  - The content column uses a plain `<textarea>` (new `PlainTextEditor` component, styled consistent with `HtmlEditor`'s container) bound to `textContent`.
  - The Preview column is not rendered; the editor's grid becomes a single full-width column instead of the 2-col HTML/Preview split.
- The panel label ("HTML") reflects the active mode (e.g. "HTML" vs "Text").
- Editor lock behavior for already-sent campaigns (`hasSent`) is unchanged — whatever currently prevents/allows edits after send applies equally to the mode toggle; no special-casing added.

## Sending (`server/src/services/sender.ts`, `server/src/lib/resend.ts`)

- `executeSendBatches` branches on `campaign.contentType`:
  - `'html'` (current path, unchanged): `injectPreheader` → `injectTrackingPixel` → `wrapLinksWithTracking` on `htmlContent`, sent as `html` with Resend auto-deriving `text` via `htmlToPlainText`.
  - `'text'`: no preheader/pixel/link injection. The raw `textContent` is sent as `text` with no `html` field at all. Resend's `sendBatch` needs to accept an email shape without `html` (add `text?`/`html?` as alternative fields; require exactly one of the two per email).
- Since plain-text sends have no tracking pixel/links, `openedCount`/`clickedCount` naturally stay at 0 for those campaigns — no schema change needed there, just an expected outcome of not injecting tracking.

## Migration

New `drizzle/000X_*.sql` (next sequence number after `0002_damp_hannibal_king.sql`):

```sql
ALTER TABLE `campaigns` ADD `content_type` text DEFAULT 'html' NOT NULL;--> statement-breakpoint
ALTER TABLE `campaigns` ADD `text_content` text;
```

Existing rows default to `content_type = 'html'`, preserving current behavior for all existing campaigns.

## Testing

- Create HTML campaign: verify unchanged behavior (editor, preview, image insert, placeholder select, send with tracking).
- Create text campaign: verify toggle hides HTML-only controls and preview, textarea works, save persists `textContent`, send delivers plain text with no `html` field and no tracking artifacts.
- Toggle HTML → Text → HTML on the same campaign: verify neither `htmlContent` nor `textContent` is lost.
- Send a text campaign and confirm `openedCount`/`clickedCount` stay at 0 (no tracking attempted).
