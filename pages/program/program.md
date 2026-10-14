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

**NOTE:** Sessions with 3 talks end earlier

<div class="program-links">
  <a class="btn" href="{{ '/program/plan-with-ai/' | relative_url }}">
    <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>&nbsp;Plan your schedule with AI
  </a>
  <a class="btn" href="{{ '/pages/program/venue-map.pdf' | relative_url }}" target="_blank" rel="noopener">
    <i class="fa-solid fa-map" aria-hidden="true"></i>&nbsp;View venue map (PDF)
  </a>
  <a class="btn" href="{{ '/pages/program/program.pdf' | relative_url }}" target="_blank" rel="noopener">
    <i class="fa-solid fa-file-pdf" aria-hidden="true"></i>&nbsp;View program as PDF
  </a>
</div>

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
