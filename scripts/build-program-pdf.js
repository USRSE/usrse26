#!/usr/bin/env node
/**
 * build-program-pdf.js — build the USRSE'26 printed program from repo data.
 *
 * Reads the committed schedule and the other repo sources, never the sheet:
 *
 *   _data/program.json            schedule (written by build-program.js)
 *   _config.yml                   title, theme, dates, location, Wi-Fi, url
 *   _print/welcome.md             General Chairs' welcome letter (optional)
 *   pages/about/organization.md   organizing committee
 *   index.html                    sponsor tiers and logos
 *   _data/org-members.yml         organizational founding members (optional)
 *
 * and writes two artifacts:
 *
 *   _print/program.html           self-contained print HTML (US Letter)
 *   pages/program/program.pdf     the same, printed by headless Chrome
 *
 * Run by hand before sending the program to the printer; it is not part of
 * the daily sheet workflow. Requires Node 18+; zero dependencies.
 *
 *   node scripts/build-program-pdf.js               # HTML + PDF
 *   node scripts/build-program-pdf.js --html-only   # HTML only, no Chrome
 *   node scripts/build-program-pdf.js --force       # re-render the PDF
 *   CHROME_PATH=/path/to/chrome node scripts/build-program-pdf.js
 *
 * assets/img/program-qr.svg is committed, not generated here. It was made
 * once with:
 *
 *   npx --yes qrcode -t svg -o assets/img/program-qr.svg \
 *     https://us-rse.org/usrse26/program/
 *
 * The PDF is re-rendered only when it is older than the print HTML. Changing
 * a logo or image file leaves the HTML identical, so pass --force then.
 *
 * build-program.js still hard-codes its own conference location rather than
 * reading conf_location; switching it changes llms.txt, so it is tracked
 * separately (issue #69).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = path.join(__dirname, '..');

/**
 * Top-level scalars from _config.yml — copied from build-program.js, which
 * cannot be required (it runs main() on load). Deliberately not a YAML parse:
 * "key: value" lines at column 0 only, quoted values kept verbatim, unquoted
 * ones lose a trailing " # comment". Commented-out keys never match.
 */
function readJekyllConfig() {
  let text;
  try {
    text = fs.readFileSync(path.join(REPO_ROOT, '_config.yml'), 'utf8');
  } catch (err) {
    configFail(`cannot read _config.yml: ${err.message}`);
  }
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]+(\S.*)$/.exec(line);
    if (!m) continue;
    const quoted = /^(["'])([\s\S]*)\1[ \t]*(?:#.*)?$/.exec(m[2]);
    values.set(m[1], quoted ? quoted[2] : m[2].replace(/[ \t]+#.*$/, '').trim());
  }
  return values;
}

/** Copied from build-program.js: config errors surface while constants are
 * initialized, before main().catch exists, so they report and exit here. */
function configFail(message) {
  console.error(`build-program-pdf: ${message}`);
  process.exit(1);
}

const JEKYLL = readJekyllConfig();

/** Copied from build-program.js: a _config.yml value that must be present. */
function configValue(key) {
  const v = JEKYLL.get(key);
  if (v === undefined || v === '') {
    configFail(`_config.yml has no "${key}" — cannot build the program.`);
  }
  return v;
}

// Copied from build-program.js: absolute site root, url + baseurl.
const SITE_BASE = (() => {
  const origin = configValue('url').replace(/\/+$/, '');
  const base = (JEKYLL.get('baseurl') || '').replace(/^\/+|\/+$/g, '');
  return base ? `${origin}/${base}/` : `${origin}/`;
})();

const CONF = {
  title: configValue('title'),
  theme: configValue('conf_theme_short'),
  location: configValue('conf_location'),
  start: configValue('conf_start_date'),
  end: configValue('conf_end_date'),
  wifiSsid: JEKYLL.get('conf_wifi_ssid') || '',
  wifiPassword: JEKYLL.get('conf_wifi_password') || '',
};

const PROGRAM_JSON = path.join(REPO_ROOT, '_data', 'program.json');
const WELCOME_MD = path.join(REPO_ROOT, '_print', 'welcome.md');
const ORG_MD = path.join(REPO_ROOT, 'pages', 'about', 'organization.md');
const INDEX_HTML = path.join(REPO_ROOT, 'index.html');
const ORG_MEMBERS_YML = path.join(REPO_ROOT, '_data', 'org-members.yml');
const QR_SVG = path.join(REPO_ROOT, 'assets', 'img', 'program-qr.svg');
const LOGO_SVG = path.join(REPO_ROOT, 'assets', 'img', 'usrse26-long-logo.svg');
const SPONSOR_LOGOS = path.join(REPO_ROOT, 'assets', 'img', 'sponsor-logos');
const ORG_LOGOS = path.join(REPO_ROOT, 'assets', 'img', 'org-logos');
const OUT_HTML = path.join(REPO_ROOT, '_print', 'program.html');
const OUT_PDF = path.join(REPO_ROOT, 'pages', 'program', 'program.pdf');

const rel = (file) => path.relative(REPO_ROOT, file);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/**
 * "October 19–21, 2026" from two _config.yml stamps. The YYYY-MM-DD prefix
 * is read as a substring, never through a Date, for the reason TZ_OFFSET
 * gives in build-program.js: a Date would shift the day to the runner's zone.
 */
function dateRange(start, end) {
  const parse = (s, key) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) throw new Error(`_config.yml ${key} is not YYYY-MM-DD: "${s}"`);
    return { y: m[1], month: MONTHS[Number(m[2]) - 1], d: Number(m[3]) };
  };
  const a = parse(start, 'conf_start_date');
  const b = parse(end, 'conf_end_date');
  if (a.y !== b.y) return `${a.month} ${a.d}, ${a.y}–${b.month} ${b.d}, ${b.y}`;
  if (a.month !== b.month) return `${a.month} ${a.d}–${b.month} ${b.d}, ${b.y}`;
  if (a.d === b.d) return `${a.month} ${a.d}, ${a.y}`;
  return `${a.month} ${a.d}–${b.d}, ${b.y}`;
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/** The committed schedule; same failure wording as build-program.js --from-json. */
function readProgram() {
  if (!fs.existsSync(PROGRAM_JSON)) {
    throw new Error(`${rel(PROGRAM_JSON)} does not exist.`);
  }
  const program = JSON.parse(fs.readFileSync(PROGRAM_JSON, 'utf8'));
  if (!Array.isArray(program.days) || !program.days.length) {
    throw new Error('program.json has no days — refusing to write empty files.');
  }
  return program;
}

/**
 * The General Chairs' letter: { placeholder, bodyMd }, or null when the file
 * is absent (the page is then omitted). Front matter is a leading ---/---
 * block; only "placeholder: true" is read from it.
 */
function readWelcome() {
  if (!fs.existsSync(WELCOME_MD)) {
    console.warn(`warning: ${rel(WELCOME_MD)} not found — omitting the welcome page`);
    return null;
  }
  const text = fs.readFileSync(WELCOME_MD, 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  const placeholder = !!fm && /^placeholder:[ \t]*true[ \t]*$/m.test(fm[1]);
  if (placeholder) {
    console.warn(`warning: welcome letter is still the placeholder (${rel(WELCOME_MD)})`);
  }
  return { placeholder, bodyMd: fm ? text.slice(fm[0].length) : text };
}

/**
 * The committee tree from organization.md: { title, depth, members, children }
 * per ##–#### heading, list items as members. Front matter, Liquid lines,
 * the "## Contact" section and prose are skipped; empty groups are pruned.
 */
function readCommittee() {
  const lines = fs.readFileSync(ORG_MD, 'utf8').split(/\r?\n/);
  const root = { title: '', depth: 1, members: [], children: [] };
  const stack = [root];
  let skipping = false;
  let i = 0;
  if (/^---\s*$/.test(lines[0])) {
    i = lines.findIndex((l, k) => k > 0 && /^---\s*$/.test(l)) + 1;
  }
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('{{') || line.includes('{%')) continue;
    const h = /^(#{2,4})\s+(.*?)\s*$/.exec(line);
    if (h) {
      const depth = h[1].length;
      if (depth === 2) skipping = h[2] === 'Contact';
      if (skipping) continue;
      while (stack[stack.length - 1].depth >= depth) stack.pop();
      const node = { title: mdToText(h[2]), depth, members: [], children: [] };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
      continue;
    }
    if (skipping) continue;
    const item = /^\s*[*-]\s+(.*)$/.exec(line);
    if (item && stack.length > 1) stack[stack.length - 1].members.push(mdToText(item[1]));
  }
  const prune = (node) => {
    node.children = node.children.filter(prune);
    return node.members.length > 0 || node.children.length > 0;
  };
  prune(root);
  if (!root.children.length) throw new Error(`${rel(ORG_MD)} has no committee members`);
  return root.children;
}

/**
 * Sponsor tiers from index.html: [{ title, logos: [{ file, alt }] }], in page
 * order. Only the region from the "Conference Sponsors" heading to the next
 * section header (or <h1>) is scanned, so later <h3>s are never tiers.
 */
function readSponsors() {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const at = html.indexOf('Conference Sponsors');
  if (at < 0) throw new Error(`${rel(INDEX_HTML)} has no sponsor tiers`);
  const rest = html.slice(at);
  const ends = [rest.indexOf('class="sectionheader"'), rest.indexOf('<h1')].filter((n) => n >= 0);
  const region = ends.length ? rest.slice(0, Math.min(...ends)) : rest;
  const tiers = [];
  const re = /<h[34][^>]*>([^<]+)<\/h[34]>|\{%\s*include\s+add-sponsor-logo\.html\b([^%]*)%\}/g;
  for (let m; (m = re.exec(region));) {
    if (m[1] !== undefined) {
      tiers.push({ title: oneLine(m[1]), logos: [] });
      continue;
    }
    const attrs = {};
    for (const a of m[2].matchAll(/(\w+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    if (tiers.length) tiers[tiers.length - 1].logos.push({ file: attrs.logo_file || '', alt: attrs.logo_alt || '' });
  }
  const kept = tiers.filter((t) => t.logos.length);
  if (!kept.length) throw new Error(`${rel(INDEX_HTML)} has no sponsor tiers`);
  for (const logo of kept.flatMap((t) => t.logos)) {
    const file = path.join(SPONSOR_LOGOS, logo.file);
    if (!logo.file || !fs.existsSync(file)) throw new Error(`sponsor logo not found: ${rel(file)}`);
    logo.path = file;
  }
  return kept;
}

const ORG_LEVELS = [['premier', 'Premier'], ['standard', 'Standard'], ['basic', 'Basic']];
const ORG_FIELDS = new Set(['name', 'figure', 'acronym', 'date_joined', 'background']);

/** A YAML scalar the readJekyllConfig way: quotes kept verbatim, else no " # comment". */
function yamlScalar(raw) {
  const quoted = /^(["'])([\s\S]*)\1[ \t]*(?:#.*)?$/.exec(raw);
  return quoted ? quoted[2] : raw.replace(/(^|[ \t]+)#.*$/, '').trim();
}

/**
 * Organizational founding members (PR #63), or null when the file is absent.
 * A line parser for exactly that file's shape — top-level level keys, each a
 * list of flat "key: value" maps — not YAML in general; anything else throws.
 * A repeated level key keeps the last one, as Jekyll's loader does. Only
 * ORG_FIELDS survive, so contacts never reach the renderer.
 */
function readOrgMembers() {
  if (!fs.existsSync(ORG_MEMBERS_YML)) return null;
  const levels = new Map();
  let list = null;
  let item = null;
  let itemIndent = -1;
  fs.readFileSync(ORG_MEMBERS_YML, 'utf8').split(/\r?\n/).forEach((line, n) => {
    const fail = () => { throw new Error(`org-members.yml line ${n + 1}: unsupported YAML`); };
    if (/^\s*(#.*)?$/.test(line)) return;
    let m;
    if ((m = /^([A-Za-z_][\w-]*):[ \t]*(?:#.*)?$/.exec(line))) {
      if (levels.has(m[1])) console.warn(`warning: org-members.yml repeats key "${m[1]}" — using the last one`);
      list = [];
      levels.set(m[1], list);
      item = null;
      return;
    }
    let indent;
    let rest;
    if (list && (m = /^(\s+)-[ \t]+(\S.*)$/.exec(line))) {
      item = {};
      list.push(item);
      itemIndent = m[1].length + 2;
      [indent, rest] = [itemIndent, m[2]];
    } else if (item && (m = /^(\s+)(\S.*)$/.exec(line))) {
      [indent, rest] = [m[1].length, m[2]];
    } else {
      fail();
    }
    const kv = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/.exec(rest);
    if (indent !== itemIndent || !kv) fail();
    const value = yamlScalar(kv[2] || '');
    if (/^[|>[{&*!]/.test(value) && !/^["']/.test(kv[2] || '')) fail();
    if (ORG_FIELDS.has(kv[1])) item[kv[1]] = value;
  });
  return ORG_LEVELS.map(([key, title]) => {
    const members = (levels.get(key) || []).slice()
      .sort((a, b) => String(a.date_joined || '').localeCompare(String(b.date_joined || '')));
    for (const mem of members) {
      const file = path.join(ORG_LOGOS, mem.figure || '');
      if (!mem.figure || !fs.existsSync(file)) throw new Error(`org member logo not found: ${rel(file)}`);
      mem.path = file;
      if (mem.background && !/^(#[0-9a-f]{3,8}|rgba?\([\d.,\s]+\))$/i.test(mem.background)) {
        console.warn(`warning: org-members.yml background "${mem.background}" for ${mem.name} is not a color — dropped`);
        mem.background = '';
      }
    }
    return { title, members };
  }).filter((level) => level.members.length);
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** Collapse whitespace so a value can occupy a single line (build-program.js). */
function oneLine(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/**
 * The inline Markdown subset the printed program needs. Links keep only
 * their text: paper has nothing to click. `code` loses its backticks.
 * `wrap(tag, text)` decides the output: HTML tags, or bare text.
 */
function mdApply(s, wrap) {
  return s
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1')
    .replace(/`([^`]+)`/g, (_, t) => wrap('code', t))
    .replace(/\*\*(.+?)\*\*/g, (_, t) => wrap('strong', t))
    .replace(/\*(.+?)\*/g, (_, t) => wrap('em', t))
    .replace(/(^|[^\w])_(.+?)_(?!\w)/g, (_, pre, t) => pre + wrap('em', t));
}

/** Trusted inline Markdown -> HTML; everything is escaped first. */
function mdInline(md) {
  return mdApply(esc(md), (tag, t) => `<${tag}>${t}</${tag}>`);
}

/** Inline Markdown -> one line of plain text (still unescaped). */
function mdToText(md) {
  return oneLine(mdApply(String(md == null ? '' : md), (_, t) => t));
}

/** Blank-line-separated paragraphs -> <p> lines. */
function mdParagraphs(md) {
  return String(md).trim().split(/\r?\n[ \t]*\r?\n/)
    .filter((p) => p.trim())
    .map((p) => `<p>${mdInline(oneLine(p))}</p>`);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Copied from build-program.js. */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Repo file -> src relative to _print/program.html. */
function src(file) {
  return esc(path.relative(path.dirname(OUT_HTML), file).split(path.sep).join('/'));
}

function renderCover() {
  const lines = [
    '<section class="page cover">',
    `  <img class="cover__logo" src="${src(LOGO_SVG)}" alt="${esc(CONF.title)}">`,
    `  <h1 class="cover__theme">${esc(CONF.theme)}</h1>`,
    `  <p class="cover__where">${esc(CONF.location)} · ${esc(dateRange(CONF.start, CONF.end))}</p>`,
    '  <div class="cover__band">',
    '    <div class="cover__cell cover__qr">',
    `      <img src="${src(QR_SVG)}" alt="QR code for the online program">`,
    '      <div>',
    '        <p class="cover__label">Full program details and abstracts</p>',
    `        <p class="cover__url">${esc(SITE_BASE + 'program/')}</p>`,
    '      </div>',
    '    </div>',
  ];
  if (CONF.wifiSsid) {
    lines.push(
      '    <div class="cover__cell cover__wifi">',
      '      <p class="cover__label">Wi-Fi</p>',
      `      <p>Network: <b>${esc(CONF.wifiSsid)}</b></p>`,
    );
    if (CONF.wifiPassword) lines.push(`      <p>Password: <b>${esc(CONF.wifiPassword)}</b></p>`);
    lines.push('    </div>');
  }
  lines.push('  </div>', '</section>');
  return lines.join('\n');
}

// The Code of Conduct report address, as published in
// pages/about/code-of-conduct.md:14.
const COC_EMAIL = 'coc@us-rse.org';

function renderWelcome(welcome) {
  return [
    '<section class="page welcome">',
    '  <h1>Welcome!</h1>',
    ...mdParagraphs(welcome.bodyMd).map((p) => `  ${p}`),
    '  <hr>',
    '  <div class="welcome__notice">',
    '    <p>All conference participants are expected to abide by the Code of'
      + ' Conduct. Please report problems or concerns to'
      + ` <b>${esc(COC_EMAIL)}</b>.</p>`,
    `    <p>${esc(SITE_BASE + 'about/code-of-conduct/')}</p>`,
    `    <p>Full program details and conference policies: ${esc(SITE_BASE)}</p>`,
    '  </div>',
    '</section>',
  ].join('\n');
}

// Single-event formats the overview names before the talk title. A copy of
// FORMATS[*].pageTitle in build-program.js, keyed the same way.
const FORMAT_LABELS = {
  'keynote': 'Keynote',
  'workshop': 'Workshop',
  'bird of a feather': 'Birds of a Feather',
  'student': 'Student & Early Career',
};

/** Same key normalization as build-program.js normalizeFormat (trim + lowercase). */
function normalizeFormat(raw) {
  return String(raw || '').trim().toLowerCase();
}

/** "10:30–11:30am" — fmtRange's rule, as plain text: drop a shared meridiem. */
function textRange(slot) {
  const start = slot.start.slice(-2) === slot.end.slice(-2) ? slot.start.slice(0, -2) : slot.start;
  return `${start}–${slot.end}`;
}

/** Session chairs, abstracts and speakers of talk sessions stay online only. */
function renderOverviewSession(session) {
  const head = `<p class="s__head"><b>${esc(session.title)}</b>`
    + (session.room ? `, <i>${esc(session.room)}</i>` : '') + '</p>';
  if (session.muted) return [head];
  const lines = [head];
  const talks = session.talks || [];
  const info = mdToText(session.info);
  if (info) lines.push(`<p class="info">${esc(info)}</p>`);
  const label = talks.length === 1 ? FORMAT_LABELS[normalizeFormat(talks[0].format)] : undefined;
  if (label) {
    lines.push(`<p class="s__single"><b>${esc(label)}:</b> ${esc(mdToText(talks[0].title))}</p>`);
    const speakers = mdToText(talks[0].speakers);
    if (speakers) lines.push(`<p class="s__speakers">${esc(speakers)}</p>`);
  } else if (talks.length) {
    lines.push('<ul>', ...talks.map((t) => `  <li>${esc(mdToText(t.title))}</li>`), '</ul>');
  }
  return lines;
}

/** One flat list of rows for the paginator to place one at a time. */
function renderSchedule(days) {
  const lines = [
    '<div class="flow" data-flow="schedule">',
    '  <div class="row row--intro">',
    '    <h1>Schedule Overview</h1>',
    '    <p class="note">Full abstracts and presenter names are in the online program:'
      + ` <b>${esc(SITE_BASE + 'program/')}</b></p>`,
    '  </div>',
  ];
  days.forEach((day, d) => {
    const heading = `${day.weekday}, ${day.label}`;
    lines.push(`  <div class="row row--day" data-day="${esc(heading)}"><h2 class="day">${esc(heading)}</h2></div>`);
    day.slots.forEach((slot, i) => {
      const time = textRange(slot);
      slot.sessions.forEach((session, k) => {
        const cls = ['row', 'row--session'];
        if (session.muted) cls.push('row--muted');
        if (k === 0) cls.push('row--first');
        lines.push(
          `  <div class="${cls.join(' ')}" data-day="${esc(heading)}" data-slot="s-${d}-${i}"`
            + ` data-time="${esc(time)}"${k === 0 ? ' data-first="1"' : ''}>`,
          `    <div class="time">${k === 0 ? esc(time) : ''}</div>`,
          '    <div class="body">',
          ...renderOverviewSession(session).map((l) => `      ${l}`),
          '    </div>',
          '  </div>',
        );
      });
    });
  });
  lines.push('</div>');
  return lines.join('\n');
}

function renderCommitteeNode(node, pad) {
  const lines = [`${pad}<div class="group group--d${node.depth}">`,
    `${pad}  <h${node.depth}>${esc(node.title)}</h${node.depth}>`];
  if (node.members.length) {
    lines.push(`${pad}  <ul>`, ...node.members.map((m) => `${pad}    <li>${esc(m)}</li>`), `${pad}  </ul>`);
  }
  for (const child of node.children) lines.push(...renderCommitteeNode(child, `${pad}  `));
  lines.push(`${pad}</div>`);
  return lines;
}

/** Back-matter flow: one row per top-level group, so groups stay whole. */
function renderCommittee(tree) {
  const lines = [
    '<div class="flow" data-flow="back">',
    '  <div class="row row--intro"><h1>Organizing Committee</h1></div>',
  ];
  for (const node of tree) {
    lines.push('  <div class="row row--committee">', ...renderCommitteeNode(node, '    '), '  </div>');
  }
  lines.push('</div>');
  return lines.join('\n');
}

// Logo height per sponsor tier, first tier largest; later tiers use the last.
const TIER_HEIGHTS = ['0.65in', '0.55in', '0.45in', '0.4in', '0.35in'];

const ORG_HEIGHTS = { Premier: '0.4in', Standard: '0.32in', Basic: '0.3in' };

function renderSponsors(sponsors, orgMembers) {
  const lines = ['<section class="page sponsors">', '  <h1>Thank You Sponsors!</h1>'];
  sponsors.forEach((tier, i) => {
    const h = TIER_HEIGHTS[Math.min(i, TIER_HEIGHTS.length - 1)];
    lines.push(
      '  <section class="tier">',
      `    <h3>${esc(tier.title)}</h3>`,
      '    <div class="logos">',
      ...tier.logos.map((l) => `      <img src="${src(l.path)}" alt="${esc(l.alt)}" style="height:${h}">`),
      '    </div>',
      '  </section>',
    );
  });
  if (orgMembers) {
    lines.push('  <h2>US-RSE Organizational Founding Members</h2>');
    for (const level of orgMembers) {
      lines.push('  <section class="tier tier--org">', `    <h3>${esc(level.title)}</h3>`, '    <div class="logos">');
      for (const mem of level.members) {
        const alt = mem.acronym ? `${mem.name} (${mem.acronym})` : mem.name;
        const bg = mem.background ? ` style="background:${esc(mem.background)}"` : '';
        lines.push(`      <span class="tile"${bg}><img src="${src(mem.path)}" alt="${esc(alt || '')}"`
          + ` style="height:${ORG_HEIGHTS[level.title]}"></span>`);
      }
      lines.push('    </div>', '  </section>');
    }
  }
  lines.push(`  <p class="sponsors__footer">${esc(SITE_BASE)}</p>`, '</section>');
  return lines.join('\n');
}

/**
 * In-page paginator, emitted verbatim. Chrome runs it before printing (the
 * --virtual-time-budget lets it finish), and it runs in an ordinary browser
 * too, so the HTML can be checked on screen. It moves each .flow's rows onto
 * fixed Letter .page boxes: a row never splits, a day heading never ends a
 * page, and a page break inside a day repeats the heading with ", continued"
 * (and "continued" in the time column when the break falls inside a slot) —
 * what CSS alone cannot do. Rows taller than a page, and fixed pages whose
 * content overflows, are counted in <html data-overflow>.
 */
const PAGINATOR_JS = `
(function () {
  'use strict';
  var overflow = 0;
  function over(el) { return el.scrollHeight > el.clientHeight + 1; }
  function newPage(flow) {
    var page = document.createElement('section');
    page.className = 'page page--flow page--' + flow.dataset.flow;
    var content = document.createElement('div');
    content.className = 'content';
    page.appendChild(content);
    flow.parentNode.insertBefore(page, flow);
    return content;
  }
  function continuedHeading(day) {
    var row = document.createElement('div');
    row.className = 'row day-continued';
    var h = document.createElement('h2');
    h.className = 'day';
    h.textContent = day + ', continued';
    row.appendChild(h);
    return row;
  }
  function paginate(flow) {
    var rows = Array.prototype.slice.call(flow.children);
    var content = newPage(flow);
    rows.forEach(function (row) {
      content.appendChild(row);
      if (!over(content) || content.children.length === 1) {
        if (over(content)) overflow++;
        return;
      }
      content.removeChild(row);
      var last = content.lastElementChild;
      var carried = last && last.classList.contains('row--day') ? last : null;
      if (carried) content.removeChild(carried);
      content = newPage(flow);
      if (carried) {
        content.appendChild(carried);
      } else if (row.classList.contains('row--session')) {
        content.appendChild(continuedHeading(row.dataset.day));
        if (!row.dataset.first) {
          var time = row.querySelector('.time');
          time.textContent = row.dataset.time;
          time.appendChild(document.createElement('br'));
          var i = document.createElement('i');
          i.textContent = 'continued';
          time.appendChild(i);
        }
      }
      content.appendChild(row);
      if (over(content)) overflow++;
    });
    flow.parentNode.removeChild(flow);
  }
  function run() {
    var root = document.documentElement;
    if (root.dataset.paginated) return;
    Array.prototype.slice.call(document.querySelectorAll('.flow')).forEach(paginate);
    Array.prototype.forEach.call(document.querySelectorAll('.page:not(.page--flow)'), function (p) {
      if (over(p)) overflow++;
    });
    root.dataset.overflow = String(overflow);
    root.dataset.paginated = 'true';
  }
  function loaded(img) {
    return img.complete ? Promise.resolve() : new Promise(function (resolve) {
      img.addEventListener('load', resolve);
      img.addEventListener('error', resolve);
    });
  }
  document.addEventListener('DOMContentLoaded', function () {
    var imgs = Array.prototype.map.call(document.images, loaded);
    Promise.all([document.fonts ? document.fonts.ready : null].concat(imgs)).then(run);
  });
})();
`;

const BANNER = '<!-- Generated by scripts/build-program-pdf.js — do not edit -->';

const CSS = `
@page { size: letter; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: #fff; color: #1a1a1a; font: 9.5pt/1.35 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 8.5in; height: 11in; padding: 0.6in 0.65in; overflow: hidden; break-after: page; position: relative; }
.cover { display: flex; flex-direction: column; justify-content: center; text-align: center; }
.cover__logo { width: 100%; height: auto; margin-bottom: 0.6in; }
.cover__theme { font-size: 28pt; line-height: 1.15; margin: 0 0 0.25in; color: #C16531; }
.cover__where { font-size: 16pt; margin: 0 0 0.8in; }
.cover__band { display: flex; justify-content: center; gap: 0.5in; background: #C16531; color: #fff; padding: 0.3in; border-radius: 6px; text-align: left; }
.cover__cell p { margin: 0 0 4pt; font-size: 12pt; }
.cover__qr { display: flex; align-items: center; gap: 0.2in; }
.cover__qr img { width: 1.3in; height: 1.3in; background: #fff; padding: 4px; }
.cover__label { font-weight: 700; font-size: 13pt !important; }
.cover__url { font-size: 11pt !important; word-break: break-all; }
.welcome h1 { font-size: 26pt; color: #C16531; margin: 0 0 0.25in; }
.welcome p { font-size: 11pt; line-height: 1.5; margin: 0 0 9pt; }
.welcome hr { border: 0; border-top: 1px solid #C16531; margin: 0.3in 0 0.2in; }
.welcome__notice p { font-size: 9pt; line-height: 1.4; margin: 0 0 5pt; }
.page h1 { font-size: 20pt; color: #C16531; margin: 0 0 6pt; }
.row--intro .note { margin: 0 0 8pt; color: #444; }
.day { font-size: 13pt; margin: 0; padding: 10pt 0 3pt; border-bottom: 1.5px solid #C16531; color: #C16531; }
.row--session { display: grid; grid-template-columns: 1.05in 1fr; column-gap: 0.15in; padding: 4pt 0; }
.row--session.row--first { border-top: 0.5px solid #ccc; }
.row--day + .row--session.row--first, .day-continued + .row--session.row--first { border-top: 0; }
.row--session .time { font-weight: 700; white-space: nowrap; }
.row--session p { margin: 0; }
.row--session .info, .row--session .s__speakers { color: #444; font-size: 8.5pt; }
.row--session ul { margin: 1pt 0 0; padding-left: 12pt; }
.row--session li { margin: 0; }
.row--muted { color: #555; padding: 2pt 0; }
.page--flow .content { height: 100%; overflow: hidden; }
.flow { width: 8.5in; padding: 0 0.65in; }
.row--committee { columns: 2; column-gap: 0.35in; padding-top: 6pt; }
.row--committee h2 { column-span: all; font-size: 13pt; color: #C16531; margin: 6pt 0 4pt; padding-bottom: 2pt; border-bottom: 1.5px solid #C16531; }
.row--committee h3 { font-size: 11pt; margin: 6pt 0 2pt; }
.row--committee h4 { font-size: 10pt; margin: 4pt 0 2pt; color: #444; }
.row--committee .group--d3, .row--committee .group--d4 { break-inside: avoid; }
.row--committee ul { list-style: none; margin: 0 0 6pt; padding: 0; }
.row--committee li { margin: 0 0 1pt; }
.sponsors { display: flex; flex-direction: column; text-align: center; }
.sponsors h1 { margin-bottom: 0.15in; }
.sponsors .tier { margin: 0 0 0.14in; }
.sponsors .tier h3 { font-variant: small-caps; letter-spacing: 0.05em; font-size: 12pt; color: #555; margin: 0 0 6pt; }
.sponsors .logos { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 0.15in 0.25in; }
.sponsors .logos img { max-width: 1.55in; object-fit: contain; }
.sponsors__footer { margin-top: auto; font-weight: 700; }
.sponsors h2 { font-size: 13pt; color: #C16531; margin: 0.1in 0 0.12in; padding-top: 0.12in; border-top: 1px solid #C16531; }
.sponsors .tier--org { margin-bottom: 0.12in; }
.sponsors .tier--org .logos { gap: 0.1in 0.2in; }
.sponsors .tile { display: inline-flex; align-items: center; padding: 3pt 6pt; border-radius: 3px; }
.sponsors .tile img { max-width: 1.3in; object-fit: contain; }
@media screen { body { background: #888; } .page { background: #fff; margin: 0.25in auto; box-shadow: 0 1px 6px rgba(0,0,0,.3); } }
`;

function renderDocument({ program, welcome, committee, sponsors, orgMembers }) {
  return [
    BANNER,
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${esc(CONF.title)} Program</title>`,
    `<style>${CSS}</style>`,
    '</head>',
    '<body>',
    renderCover(),
    ...(welcome ? [renderWelcome(welcome)] : []),
    renderSchedule(program.days),
    renderCommittee(committee),
    renderSponsors(sponsors, orgMembers),
    `<script>${PAGINATOR_JS}</script>`,
    '</body>',
    '</html>',
  ].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Copied from build-program.js; returns true when it wrote. */
function writeIfChanged(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) {
    console.log(`  unchanged  ${rel(file)}`);
    return false;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log(`  wrote      ${rel(file)}`);
  return true;
}

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];
const CHROME_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

/** CHROME_PATH, else a standard macOS install, else a PATH lookup; null if none. */
function findChrome() {
  if (process.env.CHROME_PATH) {
    if (!fs.existsSync(process.env.CHROME_PATH)) {
      throw new Error(`CHROME_PATH does not exist: ${process.env.CHROME_PATH}`);
    }
    return process.env.CHROME_PATH;
  }
  const found = CHROME_CANDIDATES.find((c) => fs.existsSync(c));
  if (found) return found;
  for (const name of CHROME_NAMES) {
    try {
      const p = execFileSync('which', [name], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (p) return p;
    } catch {
      // not on PATH
    }
  }
  return null;
}

// --virtual-time-budget lets the paginator finish before Chrome prints or dumps.
const CHROME_FLAGS = ['--headless=new', '--disable-gpu', '--no-sandbox',
  '--virtual-time-budget=10000', '--allow-file-access-from-files'];

function runChrome(chrome, args) {
  try {
    return execFileSync(chrome, [...CHROME_FLAGS, ...args],
      { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const first = String(err.stderr || err.message).split('\n').find((l) => l.trim()) || 'unknown error';
    throw new Error(`Chrome failed to print: ${first.trim()}`);
  }
}

/** Print to a temp file beside the target, then rename: no truncated PDFs. */
function renderPdf(chrome, htmlFile, pdfFile) {
  const tmp = `${pdfFile}.tmp`;
  fs.rmSync(tmp, { force: true });
  try {
    runChrome(chrome, ['--no-pdf-header-footer', '--print-to-pdf-no-header',
      `--print-to-pdf=${tmp}`, pathToFileURL(htmlFile).href]);
    if (!fs.existsSync(tmp)) throw new Error('Chrome failed to print: no PDF written');
    fs.renameSync(tmp, pdfFile);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  console.log(`  wrote      ${rel(pdfFile)}`);
}

/** Chrome's CLI reports no page count, so count page objects in its PDF. */
function pdfPageCount(pdfFile) {
  return (fs.readFileSync(pdfFile).toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

/** The paginator's data-overflow, from a --dump-dom of the same HTML. */
function overflowCount(chrome, htmlFile) {
  const dom = runChrome(chrome, ['--dump-dom', pathToFileURL(htmlFile).href]).toString();
  const m = /<html[^>]*\bdata-overflow="(\d+)"/.exec(dom);
  return m ? Number(m[1]) : null;
}

async function main() {
  const program = readProgram();
  for (const file of [QR_SVG, LOGO_SVG]) {
    if (!fs.existsSync(file)) {
      throw new Error(`${file === QR_SVG ? 'QR code' : 'logo'} not found: ${rel(file)}`);
    }
  }
  const welcome = readWelcome();
  const committee = readCommittee();
  const sponsors = readSponsors();
  const orgMembers = readOrgMembers();
  writeIfChanged(OUT_HTML, renderDocument({ program, welcome, committee, sponsors, orgMembers }));
  if (process.argv.includes('--html-only')) return;

  const chrome = findChrome();
  if (!chrome) {
    throw new Error(`no Chrome/Chromium found — wrote ${rel(OUT_HTML)}; set CHROME_PATH to render the PDF`);
  }
  // mtime, not writeIfChanged's flag: a run that wrote the HTML and then
  // failed before the PDF must still render next time.
  const stale = process.argv.includes('--force') || !fs.existsSync(OUT_PDF)
    || fs.statSync(OUT_PDF).mtimeMs < fs.statSync(OUT_HTML).mtimeMs;
  if (!stale) {
    console.log(`  unchanged  ${rel(OUT_PDF)}`);
    return;
  }
  fs.mkdirSync(path.dirname(OUT_PDF), { recursive: true });
  renderPdf(chrome, OUT_HTML, OUT_PDF);
  console.log(`${path.basename(OUT_PDF)}: ${pdfPageCount(OUT_PDF)} pages`);
  const overflow = overflowCount(chrome, OUT_HTML);
  if (overflow === null) {
    console.warn('warning: could not read the paginator result — check the PDF layout by eye');
  } else if (overflow > 0) {
    console.warn(`warning: ${overflow} page(s) or row(s) overflow and are clipped — trim content and rebuild`);
  }
}

main().catch((err) => {
  console.error(`build-program-pdf: ${err.message}`);
  process.exit(1);
});
