# Tasks — homepage featured program

Ordered, small tasks. This repo has no test suite (requirements, Resolved
decisions), so after each task the build stays green by this check:
`bundle exec jekyll build` exits 0 with no new Liquid warnings, and the greps
listed in the task match against `_site/index.html`. Section references (§n)
are to `design.md`.

Verification first: every task states its expected grep results before the
code that produces them, and temporary probe calls (e.g.
`format="Nonexistent"`) are reverted before the task is committed.

**Data note.** Counts below assume the committed `_data/program.json`: 1
`Keynote` event (Fernando Pérez, with `image`, `infoMd`, `href`) and 3
`Student` events (Careers in RSE panel; Mentor/Mentee Lunch in the muted
"Lunch Break" session; Invited Talks), none with `image`. If a sheet rebuild
changes those numbers before implementation, recount from `program.json` and
adjust the expected values. Do **not** run `scripts/build-program.js` as part
of this work.

---

- [x] 1. **Baseline** (Story 3, Story 4) — Run `bundle exec jekyll build` on
  the untouched tree. Record: exit status 0; any warnings it already prints
  (so later tasks can tell new ones apart); `grep -c 'class="featured' _site/index.html`
  → `0`. No files change; nothing to commit.

- [x] 2. **Include skeleton: selection, wrapper, empty case** (Story 2; §1, §2, §4)
  — Expected after this task: `grep -c 'class="featured__item"'` → `1`;
  `grep -o 'id="featured-[a-z-]*"'` → `featured-keynote`; the heading text
  `Keynote Speaker` appears between the cards `</section>` and the
  `Conference Sponsors` `<h2>`.

  Create `_includes/featured-program.html` with the `fp_`-prefixed variables,
  the four nested loops over `site.data.program.days → slots → sessions →
  talks`, the `strip | downcase` format match, the `fp_limit`/`fp_count`
  logic, the `capture fp_items` buffer, and the `fp_count > 0` guard around
  the `<section class="featured">` wrapper, optional `<h2 class="featured__heading">`,
  and `<ul class="featured__list">`. Each entry is, for now, only
  `<li class="featured__item"><h3 class="featured__title">{{ talk.title | escape }}</h3></li>`.

  In `index.html`, after `{% include cards.html %}` (`:21`), add
  `{% include featured-program.html format="Keynote" title="Keynote Speaker" %}`.

  Probe the empty case: temporarily add a call with `format="Nonexistent"
  title="X"`, rebuild, confirm `featured__item` count is still `1` and no
  `id="featured-nonexistent"` exists; probe case/whitespace by temporarily
  changing the keynote call to `format=" keynote "` and confirming count `1`.
  Revert both probes.

- [ ] 3. **Full entry markup** (Story 1; §3) — Expected after this task, within
  the `featured-keynote` section of `_site/index.html`:
  - `<img class="featured__portrait"` with `src` ending
    `/assets/img/perez.jpeg` and `alt="Fernando Pérez"`;
  - `<a href="…/program/keynotes/#fernando-p-rez">Fernando Pérez</a>` in the
    `<h3>`;
  - `<time datetime="2026-10-19T08:30:00-07:00">Monday, October 19 · 8:30am–10am</time>`
    followed by `San Jose Ballroom Salon 3 &amp; 4`;
  - a `featured__excerpt` paragraph containing no `<a`, no `[` / `](`, at most
    40 words plus a trailing `...`;
  - a `featured__more` link to the same `href` with a visually hidden
    `about Fernando Pérez` suffix;
  - no `featured__speakers` element (keynote `speakers` is `""`).

  Replace the placeholder `<li>` with the §3 entry: optional portrait,
  linked-or-plain title, optional speakers, when/where line, optional
  excerpt, optional "Read more". Use `x and x != ""` for every string test.

  The no-`href` branch has no live data to exercise it (every keynote and
  student event carries `href`); confirm by code review that its `else` emits
  the escaped title with no `<a>` and that "Read more" shares the same
  `talk.href` guard. The no-`image` branch is exercised by task 4.

- [ ] 4. **Student & Early Career section** (Story 2b; §1) — Expected after
  this task: `featured__item` count → `4`; ids `featured-keynote` then
  `featured-student`, in that order, both before `Conference Sponsors`; the
  student section contains `Careers in RSE`, `USRSE&#39;26 Mentor/Mentee Lunch`
  (or the unescaped apostrophe, whichever `escape` produces), and `Invited Talks`,
  in that order; the student section contains **no** `featured__portrait`;
  the Invited Talks excerpt is one line of text (its `infoMd` newlines
  collapsed) with no stray `<br>` or `<p>`.

  In `index.html`, directly after the keynote call, add
  `{% include featured-program.html format="Student" title="Student & Early Career Program" %}`.

- [ ] 5. **`limit` parameter** (Story 2; §1, §2) — Expected: with a temporary
  `limit=1` on the Student call, count → `2` and only `Careers in RSE` appears
  in the student section; with `limit=0`, count → `4`. Revert to no `limit`.
  No code change is expected if task 2 implemented `fp_limit` per §2; fix the
  include here if either probe fails.

- [ ] 6. **Stylesheet** (Story 4; §3, §5) — Expected: `_site/assets/css/featured-program.css`
  exists; `_site/index.html` links it once with the `?v=` cache-buster, before
  the first `class="featured"`; `grep -c 'class="featured[^"]*"[^>]*style='`
  → `0` (no inline styles in the featured markup).

  Create `assets/css/featured-program.css` with the §5 rules: heading band
  matching `index.html:23-34`, `.content .featured__list` reset, flex
  `.featured__item` with hairline separator, portrait sizing, title/when
  colors, `.featured .visually-hidden` (only if `bootstrap.css` does not
  already define `.visually-hidden` — check first), and the
  `@media (max-width: 40rem)` stack. Add the `<link>` to `index.html` above
  the keynote include.

  Visual check with `bundle exec jekyll serve`: at desktop width the keynote
  portrait sits left of the text; at ≤ 40rem (browser devtools, 375px) the
  portrait stacks above the text and the page has no horizontal scroll; the
  two orange heading bands match the sponsor band.

- [ ] 7. **Scope check** (Story 3) — Expected: `git diff --stat main` lists
  exactly `_includes/featured-program.html` (new),
  `assets/css/featured-program.css` (new), and `index.html`; nothing under
  `scripts/`, `_data/`, or `pages/program/abstracts/`. Final
  `bundle exec jekyll build` exits 0 with no warnings beyond the task 1
  baseline.
