# Clerk evidence per intake line — the shape the price screen reads

The price-and-send screen (P12) shows Ben, under every line, the customer's own words the line
came from and the photos that arrived with them. Today it INFERS both from keyword overlap between
the line's title + notes and the thread (`server/spine/price-brief.ts` `evidenceForLines`). That is
good on Sarah's and Gemma's threads and wrong whenever a line is only in a photo, or two lines share
every word. The proper fix is the Quote clerk recording, on each intake line, which messages it
read the line from. The screen already reads this shape when it is present (P12b) and falls back
to inference when it is not.

## Shape (additive, on each entry of the intake artifact's `lines[]` and of `pricing_line_items[]`)

```ts
interface IntakeLineEvidence {
    /** The customer's messages this line was scoped from. Order = strength. At most three. */
    evidence?: Array<{
        messageId: string;   // messages.id of an INBOUND message on the thread
        text: string;        // the sentence (or clause) of that message the line rests on, verbatim, ≤ 180 chars
    }>;
    /** Inbound media (messages.id of the photo / video rows) that show this line's work. */
    mediaIds?: string[];
}
```

Rules for the clerk:
- `messageId` must be an inbound message id from the case file's timeline (`TimelineItem` has no id
  today; the case-file pane adds `messageId` on `TimelineItem` first, or the clerk cites the
  `mediaIds` it already receives and the text it quotes).
- `text` is the customer's words, not a paraphrase. Empty `evidence` is allowed (a line from a
  photo alone); then `mediaIds` should carry the photo.
- One message may back several lines; the screen shows it under each.

## What the screen does with it
- `evidence[]` present → those quotes, in that order, with the message time from the thread;
  `basedOnInboundId` = the first cited message. No inference for that line.
- `mediaIds[]` present → those photos / videos under the line (resolved to the thread's media
  URLs); nothing inferred from timing.
- Neither present → inference as today.

`createPricedDraft` (`server/spine/quote-intake.ts`) should copy `evidence` and `mediaIds` from
the intake line onto the matching `pricing_line_items[]` entry when the clerk starts writing them;
the screen reads `pricing_line_items[].evidence` / `.mediaIds`.
