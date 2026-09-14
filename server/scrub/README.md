# server/scrub

Replacing every identifying value on a non-production database with synthetic data, so that a
screenshot, a transcript or a pull request built from that database exposes nobody.

The CLI is `scripts/scrub-database.ts`. This directory is the library behind it.

```bash
npx tsx scripts/scrub-database.ts --dry-run    # report what would change; write nothing
npx tsx scripts/scrub-database.ts --confirm    # do it
npx tsx scripts/scrub-database.ts --verify     # audit: does anything still look identifying?
npx tsx scripts/scrub-database.ts --url-env COMMS_V2_DATABASE_URL --confirm
```

The target is named by an environment variable (`DATABASE_URL` by default), never by a connection
string on the command line, because a command line reaches shell history and process listings.

## Why it exists

The no-mistakes pipeline drives the product live against a Neon branch and attaches sandbox
screenshots and transcripts to every pull request. That branch was a copy of production, so real
names, telephone numbers, addresses and message bodies were reaching GitHub. The captain's answer
on 11 September 2026 was one word: scrub.

## What it refuses

| Refusal | Why |
|---|---|
| A production connection string | `isProductionDatabaseUrl` in `server/worker-gate.ts`, the repository's existing production check. Nothing connects; the run stops before opening a socket. |
| No `--confirm` | The scrub rewrites the whole database. A second, explicit act is required. |
| A column the plan does not classify | See below. This is the rule that stops a column being forgotten. |
| More distinct telephone numbers than the reserved ranges hold | Rather than reuse a number for two people, it stops and asks for another Ofcom drama block. |

It also never prints, logs or returns a value it read or wrote. The report is table names, column
names and counts. The only exception is the database host, which `databaseHostOf` already exposes
for logs elsewhere in the repository, and which carries no credentials.

## How "identifying" was derived

Not from a list somebody remembered. The scrub reads `information_schema` on the target and asks
`plan.ts` about **every column that can hold text** — text, varchar, char, arrays of those, and
json/jsonb — and **refuses to run if one comes back unclassified**. On `shared/schema.ts` as of
14 September 2026 that is 1,103 columns across 117 tables, and `__tests__/plan.test.ts` holds the
same rule over that file without a database, so a new column fails the tests before it can fail a
scrub.

Postgres enum columns are excluded before that point, because an enum can only ever hold one of
its declared labels and so cannot hold a name.

Each classified column lands in exactly one of two places:

- **a treatment** — the value is rewritten to synthetic data of the same shape;
- **`keep`** — the value is left alone because its *purpose* is not personal: an enumeration, a
  foreign key, a price, a catalogue entry, a Meta-approved template.

`keep` is a statement about purpose, not a promise of cleanliness, so it is not the end of the
story. See "the sweep" below.

Adding a column to `shared/schema.ts` forces a decision in `plan.ts` before the next scrub can
run. That is the point: the classifier is the derivation, and it fails closed.

### What is deliberately kept, and why

- The **catalogue and site content** (`productized_services`, `service_catalog`,
  `materials_catalog`, the `content_*` tables, banners, landing pages, training modules): about
  the business, not about a customer.
- **Meta-approved WhatsApp templates** (`whatsapp_templates`): Meta fixes the wording, and the
  registry in `server/window-templates.ts` matches on it. Rewriting one would break sending.
- **The knowledge base** (`kb_entries`): Ben's own reviewed answers about his own business, which
  the comms-v2 scenarios read by exact wording.
- **Identifiers and foreign keys**: moving one would break referential integrity. A user id
  identifies a person only through the `users` row, and that row is scrubbed.

Testimonials and reviews are *not* kept: `content_testimonials`, `quote_platform_testimonials`,
`contractor_reviews` and `handyman_profiles.reviews` are real customers saying real things under
their own names, and they are treated as personal data.

The new comms desk's case files (`comms_v2_case_files`) keep a whole thread in one jsonb column,
`file`. Its leaves are classified by key through overrides scoped to that table: a party's name,
its `canonical` identity key and its channel addresses (a `contact`: a telephone number or an
e-mail address, prefix kept), turn bodies, sent bubbles, held drafts, release words, fact values,
the job's location and media paths are all rewritten. Ids, the stage, the ask ledger's subjects and
the desk's own hold reasons are kept, because the desk reads them back.

## The five passes

| Pass | What it does |
|---|---|
| 0 refuse | The gates above, including the unclassified-column check. |
| 1 collect | Read the real identifiers out of the classified columns, and the telephone numbers out of json leaves too; allocate one reserved telephone number per distinct real one. Held in memory for the run, written nowhere. |
| 2 rewrite | Table by table, replace the classified values. |
| 3 sweep | Go back over every kept column and replace any of the literal strings collected in pass 1 that turn up in them. |
| 4 prove | Scan every textual column twice: once for those literal strings, once for anything that still pattern-matches a real UK telephone number, e-mail address or postcode. Report what is left, by count. |

**Pass 3 is the belt.** A customer's name sitting in a column nobody thought of as free text — an
`approved_by` that holds a typed name, a `rationale`, a json leaf under an unnamed array element —
is found and rewritten anyway. **Pass 4 is the proof**, and it is what the pull request quotes:
after a complete scrub it reports zero.

The sweep matches a name only on a word boundary, never as a bare substring. It declines two
kinds of term and reports how many it declined: one too common to match safely (`Ben`, `Green`,
`Price`), and one the generators themselves write (`Nottingham`, a pool surname), which it must
not hunt or it would corrupt invented text and report a leak that is not there.

## Three properties of a synthetic value

**Valid.** The product parses telephone numbers, postcodes and e-mail addresses, so a fake one
keeps the shape the parser expects. Telephone numbers come from Ofcom's drama ranges
(`07700 900xxx` and five more), e-mail addresses from the reserved `.invalid` top-level domain
(RFC 2606), postcodes from genuine Nottingham and Derby outward codes. A scrubbed database cannot
reach anybody even if a sender switch is left on by mistake.

**Deterministic.** A value is a pure function of the seed and its input, so the same real person
becomes the same fake person on every run and on every machine. Names, telephone numbers, e-mail
addresses, addresses and postcodes are keyed on the *value*, so one customer is the same invented
customer in `leads`, `conversations`, `calls` and `invoices`, and a reader can follow one thread
across tables. Free text is keyed on the *row* — table, primary key, column — which is what makes
it idempotent.

**Idempotent.** Running the scrub twice changes nothing the second time. Each generator maps its
own output back to itself, and `values.ts` checks that before rewriting.

That check has a trap in it, and the trap is worth knowing about. Several of the checks are pool
memberships rather than proofs: a real customer called Ada Beeston, or a real house on a street
the pool also names, would test as already synthetic and survive. So **the first scrub of a
database rewrites every classified value unconditionally**, and only a later run with the same
seed is allowed to trust the checks. The scrub tells the two apart by a marker row it leaves in
`app_settings` under the key `scrub`, naming the seed it used.

The same trap caught postcodes during development, in a sharper form: an earlier
`isSyntheticPostcode` accepted any valid final letter pair, which made `NG7 2QX` — somebody's
house — test as synthetic, so it survived. Synthetic postcodes now end in a letter pair Royal Mail
does not allocate in NG or DE, which keeps them format-valid and recognisable. The test file holds
that case by name.

## Free text

Conversation and message bodies are the hardest part and the most important, because a customer's
name, street, gate code and job history live in them as prose where no column name hints at it.
Blanking them would be safe but would leave the desk's own scenarios with nothing to read, so
every body is **replaced by invented text of a similar shape**: same rough length, same register,
same channel voice, and the row's own synthetic customer and town woven through it.

That makes invented prose not a fixed point of its own generator — feeding it back gives a
different length target and therefore a different number of sentences. Recognition is structural
instead: every sentence a generator can write comes from the pools in `prose.ts`, so a body is
recognised as invented when each of its sentences matches one of those templates.

## The one deliberate exception

The account named by `PIPELINE_ADMIN_EMAIL` keeps its e-mail address and password hash. Scrubbing
them would lock the pipeline out of `/admin` and fail every run, which would defeat the purpose.
Everything else about that account — name, telephone number — is scrubbed like any other. Every
other account gets a well-formed bcrypt hash whose plaintext was random and discarded, so nobody
can log in as a scrubbed user.

## Files

| File | What it is |
|---|---|
| `plan.ts` | The classifier: rules, per-column overrides, and the fail-closed rule. |
| `synthetic.ts` | Deterministic generators and their "is this already synthetic" checks. |
| `prose.ts` | Invented free text, and recognising it again. |
| `values.ts` | One real value to its synthetic replacement, by treatment. |
| `json-walk.ts` | The same, for string leaves inside json and jsonb, classified by the key above them. |
| `detect.ts` | The sweep's term list, and the pattern detectors behind `--verify`. |
| `introspect.ts` | Reading the target's own schema and keys. |
| `scrub.ts` | The five passes, the refusals and the report. |

## Tests

```bash
npx vitest run --project server server/scrub
```

They cover the three properties above, the classifier from both ends (a column that carries a
person must reach a treatment; a catalogue column must be kept), the fail-closed rule over every
column in `shared/schema.ts`, the word-boundary sweep, and the two bugs named above by the case
that caught them. `__tests__/scrub.test.ts` holds the refusals against a stand-in client that
records every statement: production, an unconfirmed run and an unclassified column each stop with
nothing written, and the CLI exits 3 on production and without `--confirm` before it connects. It
also runs a confirmed scrub over one case file and checks what was rewritten and what was kept.
No test opens a database connection.
