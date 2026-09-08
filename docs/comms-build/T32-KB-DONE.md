# 3.4 — The knowledge base: admin page and seed (8 Sep 2026)

Build plan v2, week one, item 3.4. The captain's answer 11: answers about the business come from
the quote, the thread, a knowledge base and the CRM, and the knowledge base is what
**"Ben writes in the admin, seeded by us"**.

This PR builds the place he writes it, and puts a first draft in front of him. It is the store, the
page and the seed. **Nothing is wired into a reply path, a prompt, a guard or a policy pack** —
the search tool the Scoper will use is item 3.1, and a test fails if a later PR wires it in quietly.

---

## Why the shape

Item 3.2 will make a factual answer to a customer **be** an entry's approved words, chosen word for
word, not the model's paraphrase of them. That is the one rail standing between "unlock every reply
type" (answers 5 and 9) and an invented fact, because review s10 established that nothing in this
repository can check whether a claim about the business is true.

So an entry is not a hint to a model. It is the sentence that gets sent, and everything below
follows from that.

---

## What changed

| | |
|---|---|
| `migrations/20260908_kb_entries.sql` | The table. Additive, idempotent, one new table, no drop of anything but its own constraints. |
| `shared/schema.ts` | `kbEntries`, `KB_KINDS`, `KB_STATUSES`, `KbEntryRow`. |
| `server/spine/knowledge-base.ts` | The accessors and the write path. |
| `server/spine/knowledge-base-seed.ts` | The seed content, as data, so it is testable without a database. |
| `scripts/seed-knowledge-base.ts` | Writes the seed. Re-runnable; never overwrites a row Ben has touched. |
| `server/spine/routes.ts` | `GET/POST /api/spine/kb`, `PATCH /kb/:id`, `POST /kb/:id/{review,retire,unreview}`, behind the existing `requireAdmin`. |
| `client/src/hooks/useKnowledgeBase.ts` | The one query and the five writes. |
| `client/src/pages/admin/KnowledgeBasePage.tsx` | The page. |
| `client/src/App.tsx`, `SidebarLayout.tsx` | `/admin/knowledge`, and a sidebar item under DISPATCH CONSOLE whose badge is how many entries are still waiting for him. |
| `server/spine/knowledge-base.test.ts`, `knowledge-base-access.test.ts`, `client/…/KnowledgeBasePage.test.tsx` | 44 tests. |

### The entry

An entry holds: the question or topic; **the approved words**, which are what may be sent verbatim;
**banned words**, phrases that must never be used on that topic; a status; **who reviewed it and
when**; and a **stable, readable citation id** (`areas-covered`, not a uuid, so a run record reads
as English).

A row is also one of two `kind`s. An `answer` can be sent once reviewed. A **`question`** is an open
question addressed to Ben and can never be sent by anything, ever.

### Reviewed-only access

One accessor, `listReviewedEntries()`, plus `getReviewedEntry(id)` and `getFixedLine(kind)`. All
three return **reviewed answers with words in them and nothing else**. Reaching an unreviewed row
takes `adminListEveryEntryIncludingUnreviewed()`, which is deliberately awkward to type, admin-only,
and has exactly one caller outside its own module (the admin route). A source-level test fails if a
second one appears.

The rule is enforced three times over, deliberately:

1. **the SQL** filters on `status = 'reviewed' AND kind = 'answer'`;
2. **`sendableEntries()`** re-filters the rows in code, so a hand-written query that returns the
   wrong set still returns nothing sendable (the unit test proves this by handing the accessor rows
   its own WHERE would never have matched);
3. **the table's own CHECKs** make `status = 'reviewed'` impossible on a question, on a blank, or
   without a named reviewer and a timestamp. That is the rail that survives code nobody has written
   yet.

Editing the words of a reviewed entry drops it back to unreviewed. Ben reviewed the sentence, not
the row.

### The page — /admin/knowledge

Where he writes, edits, reviews and retires. Phone first, one column, plain words, no jargon and no
ids on screen. Two things are loud: **the status** ("In use" / "Not in use yet", in words, on every
card, next to when it was last reviewed and by whom) and **the action** ("Yes, use these words",
one tap, which records who and when).

The order he meets them in is the order of the work: his questions first, then the drafts waiting,
then what is already live, then what is retired.

### The seed — 18 rows, all unreviewed

Ten answers, four fixed lines, four questions. Kept short on purpose: review s29 finding 1.19 asked
for what he will actually read, not everything the repository says about the business.

**Answers** (unreviewed drafts, in his voice, from `brand-voice/whatsapp-comms.md`,
`docs/DECLINE_CRITERIA.md` as narrowed by T18, `scoper.core.md` and the quote page):
areas covered · how quoting works · deposit and payment · guarantee · insurance and who turns up ·
what we do not do · what happens on the day · how soon can you come · why we ask for a photo ·
the survey visit.

`how-soon-can-you-come` is seeded **empty on purpose**, with a note asking for his words: nothing in
the system knows the honest answer, and item 8.2 says the desk uses this entry until there are
enough finished jobs to compute a real lead time. It cannot be reviewed until he writes something.

**Fixed lines** (item 1.4 reads these through `getFixedLine`, which is why their ids are constants):
`fixed-line-gas`, `fixed-line-complaint`, `fixed-line-refund`, `fixed-line-trust`. Each is drafted to
admit nothing, promise no money and no date, and name nobody in the third person.

**The four questions.** The business's own website says four things the desk's rules forbid it from
saying. None of them is imported as a fact. Each is an open question naming what the website claims
and what the rules say:

| id | The website says | The desk's rules say |
|---|---|---|
| `question-is-the-quote-free` | "Quotes are free with no obligation" (`server/seo/render.ts:241`) | Visits are never free; a look round is a paid survey with the fee off the job |
| `question-call-out-charge` | "no call-out charge", in three places | The only visit we sell is a paid survey |
| `question-gas-safe-engineers` | "our Gas Safe registered engineers" (`server/seo/content/services.ts:539`) | Gas is the one thing we turn down; "Gas Safe" is a banned credential |
| `question-put-it-right-at-no-charge` | "we come back and put it right at no charge" (`services.ts:35`); the call scripts say 12 months | That line is on the do-not-say list: it appears twice in 10,267 real messages and neither was his |

A test asserts that no seeded **answer** asserts any of those four claims.

---

## What Ben does next

```bash
npx tsx scripts/_apply-migration.ts migrations/20260908_kb_entries.sql
npx tsx scripts/seed-knowledge-base.ts --dry-run    # see what it would write
npx tsx scripts/seed-knowledge-base.ts
```

Then open **/admin/knowledge**. Everything is "Not in use yet" until he taps the button on it. The
four amber cards are questions only he can settle; nothing is ever sent from one.

Re-running the seed is safe: a row that already exists is left exactly as it is.

---

## What was NOT verified here

No `.env` and no database on the build machine, so the following are unobserved and are the owner's
first check:

- the migration applying against the live database (it is checked as text, not as SQL Postgres ran);
- the table's CHECK constraints actually refusing a bad row — the tests prove the accessor and the
  predicate refuse it, and read the constraints out of the migration file, but nothing here ran
  Postgres;
- the seed script writing rows;
- the page rendering against the real API, and the sidebar badge counting.

The reviewed-only rule, the review recording who and when, the seed's shape, the contradictions
being questions, and the migration being additive are all covered by tests that run with no
database.
