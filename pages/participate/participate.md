---
layout: page
title: Participate
description:
menubar: participate
permalink: participate/
set_last_modified: true
---

## Call for Submissions

USRSE'26 is accepting submissions for all tracks for **in person** presentation at the conference with the aim of fostering a dynamic and varied technical program that will appeal to conference attendees from all RSE backgrounds. Beyond the core technical program, all conference participants will also have the opportunity to propose a Rapid Access Microtalk in person at the event (see below).

The theme of this year's conference is **"Advancing Science in the Age of AI"**. The Program Committee welcomes submissions directly engaged with this theme as well as topics connected to US-RSE in general.

Questions may be directed to the Technical Program chairs at [usrse26-tech-committee@us-rse.org](mailto:usrse26-tech-committee@us-rse.org)

## Submission Process

Submissions for all tracks (except Rapid Access Microtalks) will take place via the [USRSE'26 EasyChair website](https://easychair.org/conferences/?conf=usrse26).

### A note on AI usage

We recognize that AI, particularly generative AI, is a rapidly adopted yet frequently controversial tool among the RSE community. For any submission using AI-Generated Text/Large language models (LLM), refer to the "[Guidelines for Artificial Intelligence (AI)-Generated Text](https://journals.ieeeauthorcenter.ieee.org/become-an-ieee-journal-author/publishing-ethics/guidelines-and-policies/submission-and-peer-review-policies/#ai-generated-content)" section in IEEE Submission and Peer Review Policies for our community's policy.

## Review Process

All submissions are peer-reviewed for quality, relevance, and novelty, which will determine acceptance. Reviewers are expected to provide constructive feedback and maintain confidentiality and fairness throughout the review process. The final decision will be based on reviewer recommendations and program committee deliberations.

**Please note** *— if your Paper, Talk, Notebook, Birds of a Feather, or Workshop submission is rejected we would highly encourage you to consider submitting a Poster for an opportunity to engage with the community. The Poster deadline is intentionally after notification of acceptance or rejection for the other tracks. If your Poster submission is rejected then we would furthermore encourage you to participate in the event via the Rapid Access Microtalks opportunity if you are still interested and able to attend in person.*

### Volunteer to Review

You can volunteer as a reviewer by filling out this [Google Form](https://forms.gle/hDGsK52sJFqUA2MA7). A Reviewers' guide will be shared with reviewers for reference.

## Tracks

The following notes apply to all tracks:

- **There will be no extensions on the submission deadlines below.**
- All deadlines are 11:59 pm (anywhere on Earth).
- All submission types require a brief (&lt;300 word) statement on how the submission connects to the Mission, Goals, & Interests of the US-RSE Community.
- Presentation times are current expectations and may be adjusted based on submission volume and acceptance rates.

<div class="submission-tracks-grid">
{% for track in site.data.participate.tracks %}
  {% include submission-track-card.html track=track %}
{% endfor %}
</div>
