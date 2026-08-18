# Brand Voice

Four files define how Handy Services sounds. They are loaded fresh on every
GMB post generation (`server/gmb-posts/generator.ts`), so **editing these
files changes the next post — no deploy, no code change.**

| File | What it controls |
|---|---|
| `beliefs.md` | What we stand for — the convictions under the copy |
| `tone.md` | Register, sentence mechanics, warmth, endings |
| `vocabulary.md` | Words we use, canonical phrases, approved claims, bans |
| `humour.md` | The kind of funny we are, and where humour is off-limits |

## Refining the voice with real material

Drop raw source material into `sources/` (gitignored — it may contain
customer names and numbers, so it never gets committed):

- **WhatsApp**: export a chat (Chat → Export Chat → Without Media) and drop
  the `.txt` in. Your own messages are the gold — the customer side just
  gives context.
- **Instagram**: paste captions into a `.txt`/`.md` file, oldest to newest.
- Anything else in your real voice: emails you're proud of, review replies,
  job ads.

Then ask Claude to "refine the brand voice files from what's in
brand-voice/sources/" — it mines the material and updates the four files,
keeping the approved-claims discipline intact.

## Previewing the voice

```bash
npx tsx scripts/_gmb-post-preview.ts
```

Generates one sample GMB post per theme (no posting, no Google calls) so you
can judge the voice before anything goes live.
