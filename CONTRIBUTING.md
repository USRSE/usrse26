# Contributing to US-RSE Conference 2026 Website

If you are comfortable working with forks, branches, and pull requests, please
follow the below guidance. If you are not, please reach out to the Outreach/Website
committee chairs:

- TBD

The general workflow for everyone interacting with the US-RSE Conference website
is described in the following.

## Contents

- [Contributing to US-RSE Conference 2026 Website](#contributing-to-us-rse-conference-2026-website)
  - [Contents](#contents)
  - [Introduction](#introduction)
    - [Forking](#forking)
    - [Keeping Your Fork Updated](#keeping-your-fork-updated)
  - [Creating Issues](#creating-issues)
    - [Markdown](#markdown)
  - [Working on Issues](#working-on-issues)
    - [When Work Begins](#when-work-begins)
    - [As Work Continues](#as-work-continues)
    - [When Work is Complete](#when-work-is-complete)
    - [Closing Old Issues](#closing-old-issues)
  - [Pull Requests](#pull-requests)
    - [Reviewers](#reviewers)
    - [Work-in-Progress](#work-in-progress)
    - [Merging](#merging)

## Introduction

We recommend using a `fork and branch` approach to contribution. In this method,
you will create a personal fork of the main US-RSE Conference repository,
make your changes locally in your own branches, and then open pull
requests to merge changes back into the main repository.

[↑ Contents](#contents)

### Forking

To create a fork, go to the [main repository](https://github.com/USRSE/usrse26)
and click the `Fork` button in the top-right. You can choose under what username
or organization the fork is made; we recommend your personal account.

After it's creation, you will now have a local fork of the repository.

See [GitHub's Documentation](https://docs.github.com/en/get-started/quickstart/fork-a-repo)
for more details.

[↑ Contents](#contents)

### Keeping Your Fork Updated

After your fork is created, you will need to make sure it stays up-to-date to
avoid conflicts when you make changes.

See [GitHub's Documentation](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork)
for the various ways to keep your fork in sync.

[↑ Contents](#contents)

## Creating Issues

[Create issues in GitHub](https://github.com/USRSE/usrse26/issues)
for any work that needs to be done. This can include, but is not limited to:

- Bugs
- Enhancements
- Discussions

[↑ Contents](#contents)


### Markdown

[Markdown](https://en.wikipedia.org/wiki/Markdown) is a lightweight markup
language with plain text formatting syntax.  GitHub uses a form of it for
rendering issue and pull request descriptions and comments, wiki pages, and
any files in your repositories with a `.md` extension (such as this one).  For
more details on what's possible with GitHub-flavored Markdown, [see GitHub's
documentation](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax).

[↑ Contents](#contents)


## Working on Issues

### When Work Begins

Make sure your local `main` branch is up-to-date by running

```bash
git checkout main
git pull remote main
```

> **Note:**  You should never be making commits on your `main` branch, as
> all changes will be making it into `main` via [pull requests](#pull-requests).

Once `main` is updated, you then create a feature branch off of it with `git
checkout -b <branchName>`.  

We recommend using the format `username/description` when naming the branch
for clarity on who is doing the work and what type of work is being completed.
For example, `mrmundt/add-contributing`.

[↑ Contents](#contents)


### As Work Continues

Do whatever work is necessary to address the issue you're tackling.  Divide your
work into logical, compilable commits.  Feel free to commit small chunks of
work early and often in your local repository and then use `git rebase -i` to
reorganize your commits before sharing.

[↑ Contents](#contents)


### When Work is Complete

While working on your feature in your local repository, other commits likely
made it into the remote `main` branch.  There are a variety of ways to merge
these changes into your local feature branch.  One possibility is

```bash
git checkout main
git pull --ff-only
git checkout <branchName>
git rebase main
```

though there are others that are equally valid.

Once you are done, [create a pull request](#pull-requests) (see below).

[↑ Contents](#contents)

### Closing Old Issues

If at any point you encounter an issue that will not be worked in the
foreseeable future, it is worthwhile to close the issue such that you can
maintain a reasonable backlog of upcoming work.  Do be sure to include in the
comments some explanation as to why the issue won't be addressed.

[↑ Contents](#contents)



## Pull Requests

The preferred way changes get into `main` is through pull requests.  When you've
completed work on an issue, push your branch to the remote with `git push -u
<remoteName> <branchName>`, and then create a pull request.

[↑ Contents](#contents)

### Reviewers

We recommend having your pull request reviewed by at least two other team
members. The first should be a member of the Outreach/Website committee.
The second should be another member of the team for which the change is being
completed (e.g., Program Committee). Work with your reviewers to get your
changes into an acceptable
state.

[↑ Contents](#contents)

### Work-in-Progress

You may wish to have your changes reviewed by colleagues before they are ready
to be merged into `main`.  To do so, create a pull request as usual, but
insert "[WIP]" at the beginning of the Title.

You may also create a "Draft" request (see [GitHub's documentation](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests#draft-pull-requests)).

GitHub will not allow you to merge a Draft or WIP request.

[↑ Contents](#contents)


### Merging

When the reviews are finished and all changes approved, your pull request will
be merged by one member of the Outreach/Website committee.

[↑ Contents](#contents)

