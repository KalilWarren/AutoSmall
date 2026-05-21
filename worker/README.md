# AutoSmall → REDCap Worker

A small Cloudflare Worker that lets the AutoSmall scoring app submit results to
REDCap. It exists because a static site **cannot** safely hold a REDCap API
token or do real password checks — anything in the page is readable by anyone.
This Worker is the secure boundary: it holds the token and password as
server-side secrets, verifies the password, maps the scores onto the REDCap
project's `smalls_sentence_repetition` fields, and imports one record.

```
AutoSmall (browser)  ──POST scores + password──▶  Worker  ──REDCap API──▶  REDCap
                                                  (holds token + password)
```

## One-time setup

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up) and
Node.js installed. All commands run from this `worker/` folder.

```sh
cd worker

# 1. Sign in to Cloudflare (opens a browser).
npx wrangler login

# 2. Store the two secrets. Each command prompts for the value —
#    it is sent straight to Cloudflare and never written to disk or the repo.
npx wrangler secret put REDCAP_TOKEN       # paste your REDCap API token
npx wrangler secret put SUBMIT_PASSWORD    # choose the shared submit password

# 3. Deploy.
npx wrangler deploy
```

`wrangler deploy` prints the Worker URL, e.g.
`https://autosmall-redcap.your-subdomain.workers.dev`.

## Connect the app to the Worker

Open `../index.html`, find this line near the top of the `<script>`:

```js
const WORKER_URL = '';
```

Paste the deployed URL between the quotes, then commit and push:

```sh
cd ..
git add index.html
git commit -m "Wire AutoSmall to the REDCap submission Worker"
git push
```

The **Submit to REDCap** button appears only once `WORKER_URL` is set, so the
live site is safe to publish before the Worker exists.

## Configuration

Non-secret settings live in `wrangler.toml` under `[vars]`:

| Var | Purpose |
|-----|---------|
| `REDCAP_API_URL` | REDCap API endpoint — `https://redcap.research.sc.edu/api/` |
| `ALLOWED_ORIGIN` | Browser origin allowed to call the Worker — the GitHub Pages site |
| `REDCAP_EVENT` | **Only** if the REDCap project is longitudinal — the event name (e.g. `baseline_arm_1`). Omit otherwise. |

Secrets (`REDCAP_TOKEN`, `SUBMIT_PASSWORD`) are **never** in `wrangler.toml` or
the repo — they live only in Cloudflare. Change either by re-running
`npx wrangler secret put <NAME>`. After editing `wrangler.toml`, run
`npx wrangler deploy` again.

## How records are written

- Imports one record into the `smalls_sentence_repetition` form.
- The Participant ID is written to both `subject_id` (the record key) and
  `field1` ("Part ID"); `sent_rep_data_yes_or_no` is set to `1`.
- Per-sentence points → `init_N` / `med_N` / `fin_N`; unscored sentences are
  left blank. Raw totals, overall percentages, and per-type percentages map to
  their matching fields. Per-sentence notes are combined into
  `sent_rep_comments`.
- The form status (`smalls_sentence_repetition_complete`) is set to
  **Complete**, so submitted records aren't left showing as Incomplete.
- **Overwrite guard:** before importing, the Worker checks whether that
  participant already has sentence-repetition data. If so, it returns a
  "needs confirmation" response (HTTP 409) and the app makes the rater
  explicitly confirm before replacing it — a mistyped Participant ID can't
  silently overwrite an existing record. This check requires the REDCap API
  token to have **Export** rights as well as **Import**.
- `overwriteBehavior` is `normal` — a submission updates the form's fields and
  leaves unrelated fields on the record untouched.

## Notes

- The REDCap API token is institution-issued. Confirm with your REDCap
  administrator that API access and this submission path are permitted.
- Cloudflare's free tier (100,000 requests/day) is far more than this needs.
