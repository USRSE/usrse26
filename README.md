# The US-RSE Association Conference 2026 (USRSE'26)

This repo is website landing page for the [US-RSE Association Conference 2026](https://us-rse.org/usrse26/).

## Previewing the Site Locally

To preview the site locally, you'll need to [install jekyll](https://jekyllrb.com/docs/installation/).
Then go to the root of the directory and run (only needed once):

```bash
$ bundle install
```

Then run 

```bash
$ jekyll serve
# or
$ bundle exec jekyll serve
```

and open your browser to <http://localhost:4000/usrse26/>.

If you are having trouble try `rm -rf _site`, followed by `bundle update`,
then `bundle exec jekyll serve`.


## Container-based development

Build and run a Docker container to preview the site locally and support a local development workflow.
If you do not already have Docker installed, please visit https://docs.docker.com/get-docker/ and
follow the links to get started with Docker on your operating system.

Build the container image:

```bash
docker build -t us-rse-con-2024-website:latest .
```

Run the container to access the website at the URL http://127.0.0.1:4000/usrse26/

```bash
$ docker run --rm -it -p 4000:4000 us-rse-con-2024-website:latest
Configuration file: /srv/jekyll/_config.yml
            Source: /srv/jekyll
       Destination: /srv/jekyll/_site
 Incremental build: disabled. Enable with --incremental
      Generating... 
                    done in 1.616 seconds.
 Auto-regeneration: enabled for '/srv/jekyll'
    Server address: http://0.0.0.0:4000/usrse26/
  Server running... press ctrl-c to stop.
```

To develop the website, launch the container using the following command, where the source files are mounted into the container:

```bash
docker run --rm -it -p 4000:4000 \
    -v $(pwd):/srv/jekyll \
    us-rse-con-2024-website:latest \
    bundle exec jekyll serve --host=0.0.0.0 --watch --drafts
```

Change a source file, such as `index.html` for example, and save the changes. You will see Jekyll automatically regenerate the site,
after which you can reload the page in your browser to see the rendered changes.

## Adding logos to the website

There is an `_include` file, `add-sponsor-logo.html`, that can be used to add a
sponsor's logo anywhere on the website.
You can use the function by calling:
`{% include add-sponsor-logo.html sponsor_url="some_url" logo_file="logo-filename.png" logo_alt="Some alt text for users" %}`
See the include file for details on the variable names.
The logo files need to be added to the `assets/img/sponsor-logos/` directory.

### Logos on the main page

To add the sponsor logos to the main page, follow the same directions as above,
but make sure the include call is in the correct tier section for the sponsor.
For example, UIUC is a platinum sponsor, so they are added to the
`<div class="row sponsor-platinum ...>` block.