#!/usr/bin/env node
/**
 * build-program.js — build the USRSE'26 program page from the Schedule sheet.
 *
 * Pulls the "Schedule" tab of the program Google Sheet via its CSV export
 * endpoint, folds the flat rows into days -> time slots -> sessions -> events,
 * and writes four kinds of artifact:
 *
 *   _includes/program-schedule.html   Jekyll include rendered on the program page
 *   _data/program.json                normalized data (site.data.program)
 *   pages/program/abstracts/<slug>.md one page per event format (abstracts)
 *   _data/menus/program.yml           program menubar linking those pages
 *
 * The sheet stays the only thing anyone edits. Requires Node 18+ (global
 * fetch); zero dependencies.
 *
 *   PROGRAM_SHEET_ID=<id> node scripts/build-program.js    # live from Sheets
 *   node scripts/build-program.js --file fixtures/schedule.csv   # offline
 *
 * Expected sheet columns (case-insensitive): Start, End, Location,
 * Session Topic, Event Title, Order, the session-level columns
 * Session Format, Session Chair, and Session Description (Markdown), and
 * the event-level columns People, Event Format, and Event Description
 * (Markdown) — event columns are read only on rows with an Event Title.
 * Start/End carry the date and 24h wall-clock time ("10/19 13:30").
 * Session Format is used exactly as given, never inferred from the topic:
 * Break/Meal/Registration render muted, Plenary gets the plenary field.
 * A row with an Event Title attaches an event to the session matching its
 * Start/Session Topic/Location; events sort by Order. Rows still in the
 * pre-2026 layout (every event column empty) are normalized: a
 * "Session Chair: X" row sets the session's chair instead of listing as
 * an event, and a "<title> by <names>" byline splits into title + People.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// ID of the program spreadsheet (the long token in its docs.google.com URL).
// Deliberately kept out of the repo: it must come from the PROGRAM_SHEET_ID
// environment variable (a repository secret in CI). Offline builds with
// --file need no ID at all.
const SHEET_ID = process.env.PROGRAM_SHEET_ID || '';
const SHEET_NAME = 'Schedule';

// Sheet dates are "M/DD" with no year.
const CONF_YEAR = 2026;

// All program times are wall-clock US Pacific. Never construct JS Date
// objects from them — a runner in UTC would shift 8:30am to a different day.
const TZ_OFFSET = '-07:00';

// Concurrent sessions render in this room order regardless of sheet row
// order: the ballroom salons always lead, Willow Glen always trails.
// "Anywhere" suppresses the room line entirely (breaks, meals, registration).
const ROOM_ORDER = [
  'San Jose Ballroom Salon 3 & 4',
  'San Jose Ballroom Salon 1 & 2',
  'San Jose Ballroom Salon 5 & 6',
  'Market Street',
  'Prefunction',
  'Willow Glen Room',
  'Anywhere',
];

// Session Format values that render as a compressed, muted row instead of
// a full session block. The format is always taken from the sheet as
// typed — nothing is inferred from the session topic.
const MUTED_TYPES = new Set(['break', 'meal', 'registration']);

// Event formats (the sheet's Format column), keyed by lowercased trimmed
// cell value. The seven "page formats" carry a pill label on the schedule
// and generate an abstract page (pageTitle/permalink/slug); "Other" opts an
// event out of both. Unknown values are treated as Other, never an error —
// the raw cell text is carried separately for program.json.
/** @type {Record<string, {label: string|null, pageTitle: string|null, permalink: string|null, slug: string|null}>} */
const FORMATS = {
  'bird of a feather': { label: 'Bird of a Feather', pageTitle: 'Birds of a Feather', permalink: 'program/bofs/', slug: 'bofs' },
  'keynote': { label: 'Keynote', pageTitle: 'Keynotes', permalink: 'program/keynotes/', slug: 'keynotes' },
  'paper': { label: 'Paper', pageTitle: 'Papers', permalink: 'program/papers/', slug: 'papers' },
  'plenary': { label: 'Plenary', pageTitle: 'Plenaries', permalink: 'program/plenaries/', slug: 'plenaries' },
  'poster': { label: 'Poster', pageTitle: 'Posters', permalink: 'program/posters/', slug: 'posters' },
  'random access microtalk': { label: 'RAM', pageTitle: 'Random Access Microtalks', permalink: 'program/rams/', slug: 'rams' },
  'talk': { label: 'Talk', pageTitle: 'Talks', permalink: 'program/talks/', slug: 'talks' },
  'workshop': { label: 'Workshop', pageTitle: 'Workshops', permalink: 'program/workshops/', slug: 'workshops' },
  'other': { label: null, pageTitle: null, permalink: null, slug: null },
};

/** Empty cell -> null; known value -> its entry; anything else -> Other.
 * @param {string} raw */
function normalizeFormat(raw) {
  const v = (raw || '').trim();
  if (!v) return null;
  return FORMATS[v.toLowerCase()] || FORMATS.other;
}

const REPO_ROOT = path.join(__dirname, '..');
const OUT_HTML = path.join(REPO_ROOT, '_includes', 'program-schedule.html');
const OUT_JSON = path.join(REPO_ROOT, '_data', 'program.json');

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Minimal RFC 4180 parser: quoted fields, embedded commas/quotes/newlines. */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

// Current sheet headers first; the older names each column replaced stay
// recognized as aliases so an in-transition sheet still builds.
/** @type {Record<string, string>} */
const HEADER_ALIASES = {
  date: 'date', day: 'date',
  start: 'start', starttime: 'start',
  end: 'end', endtime: 'end',
  sessionformat: 'type', type: 'type', sessiontype: 'type',
  sessiontopic: 'session', session: 'session', sessiontitle: 'session',
  sessionchair: 'chair',
  room: 'room', location: 'room',
  eventtitle: 'talk', talk: 'talk', talktitle: 'talk',
  title: 'title',
  speakers: 'speakers', speaker: 'speakers', presenters: 'speakers',
  people: 'speakers',
  eventformat: 'format', format: 'format',
  eventdescription: 'infomd', infomd: 'infomd',
  order: 'order',
  sessiondescription: 'info', info: 'info', notes: 'info',
};

function normalizeHeader(h) {
  return HEADER_ALIASES[h.toLowerCase().replace(/[^a-z]/g, '')] || null;
}

/** Turn raw CSV rows into objects keyed by canonical column names. */
function toRecords(rows) {
  const header = rows[0].map(normalizeHeader);
  return rows.slice(1).map((cells, i) => {
    const rec = { _row: i + 2 }; // 1-based sheet row, counting the header
    header.forEach((key, col) => {
      if (key) rec[key] = (cells[col] || '').trim();
    });
    return rec;
  }).filter((r) => r.start && r.session);
}

/**
 * "A, B and C" / "A, B, and C" / "A and B" -> ["A", "B", "C"]. The parsed
 * list feeds program.json only; display always uses the cell as typed. A
 * single name legitimately containing " and " cannot be told apart from
 * two names — accepted limitation.
 * @param {string} raw
 */
function parsePeople(raw) {
  return raw
    .split(',')
    .map((seg) => seg.trim().replace(/^and\s+/, ''))
    .flatMap((seg) => seg.split(/\s+and\s+/))
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

// ---------------------------------------------------------------------------
// Wall-clock time handling (no JS Date arithmetic on times of day)
// ---------------------------------------------------------------------------

/** "8:30 AM" / "10:30am" / "15:00" -> minutes since midnight. */
function parseTime(raw, ctx) {
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp])?\.?[Mm]?\.?$/);
  if (!m) throw new Error(`Unparsable time "${raw}" (${ctx})`);
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const half = m[3] ? m[3].toLowerCase() : null;
  if (half === 'p' && h !== 12) h += 12;
  if (half === 'a' && h === 12) h = 0;
  return h * 60 + min;
}

/** Minutes since midnight -> "8:30am" / "12pm". */
function fmtTime(mins) {
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const half = h24 < 12 ? 'am' : 'pm';
  let h = h24 % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h}${half}` : `${h}:${String(m).padStart(2, '0')}${half}`;
}

/** ISO local datetime carrying the conference offset explicitly. */
function fmtISO(isoDate, mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${isoDate}T${h}:${m}:00${TZ_OFFSET}`;
}

/** Accept "2026-10-19", "10/19/2026", or "10/19" (conference year); ISO out. */
function parseDate(raw, ctx) {
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return raw;
  m = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (m) {
    const year = m[3] || String(CONF_YEAR);
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  throw new Error(`Unparsable date "${raw}" (${ctx})`);
}

/**
 * Split a sheet Start/End cell — "10/19 13:30" — into ISO date + minutes.
 * A bare time ("13:30") is allowed when the row has a separate Date column.
 * @param {string} raw
 * @param {string | null} fallbackDate
 * @param {string} ctx
 */
function splitDateTime(raw, fallbackDate, ctx) {
  const m = raw.trim().match(/^(\d{1,2}\/\d{1,2}(?:\/\d{4})?|\d{4}-\d{2}-\d{2})\s+(.+)$/);
  if (m) return { date: parseDate(m[1], ctx), mins: parseTime(m[2], ctx) };
  if (!fallbackDate) throw new Error(`Time "${raw}" has no date (${ctx})`);
  return { date: fallbackDate, mins: parseTime(raw, ctx) };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** Weekday/label for an ISO date. Noon UTC keeps this immune to offsets. */
function dateParts(isoDate) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return {
    weekday: WEEKDAYS[d.getUTCDay()],
    label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`,
  };
}

// ---------------------------------------------------------------------------
// Folding: flat rows -> days -> slots -> sessions -> talks
// ---------------------------------------------------------------------------

function roomRank(room) {
  const i = ROOM_ORDER.indexOf(room);
  return i === -1 ? ROOM_ORDER.length : i;
}

function fold(records) {
  const days = new Map(); // isoDate -> Map(slotKey -> slot)
  for (const rec of records) {
    const ctx = `row ${rec._row}`;
    const rowDate = rec.date ? parseDate(rec.date, ctx) : null;
    const { date, mins: start } = splitDateTime(rec.start, rowDate, ctx);
    const end = rec.end ? splitDateTime(rec.end, date, ctx).mins : start;

    if (!days.has(date)) days.set(date, new Map());
    const slots = days.get(date);
    const slotKey = `${start}|${end}`;
    if (!slots.has(slotKey)) slots.set(slotKey, { start, end, sessions: new Map() });
    const slot = slots.get(slotKey);

    const sessionKey = `${rec.session}|${rec.room || ''}`;
    if (!slot.sessions.has(sessionKey)) {
      slot.sessions.set(sessionKey, {
        title: rec.session,
        type: rec.type || '',
        muted: rec.type ? MUTED_TYPES.has(rec.type.toLowerCase()) : false,
        chair: rec.chair || '',
        room: rec.room || '',
        info: rec.info || '',
        talks: [],
        _row: rec._row,
      });
    }
    const session = slot.sessions.get(sessionKey);
    if (!session.info && rec.info) session.info = rec.info;
    if (!session.chair && rec.chair) session.chair = rec.chair;

    if (rec.talk) {
      // The pre-2026 sheet layout wrote "Session Chair: X" as an event row
      // and embedded authors in the title as "… by A, B and C". Normalize
      // both — absorb the chair, split the byline into People — so
      // unmigrated rows render in the current style. Only rows with every
      // event column empty are treated as legacy, so a new-style row whose
      // title happens to contain " by " is never split.
      const legacy = !rec.title && !rec.speakers && !rec.format && !rec.infomd;
      const chairRow = legacy && rec.talk.match(/^(?:session\s+)?chair\s*:\s*(.*)$/i);
      if (chairRow) {
        if (!session.chair && chairRow[1].trim()) session.chair = chairRow[1].trim();
      } else {
        // Displayed title: the Title cell when present, else the Talk cell.
        let title = rec.title || rec.talk;
        let speakers = rec.speakers || '';
        if (legacy) {
          // Split on the last " by "; the tail must parse as names that
          // each start uppercase, so "… by automating triage" stays whole.
          const m = rec.talk.match(/^(.+)\s+by\s+(.+)$/);
          if (m && parsePeople(m[2]).every((name) => /^[A-Z]/.test(name))) {
            title = m[1];
            speakers = m[2];
          }
        }
        session.talks.push({
          title,
          speakers,
          people: parsePeople(speakers),
          formatRaw: rec.format || '',
          format: normalizeFormat(rec.format || ''),
          infoMd: rec.infomd || '',
          order: rec.order ? parseInt(rec.order, 10) : Number.MAX_SAFE_INTEGER,
          _row: rec._row,
        });
      }
    }
  }

  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, slots]) => {
      const { weekday, label } = dateParts(date);
      return {
        date,
        weekday,
        label,
        slots: [...slots.values()]
          .sort((a, b) => a.start - b.start || a.end - b.end)
          .map((slot) => {
            const sessions = [...slot.sessions.values()]
              .sort((a, b) => roomRank(a.room) - roomRank(b.room) || a._row - b._row)
              .map((s) => ({
                title: s.title,
                type: s.type,
                ...(s.chair ? { chair: s.chair } : {}),
                room: s.room,
                info: s.info,
                plenary: s.type.toLowerCase() === 'plenary',
                muted: s.muted,
                talks: s.talks
                  .sort((a, b) => a.order - b.order || a._row - b._row)
                  .map((t) => {
                    // New fields append only when non-empty so a CSV
                    // without the new columns produces byte-identical
                    // JSON. Underscored keys are internal (render/anchor
                    // plumbing) — the JSON writer strips them.
                    /** @type {{title: string, speakers: string, people?: string[], format?: string, infoMd?: string, href?: string, _format?: (typeof FORMATS)[string], _anchor?: string}} */
                    const talk = { title: t.title, speakers: t.speakers };
                    if (t.people.length) talk.people = t.people;
                    if (t.formatRaw) talk.format = t.formatRaw;
                    if (t.infoMd) talk.infoMd = t.infoMd;
                    if (t.format && t.format.slug) talk._format = t.format;
                    return talk;
                  }),
              }));
            return {
              start: fmtTime(slot.start),
              end: fmtTime(slot.end),
              startISO: fmtISO(date, slot.start),
              endISO: fmtISO(date, slot.end),
              break: sessions.every((s) => s.muted),
              sessions,
            };
          }),
      };
    });
}

/** Lowercase, non-alphanumerics -> hyphens, trimmed of hyphens.
 * @param {string} s */
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Assign every page-format event a stable anchor for its abstract-page
 * entry, walking the folded days in schedule traversal order (day -> slot
 * -> room-ranked session -> order-sorted talk) — the same order the pages
 * list entries in, so anchors are deterministic across rebuilds. Anchors
 * are slugified titles, deduplicated per page with -2/-3 suffixes. Events
 * that also carry an Event Description or People get the site-relative
 * deep link the schedule (and program.json) renders — their page entry
 * has an abstract or a byline worth jumping to.
 * @param {ReturnType<typeof fold>} days
 */
function assignAnchors(days) {
  const used = new Map(); // page slug -> Map(anchor base -> count)
  for (const day of days) {
    for (const slot of day.slots) {
      for (const session of slot.sessions) {
        for (const talk of session.talks) {
          if (!talk._format) continue;
          if (!used.has(talk._format.slug)) used.set(talk._format.slug, new Map());
          const seen = used.get(talk._format.slug);
          const base = slugify(talk.title);
          const n = (seen.get(base) || 0) + 1;
          seen.set(base, n);
          talk._anchor = n === 1 ? base : `${base}-${n}`;
          if (talk.infoMd || talk.speakers) talk.href = `${talk._format.permalink}#${talk._anchor}`;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape text bound for a Liquid {% capture %} block: HTML-escape plus
 * neutralize "{" so sheet content can never run Liquid tags or filters.
 * kramdown decodes the entities back to literal text when it renders.
 * @param {string} s */
function escLiquid(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;');
}

function renderSession(s, pad) {
  const cls = ['session'];
  if (s.plenary) cls.push('session--plenary');
  if (s.muted) cls.push('session--muted');
  const lines = [`${pad}<article class="${cls.join(' ')}">`];
  const room = s.room && s.room.toLowerCase() !== 'anywhere'
    ? ` <span class="session__room">— ${esc(s.room)}</span>`
    : '';
  lines.push(`${pad}  <h3 class="session__title">${esc(s.title)}${room}</h3>`);
  if (!s.muted && (s.type || s.chair)) {
    const chair = s.chair
      ? `<span class="session__chair">${s.type ? ' · ' : ''}Chair: ${esc(s.chair)}</span>` : '';
    lines.push(`${pad}  <p class="session__eyebrow">${esc(s.type)}${chair}</p>`);
  }
  if (s.info) {
    // Session Description may be Markdown; the include is Liquid-processed
    // when Jekyll renders it, so markdownify does the conversion with the
    // same kramdown as the rest of the site.
    lines.push(`${pad}  <div class="session__info">{% capture session_info_md %}${escLiquid(s.info)}{% endcapture %}{{ session_info_md | markdownify }}</div>`);
  }
  if (s.talks.length) {
    lines.push(`${pad}  <ol class="session__talks">`);
    for (const t of s.talks) {
      // Page formats render a pill; Other/unknown/empty render nothing.
      const pill = t._format
        ? `<span class="talk__format">${esc(t._format.label)}</span> ` : '';
      // With an abstract or byline (Event Description or People) on a page
      // format, the title deep-links to its entry on that format's page.
      // The include is Liquid-processed when Jekyll renders it, so
      // relative_url keeps the baseurl correct.
      let title = `<span class="talk__title">${esc(t.title)}</span>`;
      if (t._format && (t.infoMd || t.speakers)) {
        title = `<a class="talk__link" href="{{ '${t._format.permalink}' | relative_url }}#${t._anchor}">${title}</a>`;
      }
      // People deliberately don't render here — the schedule stays compact;
      // bylines live on the abstract pages (and in program.json).
      lines.push(`${pad}    <li class="talk">${pill}${title}</li>`);
    }
    lines.push(`${pad}  </ol>`);
  }
  lines.push(`${pad}</article>`);
  return lines.join('\n');
}

function renderHTML(days) {
  const lines = [
    '<!-- Generated by scripts/build-program.js — do not edit by hand.',
    '     Edit the Schedule sheet and re-run the script instead. -->',
    '<div class="program">',
  ];
  lines.push('  <nav class="program-nav" aria-label="Program days">');
  // Decorative for sighted users; the nav's aria-label already names it.
  lines.push('    <span class="program-nav__label" aria-hidden="true">Jump to</span>');
  for (const day of days) {
    lines.push(`    <a class="program-nav__pill" href="#day-${day.weekday.toLowerCase()}">${day.weekday}</a>`);
  }
  lines.push('  </nav>');
  for (const day of days) {
    const id = `day-${day.weekday.toLowerCase()}`;
    lines.push(`  <section class="program-day" id="${id}" aria-labelledby="${id}-title">`);
    // The draft note comes off once the program is final.
    lines.push(`    <h2 class="program-day__title" id="${id}-title">${day.weekday}<span class="program-day__date">, ${day.label}</span><span class="program-day__draft">  (Draft — subject to change)</span></h2>`);
    lines.push('    <ol class="program-day__slots">');
    for (const slot of day.slots) {
      const cls = slot.break ? 'slot slot--break' : 'slot';
      lines.push(`      <li class="${cls}">`);
      // "7:30am–8:30am" reads as "7:30–8:30am": drop the start meridiem
      // when both ends share it. fmtTime output always ends with am/pm.
      const startText = slot.start.slice(-2) === slot.end.slice(-2)
        ? slot.start.slice(0, -2)
        : slot.start;
      lines.push(`        <p class="slot__time"><time datetime="${slot.startISO}">${startText}</time>–<time datetime="${slot.endISO}">${slot.end}</time></p>`);
      lines.push('        <div class="slot__body">');
      for (const s of slot.sessions) lines.push(renderSession(s, '          '));
      lines.push('        </div>');
      lines.push('      </li>');
    }
    lines.push('    </ol>');
    lines.push('  </section>');
  }
  lines.push('</div>');
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Abstract pages — one Markdown page per event format (Jekyll renders them)
// ---------------------------------------------------------------------------

const ABSTRACTS_DIR = path.join(REPO_ROOT, 'pages', 'program', 'abstracts');

// Marks script-generated files; pruning only ever deletes files carrying it,
// so human-authored pages and the .tbd placeholders are never touched.
const PAGE_BANNER = '<!-- Generated by scripts/build-program.js — do not edit by hand. -->';

/** Escape raw HTML (&, <, >) while leaving Markdown syntax alone — kramdown
 * renders &lt;script&gt; as literal text, so tags can never pass through.
 * @param {string} s */
function escMd(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Group page-format events by page slug, in the same traversal order
 * assignAnchors used — the entry order on each abstract page.
 * @param {ReturnType<typeof fold>} days
 * @returns {Map<string, {format: (typeof FORMATS)[string], entries: {title: string, people: string, infoMd: string, anchor: string}[]}>}
 */
function collectAbstracts(days) {
  const pages = new Map();
  for (const day of days) {
    for (const slot of day.slots) {
      for (const session of slot.sessions) {
        for (const talk of session.talks) {
          if (!talk._format) continue;
          if (!pages.has(talk._format.slug)) {
            pages.set(talk._format.slug, { format: talk._format, entries: [] });
          }
          pages.get(talk._format.slug).entries.push({
            title: talk.title,
            people: talk.speakers,
            infoMd: talk.infoMd || '',
            anchor: talk._anchor,
          });
        }
      }
    }
  }
  return pages;
}

/**
 * @param {(typeof FORMATS)[string]} format
 * @param {{title: string, people: string, infoMd: string, anchor: string}[]} entries
 */
function renderAbstractPage(format, entries) {
  const lines = [
    '---',
    'layout: page',
    `title: ${format.pageTitle}`,
    `description: ${format.label} abstracts at USRSE'26`,
    'menubar: program',
    `permalink: ${format.permalink}`,
    'menubar_toc: true',
    'set_last_modified: true',
    '---',
    PAGE_BANNER,
  ];
  entries.forEach((e, i) => {
    // USRSE'25 entry style: h2 title, italic byline, abstract, entries
    // separated by horizontal rules. The {#anchor} header IAL pins the id
    // the schedule deep-links to — no reliance on kramdown's auto-ID
    // algorithm.
    if (i) lines.push('', '------');
    lines.push('', `## ${escMd(e.title)} {#${e.anchor}}`);
    if (e.people) lines.push('', `_${escMd(e.people)}_`);
    if (e.infoMd) lines.push('', escMd(e.infoMd));
  });
  return lines.join('\n') + '\n';
}

/**
 * Write one page per active format and prune banner-carrying pages whose
 * format no longer appears in the sheet. Returns the page map for the
 * menubar writer.
 * @param {ReturnType<typeof fold>} days
 */
function writeAbstractPages(days) {
  const pages = collectAbstracts(days);
  for (const [slug, { format, entries }] of pages) {
    writeIfChanged(path.join(ABSTRACTS_DIR, `${slug}.md`), renderAbstractPage(format, entries));
  }
  if (fs.existsSync(ABSTRACTS_DIR)) {
    for (const name of fs.readdirSync(ABSTRACTS_DIR)) {
      if (!name.endsWith('.md') || pages.has(name.slice(0, -3))) continue;
      const file = path.join(ABSTRACTS_DIR, name);
      if (fs.readFileSync(file, 'utf8').includes(PAGE_BANNER)) {
        fs.unlinkSync(file);
        console.log(`  removed    ${path.relative(REPO_ROOT, file)}`);
      }
    }
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Program menubar — script-managed while abstract pages exist
// ---------------------------------------------------------------------------

// The live menubar (menubar.html reads _data/menus/<name>, never hidden/).
// _data/menus/hidden/program.yml stays untouched as the human-owned seed.
const OUT_MENU = path.join(REPO_ROOT, '_data', 'menus', 'program.yml');

const MENU_BANNER = '# Generated by scripts/build-program.js — do not edit by hand.';

/**
 * Emit the program menubar linking every abstract page, Full Program
 * first, formats in vocabulary order. With no abstract pages (e.g. a CSV
 * without the new columns) a banner-carrying file is deleted instead, so
 * the menu reverts to its hidden state and a legacy build never creates it.
 * @param {ReturnType<typeof writeAbstractPages>} pages
 */
function writeMenubar(pages) {
  if (!pages.size) {
    if (fs.existsSync(OUT_MENU) && fs.readFileSync(OUT_MENU, 'utf8').includes(MENU_BANNER)) {
      fs.unlinkSync(OUT_MENU);
      console.log(`  removed    ${path.relative(REPO_ROOT, OUT_MENU)}`);
    }
    return;
  }
  const lines = [
    MENU_BANNER,
    '- label: Program',
    '  items:',
    '    - name: Full Program',
    '      link: program/',
  ];
  for (const format of Object.values(FORMATS)) {
    if (format.slug && pages.has(format.slug)) {
      lines.push(`    - name: ${format.pageTitle}`, `      link: ${format.permalink}`);
    }
  }
  writeIfChanged(OUT_MENU, lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function loadCSV() {
  const fileFlag = process.argv.indexOf('--file');
  if (fileFlag !== -1) {
    const file = process.argv[fileFlag + 1];
    if (!file) throw new Error('--file requires a path');
    console.log(`Reading ${file}`);
    return fs.readFileSync(path.resolve(file), 'utf8');
  }
  if (!SHEET_ID) {
    throw new Error(
      'PROGRAM_SHEET_ID is not set. Export the sheet ID as an environment '
      + 'variable, or run with --file fixtures/schedule.csv.');
  }
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;
  console.log(`Fetching "${SHEET_NAME}" tab from Google Sheets…`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Sheet fetch failed: HTTP ${res.status}`);
  return res.text();
}

/** Write only when content changed so a scheduled runner commits no churn. */
function writeIfChanged(file, content) {
  const rel = path.relative(REPO_ROOT, file);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) {
    console.log(`  unchanged  ${rel}`);
    return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(`  wrote      ${rel}`);
  return true;
}

async function main() {
  const csv = await loadCSV();
  const records = toRecords(parseCSV(csv));
  if (!records.length) throw new Error('No schedule rows found — check the sheet.');
  const days = fold(records);
  assignAnchors(days);

  const sessionCount = days.reduce(
    (n, d) => n + d.slots.reduce((m, s) => m + s.sessions.length, 0), 0);
  console.log(`Parsed ${records.length} rows -> ${days.length} days, ${sessionCount} sessions.`);

  writeIfChanged(OUT_HTML, renderHTML(days));
  // Underscored keys are internal plumbing — program.json carries text only.
  writeIfChanged(OUT_JSON, JSON.stringify(
    { timezone: TZ_OFFSET, days },
    (key, value) => (key.startsWith('_') ? undefined : value), 2) + '\n');
  writeMenubar(writeAbstractPages(days));
}

main().catch((err) => {
  console.error(`build-program: ${err.message}`);
  process.exit(1);
});
