# spotify-buddy-v2

> The Spotify friend activity feed, plus a small web UI — no official API required.

**This is a fork of [`spotify-buddylist`](https://github.com/valeriangalliat/spotify-buddylist)
by [Val](https://val.codejam.info).** The original library, the `sp_dc` cookie
approach, and the TOTP technique are all his work. This fork keeps the same
two-function API and adds:

- a fix for Spotify's current token flow (TOTP v61 / `totpServer` / `/api/token`);
- a dependency-free web UI (`npm start`).

Licensed under the [Unlicense](./LICENSE), same as upstream.

## Why this fork exists

Spotify changed the token flow and the upstream library broke in three places:

| What upstream used | What works now |
| --- | --- |
| `GET /server-time` | `GET /api/server-time` |
| `GET /get_access_token` (hard-403'd now) | `GET /api/token` |
| `totpVer=5`, `totp` only | `totpVer=61`, needs `totp` **and** `totpServer` |

The old TOTP version still returns a `totpVerExpired` error wrapped in a
"not permitted under the Spotify Developer Terms" note. That reads like a
permanent shutdown, but it is really a version rejection: bumping the version
and adding `totpServer` makes `/api/token` return a normal access token again.

## Requirements

Node.js 18+ (for built-in `fetch`). The runtime has **no dependencies** —
`npm install` is only needed if you want to run the linter.

## Getting your `sp_dc` cookie

1. Log in to the [web player](https://open.spotify.com/).
2. Open your browser dev tools → **Application** → **Storage** → **Cookies** →
   `https://open.spotify.com`.
3. Copy the value of the cookie named `sp_dc`.

This cookie is a **full-account session credential**. Treat it like a password:
never commit it, and sign out everywhere if it leaks.

Then either export it:

```sh
# PowerShell
$env:SP_DC = 'AQ...'
# bash
export SP_DC='AQ...'
```

or put it in a `.sp-dc` file at the repo root (git-ignored).

## Web UI

```sh
npm start
# Friend activity UI: http://127.0.0.1:3000
```

A dark, auto-refreshing dashboard: album art, track/artist links into
`open.spotify.com`, the playlist context, and relative timestamps. It refreshes
every 60 seconds, pauses while the tab is hidden, caches the access token until
shortly before it expires, and retries once with a fresh token on a 401.

### Pasting a token in the UI

The server no longer needs a cookie up front. Open the page and paste either:

- an **`sp_dc` cookie** — starts with `AQ`, valid for months, or
- a **web access token** — starts with `BQ`, valid for about an hour.

The type is detected automatically and validated with a real request before it is
accepted; a rejected value leaves the previous credential untouched. Credentials
pasted this way live in the server's **memory only** — nothing is written to
disk, and a restart goes back to `SP_DC` / `.sp-dc`. Use the **Token** button in
the header to replace one at any time.

If a saved cookie is rejected (expired, or signed out everywhere), the page falls
back to the paste panel with an explanation instead of showing an error.

The server listens on `127.0.0.1` by default on purpose — the endpoint acts with
your account, so it shouldn't be exposed to your network. Override with
`HOST` / `PORT` if you know what you're doing.

Routes:

| Route | Purpose |
| --- | --- |
| `GET /` | the page |
| `GET /api/activity` | `{ updatedAt, friends }`, or `401 { needsCredential: true }` |
| `GET /api/status` | `{ configured, kind, tokenExpiresAt }` |
| `POST /api/credentials` | `{ token }` — cookie or access token, validated then kept in memory |
| `DELETE /api/credentials` | forget the in-memory credential |

Cross-origin writes are rejected, so a random web page can't plant a credential.

## CLI / library

```sh
node example.js
```

```js
const buddyList = require('./')

const { accessToken } = await buddyList.getWebAccessToken(spDcCookie)
const friendActivity = await buddyList.getFriendActivity(accessToken)
```

`friendActivity` looks like:

```json
{
  "friends": [
    {
      "timestamp": 1600773735000,
      "user": { "uri": "spotify:user:shaktirockgym", "name": "shaktirockgym" },
      "track": {
        "uri": "spotify:track:51xHvAUYQfhY29GcGlBM0n",
        "name": "Piano Sonata No. 16 in C Major, K. 545",
        "imageUrl": "https://i.scdn.co/image/ab67616d0000b273bf4b533ee6e9634a6fcd8882",
        "album": { "uri": "spotify:album:1XORY4rQNhqkZxTze6Px90", "name": "Piano Book" },
        "artist": { "uri": "spotify:artist:4NJhFmfw43RLBLjQvxDuRS", "name": "Wolfgang Amadeus Mozart" },
        "context": { "uri": "spotify:playlist:37i9dQZF1E4riV8HyBkA7r", "name": "Mozart Radio", "index": 0 }
      }
    }
  ]
}
```

Tokens are valid for about an hour (`accessTokenExpirationTimestampMs`); call
`getWebAccessToken` again to refresh.

## When it breaks again

Spotify rotates the TOTP secret every so often, and this library will stop
working when they move past v61. The repair is quick — the secret is in the
public web player bundle:

1. Download `https://open.spotify.com/` and note the `web-player.<hash>.js`
   script it loads from `open.spotifycdn.com`.
2. Search that file for `let ej=[{secret:`.
3. Copy the newest `{ secret: '...', version: N }` pair into `SECRETS` in
   [`index.js`](./index.js), newest first.

The secret is transformed before use (each character is XORed with
`(index % 33) + 9`); [`index.js`](./index.js) already does that, so you only
need to paste the literal string and version.

## Legal

This uses an unofficial endpoint. Spotify's own response states that *"usage of
this endpoint is not permitted under the Spotify Developer Terms and Developer
Policy, and applicable law."* There is no official API for the friend activity
feed ([spotify/web-api#83](https://github.com/spotify/web-api/issues/83)), so
this works by pretending to be the web player.

Use it for personal use, at your own risk, and don't be surprised if it breaks
or gets blocked.

## Credits

- [Val](https://val.codejam.info) — original
  [`spotify-buddylist`](https://github.com/valeriangalliat/spotify-buddylist):
  the library design, the `sp_dc` approach, and the TOTP method.
- [melon-husk](https://github.com/melon-husk) — current token flow and the web UI.
