# Sentence Repetition Scoring

A self-contained, single-page clinical scoring tool for the Small, Kemper &
Lyons (2000) sentence repetition task — 30 sentences across 6 types (Active,
Passive, O-S, O-O, S-S, S-O), each segmented into Initial / Medial / Final
serial-position phrases.

Everything lives in one file (`index.html`): no backend, no build step, no
dependencies. It runs equally well opened directly from disk or served from
GitHub Pages.

## Use it locally

Double-click `index.html`, or open it in a browser (`file://…/index.html`).
Scores are held in memory for the session only — use **Export CSV** to save.

## Loading the real sentences

`index.html` ships with the `SENTENCES` array **empty**, so it generates 30
placeholder sentences and shows a banner. To load the real stimuli, edit the
`SENTENCES` array near the top of the `<script>` block:

```js
const SENTENCES = [
  {
    n: 1,
    type: 'Active',            // 'Active' | 'Passive' | 'O-S' | 'O-O' | 'S-S' | 'S-O'
    target: 'The full sentence text.',
    segments: [
      { label: 'Initial', text: 'The full' },
      { label: 'Medial',  text: 'sentence' },
      { label: 'Final',   text: 'text.' }
    ]
  },
  // … 30 entries, 5 per type
];
```

Word counts are derived automatically (whitespace split; hyphenated compounds
count as one word). Each word is worth one point, so a segment's maximum points
equal its word count. The per-position / overall percentages use point-weighted
pooling — see the `SCORING AGGREGATION` comment in `index.html` to adjust this
against the scoring reference.

## Deploy to GitHub Pages

1. **Create a repository** on GitHub (e.g. `sentence-repetition-scoring`).
   It can be public or private (Pages works with both on current plans).

2. **Add `index.html`** to the repository root and push it:

   ```sh
   cd /Users/kalilwarren/Desktop/Auto_Small
   git init
   git add index.html README.md
   git commit -m "Add sentence repetition scoring tool"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

   (Or upload `index.html` through the GitHub web UI: **Add file → Upload
   files**.)

3. **Enable Pages**: in the repository, go to **Settings → Pages**. Under
   *Build and deployment*, set **Source** to *Deploy from a branch*, choose
   branch **`main`** and folder **`/ (root)`**, then **Save**.

4. **Open the published URL.** After a minute, the site is live at:

   ```
   https://<your-username>.github.io/<your-repo>/
   ```

   Because the app is a single static file, no build action is needed — every
   push to `main` republishes automatically.

## App reference

- **Prev / Next** — step through all 30 stimuli in order, 1 → 30
  (`Alt + ← / →` also works). The app launches on stimulus 1. On the last
  stimulus, *Next* becomes an **All done** button that finalizes scoring,
  opens the score breakdown, and reports how many stimuli were scored.
- **Tabs** — one per sentence type; each shows that type's completion and
  turns green when all 5 are scored. The current stimulus's type is
  highlighted automatically; click a tab to jump to the first stimulus of
  that type.
- **Per sentence** — each of the three segments starts at full points (one
  point per word); lower a segment's points to mark errors. A sentence counts
  as *scored* once its points are changed or the rater moves on to another
  sentence. A notes box is saved per sentence.
- **Summary line** — overall % correct plus % correct for each serial
  position (Initial / Medial / Final), across all scored sentences.
- **Score breakdown** — collapsed by default; expand for a table of points
  awarded, maximum points, and percentage for each serial position and the
  total, broken down by each sentence type with an all-types total row.
- **Summary table** — collapsed by default; click *Show summary table* to
  expand. One row per sentence; click a row to jump to it.
- **Export CSV** — downloads each segment's points awarded, maximum points,
  errors, and % correct per sentence, plus notes and the full per-type score
  breakdown.
- **Submit to REDCap** — appears only once the submission Worker is configured
  (see below). Opens a dialog for the Participant ID, assessment date, and
  shared password, then pushes the scores straight into the REDCap project.

## Submitting results to REDCap

AutoSmall can push results directly into the project's
`smalls_sentence_repetition` form. Because a static site cannot safely hold a
REDCap API token, submission goes through a tiny **Cloudflare Worker** that
holds the token and the shared password as server-side secrets.

Setup is a one-time job — see [`worker/README.md`](worker/README.md) for the
deploy steps. Until the Worker URL is filled into `index.html`, the
*Submit to REDCap* button stays hidden, so the site is safe to publish without it.
