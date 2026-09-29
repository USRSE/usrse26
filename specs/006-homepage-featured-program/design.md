# Design — homepage featured program

## Overview

One new Liquid include, `_includes/featured-program.html`, walks
`site.data.program` (`_data/program.json`) and renders every event whose
`format` matches an include parameter. `index.html` calls it twice, between
`{% include cards.html %}` (`:21`) and the "Conference Sponsors" header
(`:23-34`): once for `Keynote`, once for `Student`. A new stylesheet,
`assets/css/featured-program.css`, styles it; `index.html` links it once.

Nothing upstream changes. `program.json` already carries every field the
snippet needs, and `scripts/build-program.js` rewrites it on every sheet
rebuild, so the homepage follows the sheet at the next Jekyll build.

The spec skill's domain / application / adapters / infrastructure layering
does not map onto a Jekyll site with no application code. The nearest
equivalent is kept: data (`_data/program.json`, generated) stays separate from
presentation (the include), which does no I/O beyond reading `site.data`, and
styling lives in its own stylesheet.

## Affected components

| File / module | Change |
| --- | --- |
| `_includes/featured-program.html` | **New.** Parameterized include: `format` (required), `title`, `limit`. Selects matching events from `site.data.program` and renders the featured section, or nothing. |
| `assets/css/featured-program.css` | **New.** Section heading band, entry layout (portrait + text), mobile stacking at the `40rem` breakpoint `abstracts.css` already uses (`:238`). |
| `index.html` | Adds one `<link>` to the stylesheet and two include calls between `:21` and `:23`. |
| `_data/program.json` | **Read, unchanged.** Shape: `days[] {date, weekday, label, slots[] {start, end, startISO, endISO, break, sessions[] {title, type, room, info, plenary, muted, talks[] {title, speakers, format, infoMd?, image?, doi?, href?}}}}`. |
| `scripts/build-program.js`, `pages/program/abstracts/*` | Unchanged (Story 3). |
| `_includes/cards.html`, `_data/cards/home.yml` | Unchanged. |

## Detailed design

### 1. Include interface

```liquid
{% include featured-program.html format="Keynote" title="Keynote Speaker" %}
{% include featured-program.html format="Student" title="Student & Early Career Program" %}
```

| Param | Required | Meaning |
| --- | --- | --- |
| `format` | yes | Event Format to match. Compared as `strip \| downcase` on both sides — the same normalization `normalizeFormat()` applies (`build-program.js:213-217`). |
| `title` | no | Section heading text. Omitted → no heading element. |
| `limit` | no | Max entries. Omitted or non-positive → no cap. |

### 2. Selection and the empty case

Liquid cannot `break` out of nested loops, and the wrapper must not render when
nothing matches. Both are solved by rendering entries into a buffer first:

```liquid
{%- assign fp_want = include.format | strip | downcase -%}
{%- assign fp_limit = include.limit | plus: 0 -%}
{%- assign fp_count = 0 -%}
{%- capture fp_items -%}
  {%- for day in site.data.program.days -%}
    {%- for slot in day.slots -%}
      {%- for session in slot.sessions -%}
        {%- for talk in session.talks -%}
          {%- assign fp_fmt = talk.format | strip | downcase -%}
          {%- if fp_fmt == fp_want -%}
            {%- if fp_limit <= 0 or fp_count < fp_limit -%}
              {%- assign fp_count = fp_count | plus: 1 -%}
              … one <li> entry (§3) …
            {%- endif -%}
          {%- endif -%}
        {%- endfor -%}
      {%- endfor -%}
    {%- endfor -%}
  {%- endfor -%}
{%- endcapture -%}
{%- if fp_count > 0 -%}
  <section class="featured" …> … <ul class="featured__list">{{ fp_items }}</ul></section>
{%- endif -%}
```

- Traversal order is `program.json` order, which is chronological (Story 1,
  last criterion).
- Filtering is by `format` only, so the Mentor/Mentee Lunch — a `Student`
  event inside the muted "Lunch Break" session — is listed (Story 2b).
- All variables are `fp_`-prefixed. Liquid include variables leak into the
  page scope, so the prefix stops them colliding with `index.html`'s `post`
  and `paginator` loops. `fp_count` is reset at the top of each call, so the
  second include starts at zero.
- `site.data.program` missing or empty → the loops do not run →
  `fp_count == 0` → nothing is emitted.

### 3. One entry

```html
<li class="featured__item">
  {% if talk.image %}<img class="featured__portrait"
       src="{{ talk.image | relative_url }}" alt="{{ talk.title | escape }}" loading="lazy">{% endif %}
  <div class="featured__body">
    <h3 class="featured__title">
      {% if talk.href %}<a href="{{ talk.href | relative_url }}">{{ talk.title | escape }}</a>
      {% else %}{{ talk.title | escape }}{% endif %}
    </h3>
    {% if talk.speakers and talk.speakers != "" %}<p class="featured__speakers">{{ talk.speakers | escape }}</p>{% endif %}
    <p class="featured__when">
      <time datetime="{{ slot.startISO }}">{{ day.weekday }}, {{ day.label }} · {{ slot.start }}–{{ slot.end }}</time>
      · {{ session.room | escape }}
    </p>
    {% if talk.infoMd and talk.infoMd != "" %}<p class="featured__excerpt">{{ talk.infoMd | markdownify | strip_html | normalize_whitespace | truncatewords: 40 }}</p>{% endif %}
    {% if talk.href %}<a class="featured__more" href="{{ talk.href | relative_url }}">Read more<span class="visually-hidden"> about {{ talk.title | escape }}</span></a>{% endif %}
  </div>
</li>
```

- **Excerpt.** `markdownify` turns `[Fernando Pérez](https://…)` into a link;
  `strip_html` drops the tags and keeps the text; `normalize_whitespace`
  collapses embedded newlines (the "Invited Talks" `infoMd` has several) to
  single spaces; `truncatewords: 40` caps the length and appends `...`.
  (`truncatewords` alone only rejoins words when it actually truncates, so a
  short multi-line abstract would otherwise keep its newlines.) The existing precedent is
  `faq-card.html:7` (`markdownify | strip_html | truncate`).
- **Portrait `alt`.** The event title. For keynotes that is the speaker's name
  ("Fernando Pérez"), which is the accurate description.
- **`image`/`href`/`infoMd` absent.** `program.json` omits these keys when
  empty (the student events have no `image`), and Liquid treats a missing key
  as `nil`, which is falsy but also `!= ""`. String fields are therefore
  tested with `x and x != ""`, covering both absent and empty.
- **"Read more" repeated link text.** A visually hidden suffix keeps the link
  names distinct for screen readers. If `visually-hidden` is not defined by
  `bootstrap.css`, the stylesheet defines `.featured .visually-hidden`.
- **Headings.** The page `<h2>` is the site title slot in `page.html`; the
  section heading is `<h2 class="featured__heading">` (matches the "Conference
  Sponsors" `<h2>`), entries are `<h3>`.

### 4. Section wrapper and IDs

```html
<section class="featured" {% if include.title %}aria-labelledby="featured-{{ fp_want | slugify }}"{% endif %}>
  {% if include.title %}<h2 class="featured__heading" id="featured-{{ fp_want | slugify }}">{{ include.title | escape }}</h2>{% endif %}
  <ul class="featured__list">{{ fp_items }}</ul>
</section>
```

The only `id` is derived from the format (`featured-keynote`,
`featured-student`), so two calls with different formats never collide
(Story 2). Entry anchors are not needed on the homepage; deep links go to the
abstract pages.

### 5. Styling (`assets/css/featured-program.css`)

- **Heading band.** `.featured__heading` reproduces the inline style of the
  existing "Conference Sponsors" band (`index.html:23-34`: `#C16531`, 14px
  radius, `12px 20px` padding, centered, white text, `2rem 0 1rem` margin), so
  the three bands on the page read alike. The sponsor band itself is out of
  scope and keeps its inline style.
- **List.** `.featured__list` resets `list-style`, margin and padding; `.content`
  (Bulma) adds list indentation otherwise, so the reset uses
  `.content .featured__list` for specificity, the same trick `abstracts.css`
  documents in its header.
- **Entry.** `.featured__item` is `display: flex; gap: 1.25rem;
  align-items: flex-start`, separated by a `#dbdbdb` hairline.
  `.featured__portrait` is `width: 12rem; max-width: 35%; height: auto;
  border-radius: 4px; flex: none`.
- **Type.** Title in `--us-rse-main` purple with the fallback `#741755`;
  `.featured__when` in `#757575` (the WCAG-AA muted grey `abstracts.css`
  settled on).
- **Mobile.** `@media (max-width: 40rem)`: `.featured__item` becomes
  `flex-direction: column`; the portrait goes `width: 100%; max-width: 18rem`,
  mirroring `abstracts.css:249-254`. No fixed widths wider than the viewport
  → no horizontal scroll.
- **Link.** In `index.html`, above the first include:
  `<link rel="stylesheet" href="{{ site.baseurl }}/assets/css/featured-program.css?v={{ site.time | date: '%s' }}">`,
  the same cache-busting pattern the abstract pages use (`keynotes.md:11`).

### 6. Verification

No test suite exists (requirements, Resolved decisions). Each task is checked
with:

```sh
bundle exec jekyll build                          # exit 0, no "Liquid" warnings
grep -c 'class="featured__item"' _site/index.html  # expected count
grep -o 'id="featured-[a-z-]*"' _site/index.html   # featured-keynote, featured-student
```

With today's `program.json`: 1 keynote entry (with portrait) and 3 student
entries (no portraits), total 4 `featured__item`. The empty case is checked by
temporarily calling the include with `format="Nonexistent"` and confirming no
`class="featured"` is emitted, then reverting.

## Requirements coverage

| Story / criterion | Where addressed |
| --- | --- |
| 1 — section renders when Keynote events exist | §2 selection, `index.html` call |
| 1 — after cards, before sponsors, "Keynote Speaker" | §1 call site, `index.html:21-23` |
| 1 — portrait via `relative_url`, alt from title | §3 |
| 1 — no image → no `<img>` | §3 `{% if talk.image %}` |
| 1 — title, speakers, day, time, room | §3 |
| 1 — 40-word plain-text excerpt | §3 excerpt filter chain |
| 1 — title + "Read more" link to `href` | §3 |
| 1 — no `href` → plain title, no link | §3 |
| 1 — chronological order | §2 traversal |
| 2 — `format` match, case/whitespace-insensitive | §1, §2 `strip \| downcase` |
| 2 — optional `title` heading | §4 |
| 2 — optional `limit` | §2 `fp_limit` |
| 2 — two calls, no duplicate IDs | §4 format-derived id; §2 `fp_` reset |
| 2 — no match → renders nothing | §2 `fp_count > 0` guard |
| 2b — Student section after keynote, before sponsors | §1 call order |
| 2b — Story 1 per-entry rules apply | §3 is shared by both calls |
| 2b — muted-session events still listed | §2 filters on `format` only |
| 3 — follows `program.json` at next build | §Overview; reads `site.data.program` |
| 3 — no change to generator/data/abstract pages | Affected components |
| 4 — stylesheet, not inline styles | §5 |
| 4 — mobile stacking, no horizontal scroll | §5 media query |
| 4 — builds without Liquid errors | §6 |

No acceptance criterion is intentionally dropped.
