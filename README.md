<p align="center">
  <img width="250" height="250" src="https://raw.githubusercontent.com/museofficial/muse/master/.github/logo.png">
</p>

> [!IMPORTANT]
> This is a fork of [`museofficial/muse`](https://github.com/museofficial/muse) that turns the now-playing message into a full music player and adds a few more features (see [Fork features](#fork-features)). Upstream changes are merged in regularly. The Docker image for this fork is `ghcr.io/asusplayer/muse`, rebuilt on every push to `master`.

------

Muse is a **highly-opinionated midwestern self-hosted** Discord music bot **that doesn't suck**. It's made for small to medium-sized Discord servers/guilds (think about a group the size of you, your friends, and your friend's friends).

![Hero graphic](.github/hero.png)

## Features

- 🎥 Livestreams
- ☁️ SoundCloud tracks, share links, and playlists
- ⏩ Seeking within a song/video
- 💾 Local caching for better performance
- 📋 No vote-to-skip by default - this is anarchy, not a democracy (but see vote skip below)
- ↔️ Autoconverts playlists / artists / albums / songs from Spotify
- ⭐ Users can save favorite queries for reuse
- 1️⃣ Muse instance supports multiple guilds
- 🔊 Configurable volume controls, including optional ducking when people speak
- ✍️ Written in TypeScript, easily extendable
- ❤️ Loyal Packers fan

### Fork features

Everything below is added by this fork. Each setting has a `/config` subcommand, and `/config get` shows the current values.

- 🎛️ **Player controls** under the now-playing message: previous, play/pause, skip, stop, loop (off → song → queue), shuffle, volume ±10 % and autoplay. Only members in the bot's voice channel can use them.
- ⏱️ **Live now-playing message** that updates every second and shows the next three songs in the queue.
- 🎤 **Synced lyrics** from [LRCLIB](https://lrclib.net): the previous, current and next line run along in the now-playing message (`/config set-now-playing-lyrics`, on by default). `/lyrics` shows the full text privately.
- 🎵 **YouTube Music first**: free-text searches pick the YouTube Music song (the plain studio version) instead of the music video (`/config set-prefer-audio`, on by default). Falls back to the regular YouTube search when nothing matches.
- 🗳️ **Vote skip**: skipping needs votes from a share of the listeners (`/config set-vote-skip`, `/config set-vote-skip-percent`, off by default, 50 %). The requester and members with *Manage Server* always skip right away.
- 📜 **Play history**: `/history list` shows the last 200 songs of the server, `/history play` queues one of them again.
- 💾 **Saved playlists**: `/playlist save` stores the current song and queue under a name, `/playlist load|list|remove` work with them. Only the creator or the server owner can overwrite or remove a playlist.
- 📻 **Autoplay**: when the queue runs out, Muse adds five songs from YouTube's Mix for the last song (`/config set-autoplay`, off by default). The 📻 button switches it for the current session.

## Running

Muse is written in TypeScript. You can either run Muse with Docker (recommended) or directly with Node.js. Both methods require the Discord and YouTube API keys below. Spotify keys are optional and enable Spotify URL conversion:

- `DISCORD_TOKEN` can be acquired [here](https://discordapp.com/developers/applications) by creating a 'New Application', then going to 'Bot'.
- `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` can be acquired [here](https://developer.spotify.com/dashboard/applications) with 'Create a Client ID'.
- `YOUTUBE_API_KEY` can be acquired by [creating a new project](https://console.developers.google.com) in Google's Developer Console, enabling the YouTube API, and creating an API key under credentials.

Muse will log a URL when run. Open this URL in a browser to invite Muse to your server. Muse will DM the server owner after it's added with setup instructions.

A 64-bit OS is required to run Muse.

### Versioning

This fork has no releases of its own. Every push to `master` publishes a new image, so `master` is what runs. To stay on a version you have tested, pin the image to a commit (see the tags below).


### 🐳 Docker

The fork's image `ghcr.io/asusplayer/muse` has these tags:
- `:latest`: the current `master`
- `:sha-<full commit hash>`: an exact commit

(Replace empty config strings with correct values.)

```bash
docker run -it -v "$(pwd)/data":/data -e DISCORD_TOKEN='' -e SPOTIFY_CLIENT_ID='' -e SPOTIFY_CLIENT_SECRET='' -e YOUTUBE_API_KEY='' ghcr.io/asusplayer/muse:latest
```

This starts Muse and creates a data directory in your current directory.

You can also store your tokens in an environment file and make it available to your container. By default, the container will look for a `/config` environment file. You can customize this path with the `ENV_FILE` environment variable to use with, for example, [docker secrets](https://docs.docker.com/engine/swarm/secrets/). 

**Docker Compose**:

```yaml
services:
  muse:
    image: ghcr.io/asusplayer/muse:latest
    restart: always
    volumes:
      - ./muse:/data
      # Optional: mount YouTube-only cookies for age-restricted videos.
      # - ./youtube-cookies.txt:/run/secrets/youtube-cookies.txt:ro
    environment:
      - DISCORD_TOKEN=
      - YOUTUBE_API_KEY=
      - SPOTIFY_CLIENT_ID=
      - SPOTIFY_CLIENT_SECRET=
      # - YT_DLP_COOKIES_PATH=/run/secrets/youtube-cookies.txt
```

If you keep the same `DISCORD_TOKEN`, reuse the same `/data` volume, and point your Compose service at a newer image tag, Muse will come back up with the same bot identity and persisted database/cache.

### Node.js

**Prerequisites**:
* Node.js 22.12.0 or newer
* ffmpeg (4.1 or later)
* `yt-dlp` on your `PATH` (or set `YT_DLP_PATH` to its full path)

1. `git clone https://github.com/asusplayer/muse.git && cd muse`
2. Copy `.env.example` to `.env` and populate with values
3. `yarn install` (or `npm i`)
4. `yarn start` (or `npm run start`)

**Note**: if you're on Windows, you may need to manually set the ffmpeg path. See [#345](https://github.com/museofficial/muse/issues/345) for details.

### Local validation

Run the behavior suite locally with:

```bash
npm test
```

## ⚙️ Additional configuration (advanced)

### Cache

By default, Muse limits the total cache size to around 2 GB. If you want to change this, set the environment variable `CACHE_LIMIT`. For example, `CACHE_LIMIT=512MB` or `CACHE_LIMIT=10GB`.

### yt-dlp

Muse now uses `yt-dlp` to resolve playable YouTube media URLs. In Docker, the image already includes it. For direct Node.js installs, either put `yt-dlp` on your `PATH` or set `YT_DLP_PATH` in your environment file.

Muse logs `YT_DLP_VERSION` on startup. Set `YT_DLP_AUTO_UPDATE=true` to make Muse try to update the configured `yt-dlp` installation before connecting to Discord. This works best with the Docker image's bundled virtualenv, or when `YT_DLP_PATH` points at a virtualenv or standalone `yt-dlp` executable that Muse can update.

Age-restricted videos require cookies from an age-verified YouTube account. Export a YouTube-only Netscape cookie file using the [official yt-dlp guidance](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies), mount it outside `/data`, and set `YT_DLP_COOKIES_PATH` to its container path. Treat this file like a password. Muse copies it to a private per-extraction temporary file because yt-dlp updates the cookie jar while it runs, so the mounted source may remain read-only and concurrent guilds do not share a writable cookie file.

Current YouTube extraction also requires a supported JavaScript runtime. The Docker image includes the matching `yt-dlp-ejs` package and uses its bundled Node.js runtime. Direct installs should install `yt-dlp[default]` and provide Node.js 22 or newer.

Upstream also publishes `ghcr.io/museofficial/muse:yt-dlp-latest`, rebuilt on a schedule with the newest `yt-dlp`. This fork has no such image; set `YT_DLP_AUTO_UPDATE=true` instead to keep `yt-dlp` current.

### SponsorBlock

Muse can skip non-music segments at the beginning or end of a Youtube music video (Using [SponsorBlock](https://sponsor.ajay.app/)). It is disabled by default. If you want to enable it, set the environment variable `ENABLE_SPONSORBLOCK=true` or uncomment it in your .env.
Being a community project, the server may be down or overloaded. When it happen, Muse will skip requests to SponsorBlock for a few minutes. You can change the skip duration by setting the value of `SPONSORBLOCK_TIMEOUT`.

### Custom Bot Status

In the default state, Muse has the status "Online" and the text "Listening to Music". You can change the status through environment variables:

- `BOT_STATUS`:
  - `online` (Online)
  - `idle` (Away)
  - `dnd` (Do not Disturb)

- `BOT_ACTIVITY_TYPE`:
  - `PLAYING` (Playing XYZ)
  - `LISTENING` (Listening to XYZ)
  - `WATCHING` (Watching XYZ)
  - `STREAMING` (Streaming XYZ)

- `BOT_ACTIVITY`: the text that follows the activity type

- `BOT_ACTIVITY_URL` If you use `STREAMING` you MUST set this variable, otherwise it will not work! Here you write a regular YouTube or Twitch Stream URL.

#### Examples

**Muse is watching a movie and is DND**:
- `BOT_STATUS=dnd`
- `BOT_ACTIVITY_TYPE=WATCHING`
- `BOT_ACTIVITY=a movie`

**Muse is streaming Monstercat**:
- `BOT_STATUS=online`
- `BOT_ACTIVITY_TYPE=STREAMING`
- `BOT_ACTIVITY_URL=https://www.twitch.tv/monstercat`
- `BOT_ACTIVITY=Monstercat`

### Bot-wide commands

If you have Muse running in a lot of guilds (10+) you may want to switch to registering commands bot-wide rather than for each guild. (The downside to this is that command updates can take up to an hour to propagate.) To do this, set the environment variable `REGISTER_COMMANDS_ON_BOT` to `true`.

### Automatically turn down volume when people speak

You can configure the bot to automatically turn down the volume when people are speaking in the channel using the following commands:

- `/config set-reduce-vol-when-voice true` - Enable automatic volume reduction
- `/config set-reduce-vol-when-voice false` - Disable automatic volume reduction
- `/config set-reduce-vol-when-voice-target <volume>` - Set the target volume percentage when people speak (0-100, default is 20)

### Troubleshooting voice connection timeouts

Muse retries a stalled initial voice handshake up to three times, waiting up to 20 seconds per attempt. Requests are added to the queue only after the connection is ready; a failed join leaves the existing queue intact. A later successful request can still resume songs that were already queued intentionally.

The failure message includes the last voice and network states. `OpeningWs` means the secure connection to the voice server did not open; check outbound TCP access to the **port supplied by Discord**, which is not necessarily 443. `UdpHandshaking` means the voice server was reached but UDP discovery did not finish; check outbound UDP and return traffic through the firewall/NAT. Discord describes both steps in its [voice connection documentation](https://docs.discord.com/developers/topics/voice-connections).

Keep voice tokens, session IDs, encryption keys, and full protocol/debug payloads out of logs and bug reports. The network-state diagnostic reports only a state name.
