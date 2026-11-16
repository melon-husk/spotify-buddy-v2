const http = require('http')
const fs = require('fs')
const path = require('path')

const buddyList = require('./')
const loadCookie = require('./cookie')

const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT) || 3000

// Refresh the web token a minute before it actually expires.
const TOKEN_MARGIN_MS = 60 * 1000

const INDEX_PATH = path.join(__dirname, 'public', 'index.html')

let cookie

try {
  cookie = loadCookie()
} catch (err) {
  console.error(err.message)
  console.error('Set SP_DC in the environment, or put the cookie in .sp-dc (git-ignored).')
  process.exit(1)
}

let token = null // { accessToken, expiresAt }

async function getToken (force = false) {
  if (!force && token && Date.now() < token.expiresAt - TOKEN_MARGIN_MS) {
    return token.accessToken
  }

  const info = await buddyList.getWebAccessToken(cookie)
  token = {
    accessToken: info.accessToken,
    expiresAt: info.accessTokenExpirationTimestampMs || Date.now() + 60 * 60 * 1000
  }

  return token.accessToken
}

async function getActivity () {
  try {
    return await buddyList.getFriendActivity(await getToken())
  } catch (err) {
    // A cached token may have been revoked; retry once with a fresh one.
    if (err.response && err.response.status === 401) {
      return await buddyList.getFriendActivity(await getToken(true))
    }
    throw err
  }
}

function send (res, status, contentType, body) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(body)
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

  if (pathname === '/') {
    try {
      send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(INDEX_PATH))
    } catch (err) {
      send(res, 500, 'text/plain; charset=utf-8', 'public/index.html is missing')
    }
    return
  }

  if (pathname === '/api/activity') {
    try {
      const { friends = [] } = await getActivity()
      send(res, 200, 'application/json; charset=utf-8', JSON.stringify({
        updatedAt: Date.now(),
        friends
      }))
    } catch (err) {
      console.error(`activity failed: ${err.message}`)
      send(res, 502, 'application/json; charset=utf-8', JSON.stringify({
        error: err.message
      }))
    }
    return
  }

  if (pathname === '/favicon.ico') {
    res.writeHead(204)
    res.end()
    return
  }

  send(res, 404, 'text/plain; charset=utf-8', 'Not found')
})

server.listen(PORT, HOST, () => {
  console.log(`Friend activity UI: http://${HOST}:${PORT}`)
})
