---
layout: page
title: Plan Your Schedule with AI
description:
menubar: program
permalink: program/plan-with-ai/
set_last_modified: true
---

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
with the [full program]({{ '/program/' | relative_url }}). Re-fetch closer to
the conference in case anything shifts.
