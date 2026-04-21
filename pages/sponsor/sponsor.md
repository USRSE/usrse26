---
layout: page
title: Sponsor
description:
menubar: sponsor
permalink: sponsor/
menubar_toc: true
set_last_modified: true
---

## Introduction

Dear Prospective USRSE'26 Conference Sponsor,

We are delighted to invite you to join us for the United States Research
Software Engineer (USRSE) Conference!

The US-RSE Association is the leading professional community of research
software engineering practitioners in the United States. Our members are
dedicated to creating research software that is sustainable, reliable, and
impactful across disciplines.

As a sponsor, you will connect with a highly skilled and engaged audience of
research software engineers, developers, and technical leaders from academia,
national labs, and industry.

For our conference in October 19-21, 2026, in San Jose, CA, we anticipate
approximately 300 attendees and a growing, vibrant community.
Sponsorship provides a unique opportunity to support this important field while
increasing your organization's visibility and recruitment reach.

---

## Demographics

Our attendees span a wide range of domains including physics, life sciences,
engineering, geosciences, and more. Participants include students,
early-career professionals, and senior leaders.

We expect:
- ~300 in-person attendees
- Representation from academia, national labs, and industry
- Nationwide and international participation
- Social media presence
  - Slack: 3400+ | X/Twitter: 2600+ | Mastodon: 400+ | LinkedIn: 1100+


<div class="sponsor-carousel">
  <div class="carousel-track">
    {% for image in site.static_files %}
      {% if image.path contains '/assets/img/sponsors/' %}
        <img src="{{ image.path | relative_url }}" alt="USRSE sponsor engagement">
      {% endif %}
    {% endfor %}
  </div>
  <button class="carousel-btn prev" aria-label="Previous image">&#8249;</button>
  <button class="carousel-btn next" aria-label="Next image">&#8250;</button>
</div>

<script>
const track = document.querySelector('.carousel-track');
const imgs = track.querySelectorAll('img');
let current = 0;

function goTo(n) {
  current = (n + imgs.length) % imgs.length;
  track.style.transform = `translateX(-${current * 100}%)`;
}

document.querySelector('.next').addEventListener('click', () => goTo(current + 1));
document.querySelector('.prev').addEventListener('click', () => goTo(current - 1));

setInterval(() => goTo(current + 1), 4000);
</script>


---

## Sponsorship Levels

<table class="tg">
<thead>
  <tr>
    <th><strong>Level</strong></th>
    <th><strong>Platinum</strong></th>
    <th><strong>Gold</strong></th>
    <th><strong>Silver</strong></th>
    <th><strong>Bronze</strong></th>
  </tr>
</thead>
<tbody>
  <tr>
    <td></td>
    <td colspan="4"><center><strong>Corporate / National Labs / Universities, Non-Profits, & Small* Corporate</strong></center></td>
  </tr>
  <tr>
    <td><strong>Price</strong></td>
    <td>$15K / $10K / $5K</td>
    <td>$11K / $8K / $3.5K</td>
    <td>$5.5K / $4K / $2K</td>
    <td>$2.5K / $1.5K / $900</td>
  </tr>
  <tr>
    <td rowspan="9"><strong>Features</strong></td>
    <td>3 Conference registrations</td>
    <td>2 Conference registrations</td>
    <td>1 Conference registration</td>
    <td></td>
  </tr>
  <tr>
    <td>Brief talk (3–5 min) at keynote sponsor session</td>
    <td>Brief talk (3–5 min) at keynote sponsor session</td>
    <td>Acknowledged at keynote sponsor session</td>
    <td>Acknowledged at keynote sponsor session</td>
  </tr>
  <tr>
    <td>High-visibility recruitment/exhibition table</td>
    <td>High-visibility recruitment/exhibition table</td>
    <td></td>
    <td></td>
  </tr>
  <tr>
    <td>Job Fair Participation, included</td>
    <td>Job Fair Participation, discounted rate</td>
    <td></td>
    <td></td>
  </tr>
  <tr>
    <td>Name and logo on website and program</td>
    <td>Name and logo on website and program</td>
    <td>Name and logo on website and program</td>
    <td>Name and logo on website and program</td>
  </tr>
  <tr>
    <td>Email to attendee list (on sponsor's behalf)</td>
    <td>Email to attendee list (on sponsor's behalf)</td>
    <td></td>
    <td></td>
  </tr>
  <tr>
    <td>Opt-in attendee contact list access</td>
    <td>Opt-in attendee contact list access</td>
    <td>Opt-in attendee contact list access</td>
    <td>Opt-in attendee contact list access</td>
  </tr>
  <tr>
    <td>Lunch & Learn option (additional fee)</td>
    <td>Lunch & Learn option (additional fee)</td>
    <td>Lunch & Learn option (additional fee)</td>
    <td></td>
  </tr>
  <tr>
    <td>Sponsored session/workshop option</td>
    <td></td>
    <td></td>
    <td></td>
  </tr>
  <tr>
    <td><strong>Audience</strong></td>
    <td colspan="4" style="text-align:center">
    Slack: 3400+ | X/Twitter: 2600+ | Mastodon: 400+ | LinkedIn: 1100+
    </td>
  </tr>
  <tr>
    <td></td>
    <td colspan="4" style="text-align:center">
    *Small corporate organizations are those with 20 or fewer employees
    </td>
  </tr>
</tbody>
</table>

---

## Job Fair Sponsorship

We are excited to introduce a **dedicated Job Fair** as part of the US-RSE Conference.

This event provides sponsors with a focused opportunity to connect with
attendees seeking career opportunities, including students,
early-career professionals, and experienced research software engineers.

### Participation Options

- **Included with Platinum sponsorship**
- **Gold sponsors** — discounted participation
- **All other sponsors / organizations** — *TBD pricing*

### Details

- Dedicated space during the conference
- High-visibility opportunity for recruiting and outreach
- Access to a highly qualified and specialized talent pool

> Note: Space is limited and will be allocated on a first-come, first-served basis.

---

## Event or Service Opportunities

Sponsors may support specific **conference events, services, and attendee experiences**.
These opportunities provide high-impact visibility while directly enhancing the conference.

> **Note:** Some pricing is still being finalized. [Contact us](mailto:sponsor-contact@us-rse.org) for details.

### Conference Events and Experiences

- **Conference Dinner / Signature Event**
- **Opening Reception**
- **Student Event / Mixer**
- **Student–Mentor Lunch / Offsite Experience**
- **Special Suite / Meeting Space**

### Attendee Services and Amenities

- **Coffee Breaks / Refreshments** — *TBD*
- **Conference Photographer** — *TBD*

### Student and Community Support

- **Student Sponsorship (per attendee)** — *~$2,000 / person*

Support the participation of students and early-career attendees and help broaden access to the conference.

---

## Promotional Opportunities

These opportunities are designed to maximize your organization's **brand visibility** and **presence** throughout the conference.

### On-Site Branding

- **Lanyards** — *TBD*
- **Conference Badges (Printing)** — *TBD*
- **Wayfinding Signage** — *TBD*
- **Printed Programs** — *TBD*

### Awards and Recognition

- **Best Poster Award** — $500
- **Best Paper Award** — $500
- **Best Rapid Access Microtalk (RAM) Award** — $500

Sponsors may provide prize funding, participate in award presentation, and receive recognition during the conference.

---

## Additional Custom Opportunities

We welcome creative collaborations. Sponsors may also:

- Provide branded swag for attendee bags
- Host off-site social events
- Sponsor informal networking gatherings
- Support student participation initiatives

If you have a unique idea, we're happy to work with you to design a custom sponsorship experience.

---

## Code of Conduct

All participants must follow the
[Code of Conduct](https://us-rse.org/about/code-of-conduct/).

---

## Terms and Conditions

1. Sponsorship fees are non-refundable
2. Benefits are first-come, first-served
3. Sponsors must provide materials on time
4. Organizers may modify packages if needed

---

## Contact Information

For any inquiries or questions about sponsorship opportunities, please get in
touch with us at <sponsor-contact@us-rse.org>. Our team will be happy to
provide you with more information and work with you to find the sponsorship
level that best fits your needs. Thank you for considering sponsoring the
USRSE Conference!
