---
layout: page
title: Full Program
description:
menubar: program
permalink: program/
set_last_modified: true
---

{% include scrolltop.html %}

<!-- Build-time stamp busts browser caches when the stylesheets change. -->
<link rel="stylesheet" href="{{ site.baseurl }}/assets/css/program.css?v={{ site.time | date: '%s' }}">
<link rel="stylesheet" href="{{ site.baseurl }}/assets/css/program-grid.css?v={{ site.time | date: '%s' }}">

Join us for engaging research presentations, two keynote speakers, and networking opportunities including our inaugural job fair. We'll feature a poster session, our rapid-access micro talks, early career events, and a US-RSE Working Group panel discussion; with complimentary daily lunch and community-building activities throughout.

Pending sponsorship, we're also planning a conference dinner and decision-maker panel. Interested in sponsoring? See our [sponsorship page]({{ '/sponsor/' | relative_url }}) for details.

All times are US Pacific (PDT).

{% include notification.html status='is-warning' message='**NOTE:** The program is not final and is subject to change.' %}

## Planning your schedule with an AI assistant

With four parallel tracks, picking between sessions takes a while. The whole
program is published as plain text for AI assistants, so you can hand it to
whichever one you use and ask it to build you a personal schedule.

Point your assistant at one of these:

- [`llms.txt`]({{ '/program/llms.txt' | relative_url }}) — every session and
  talk with times, rooms, presenters, what each session conflicts with, and
  links to the abstracts. Start here; it is the smaller file.
- [`llms-full.txt`]({{ '/program/llms-full.txt' | relative_url }}) — the same
  schedule with the full abstract text inlined, for matching sessions against
  your research interests.

For example: *"Fetch {{ '/program/llms-full.txt' | absolute_url }} and build
me a schedule for all three days. I work on HPC performance tooling and I care
most about anything on testing and reproducibility. Flag any conflicts and tell
me what I'd be giving up."*

Both files are regenerated whenever the schedule changes, so they stay current
with this page. The program is still subject to change, so re-fetch closer to
the conference rather than relying on a plan made months ahead.

<!-- List / Grid toolbar: hidden until program-view.js reveals it, so without
     JavaScript the page is the list alone. The grid include ships hidden
     for the same reason; the script swaps the two. -->
<div class="program-toolbar" hidden>
  <div class="program-toolbar__views" role="group" aria-label="Schedule view">
    <button type="button" class="program-toolbar__view" data-view="list" aria-pressed="true">List</button>
    <button type="button" class="program-toolbar__view" data-view="grid" aria-pressed="false">Grid</button>
  </div>
</div>

{% include program-schedule.html %}
{% include program-grid.html %}

<script src="{{ site.baseurl }}/assets/js/program-view.js" defer></script>
