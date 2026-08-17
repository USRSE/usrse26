FROM ruby:3.1

WORKDIR /srv/jekyll

## Install required gems
COPY ./Gemfile ./Gemfile
COPY ./Gemfile.lock ./Gemfile.lock
RUN gem install bundler -v 2.5.17 && bundle install

## Copy source files
COPY ./ ./

EXPOSE 4000

CMD ["bundle", "exec", "jekyll", "serve", "--host=0.0.0.0", "--watch", "--drafts"]
