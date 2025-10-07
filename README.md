# USING THIS TEMPLATE

1. Please search for all `TBD`s and replace them as appropriate.
2. Update other relevant information as appropriate.
3. Ensure that the repository is public, then activate GitHub Pages by going to **Settings** > **Pages** > **Deploy from branch** > `main`. Also click the radio button near the bottom for "Enforce HTTPS".
4. Set up CircleCI by going to https://app.circleci.com/projects/project-dashboard/github/USRSE/, click "Set up project" on your repository (e.g., `usrse26`), select the existing `config.yml` file from `main`, click "Set up project", click "Project settings" > "Advanced Settings", and toggle the "Build forked pull requests" option. CircleCI previews will now be generated for all Pull Requests.
5. Remove this section from the README.

------

# The US-RSE Association Conference 2026 (US-RSE'26)

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
    us-rse-con-2026-website:latest \
    bundle exec jekyll serve --host=0.0.0.0 --watch --drafts
```

Change a source file, such as `index.html` for example, and save the changes. You will see Jekyll automatically regenerate the site,
after which you can reload the page in your browser to see the rendered changes.

