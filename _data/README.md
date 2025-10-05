# Navigation Bars

The file `navigation.yml` and all files under the `menu` directory
control the nagivation bar at the top of the website.

The standard, basic format for `navigation.yml` is:

```
- name: Participate
  link: participate/
  dropdown:
    - name: Call for Participation
      link: participate/
- name: Program
  dropdown:
    - name: Full Program
      link: program/
- name: Attend
  link: attend/
  dropdown:
    - name: Register
      link: attend/register/
    - name: Travel
      link: attend/travel/
    - name: COVID Policy
      link: attend/health/
- name: Organization
  link: organization/
  dropdown:
    - name: Overview
      link: organization/
- name: Sponsor
  link: sponsor/
- name: About
  link: about/
  dropdown:
    - name: Important Dates
      link: about/dates/
    - name: Code of Conduct
      link: about/code-of-conduct/
```

The `menu` files are named appropriately for the menu they are meant to
represent (e.g., `about.yml`, `attend.yml`), and they should exactly match
the corresponding section within the `navigation.yml` file. For example,
based on the standard format above, `about.yml` would look like this:

```
- label: About
  items:
    - name: Important Dates
      link: about/dates/
    - name: Code of Conduct
      link: about/code-of-conduct/
```

If you'd like to have the structure for menus but not yet have them active,
you can put your `*.yml` file in the `menus/hidden` directory.
