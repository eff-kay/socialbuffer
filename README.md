# socialbuffer

Minimal CLI for turning markdown files into queued Buffer posts for X and LinkedIn.

`socialbuffer` is the public name. `tweetx` remains available as a backward-compatible command alias for now.

## Run from source

Clone the repo, create a local `.env`, and run the CLI directly from source:

```sh
nvm use
cp .env.example .env
node ./bin/tweetx.js --help
node ./bin/tweetx.js post --file ./example-post.md --dry-run
```

The root `.env` is loaded automatically, so source usage works without a global install.

Node 20 is the supported runtime for development and CI.

## Global install

Install the CLI globally so `socialbuffer` is available from any directory:

```sh
npm install -g .
```

When run outside this repo, `socialbuffer` looks for config in this order:

```text
$SOCIALBUFFER_ENV_FILE
$TWEETX_ENV_FILE
$XDG_CONFIG_HOME/socialbuffer/.env
~/.config/socialbuffer/.env
~/.socialbuffer/.env
~/.config/tweetx/.env
~/.tweetx/.env
./.env
```

Use `~/.config/socialbuffer/.env` for the public config path. The older `tweetx` config paths still work as legacy fallbacks.

## Discover your channel

List Buffer channels:

```sh
node ./bin/tweetx.js channels
```

List only X/Twitter channels:

```sh
node ./bin/tweetx.js channels --service twitter
```

List only LinkedIn channels:

```sh
node ./bin/tweetx.js channels --service linkedin
```

With a global install, the same commands become:

```sh
socialbuffer channels --service twitter
socialbuffer channels --service linkedin
```

## First command

```sh
node ./bin/tweetx.js post --file ./post.md --dry-run
```

## Setup

Set these environment variables in one of the supported env files:

```sh
BUFFER_API_KEY=your_buffer_api_key
BUFFER_X_CHANNEL_ID=your_buffer_x_channel_id
BUFFER_LINKEDIN_CHANNEL_ID=your_buffer_linkedin_channel_id
X_BEARER_TOKEN=your_x_bearer_token
```

`X_BEARER_TOKEN` is only needed for the read-only `analytics` command.

## Usage

Queue an X post in Buffer:

```sh
socialbuffer post --file ./post.md
```

Queue a LinkedIn post in Buffer:

```sh
socialbuffer post --platform linkedin --file ./post.md
```

Queue a post with one image:

```sh
socialbuffer post --file ./post.md --image ./shot.png
```

Queue a post with one remote image URL:

```sh
socialbuffer post --file ./post.md --image-url https://example.com/shot.png
```

Share immediately:

```sh
socialbuffer post --file ./post.md --mode shareNow
```

Preview the payload without sending anything:

```sh
socialbuffer post --file ./post.md --dry-run
```

Read X analytics:

```sh
socialbuffer analytics --username xdevelopers
```

## Notes

- The first version reads the markdown file as source text and flattens markdown formatting before publish.
- `channels` uses Buffer's GraphQL API so it works with the API key from Buffer's API settings page.
- The CLI auto-loads values from global config files and then lets the current directory's `.env` override them.
- `post` defaults to platform `x`. Use `--platform linkedin` to target the configured LinkedIn channel.
- `analytics` uses the X API directly and expects `X_BEARER_TOKEN` in `.env` or a supported global env file.
- `BUFFER_CHANNEL_ID` remains supported as a legacy fallback for X only.
- YAML frontmatter is stripped if present at the top of the file.
- The current image path supports one local image or one remote image URL.

Built alongside [DocsALot](https://docsalot.dev): convert your commits into documentation, social media posts on autopilot.
