const http = require('http')
const fs = require('fs')
const path = require('path')

const buddyList = require('./')
const loadCookie = require('./cookie')

const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT) || 3000

// Refresh a cookie-derived token a minute before it actually expires.
const TOKEN_MARGIN_MS = 60 * 1000
const MAX_BODY_BYTES = 8 * 1024

const INDEX_PATH = path.join(__dirname, 'public', 'index.html')

// Credentials are held in memory only, and are either an sp_dc cookie (which
// gets exchanged for an access token) or an access token used as-is.
let credential = null
let token = null // { value, expiresAt } for cookie-derived tokens

try {
  credential = { kind: 'cookie', secret: loadCookie() }
} catch (err) {
  credential = null // the UI can supply one at runtime
}

// sp_dc cookies start with "AQ", web access tokens with "BQ".
function classify (value) {
  return value.startsWith('AQ') ? 'cookie' : 'token'
}

async function getAccessToken (force = false) {
  if (!credential) return null
  if (credential.kind === 'token') return credential.secret

  if (!force && token && Date.now() < token.expiresAt - TOKEN_MARGIN_MS) {
    return token.value
  }

  let info

  try {
    info = await buddyList.getWebAccessToken(credential.secret)
  } catch (err) {
    // A revoked or expired cookie can only be replaced by the user.
    if (err.response && err.response.status === 401) {
      throw needsCredential('The saved sp_dc cookie was rejected — it expired or was signed out. Paste a fresh one.')
    }
    throw err
  }

  token = {
    value: info.accessToken,
    expiresAt: info.accessTokenExpirationTimestampMs || Date.now() + 60 * 60 * 1000
  }

  return token.value
}

function needsCredential (message) {
  const err = new Error(message)
  err.needsCredential = true
  return err
}

async function getActivity () {
  const accessToken = await getAccessToken()
  if (!accessToken) throw needsCredential('No token configured.')

  try {
    return await buddyList.getFriendActivity(accessToken)
  } catch (err) {
    if (!err.response || err.response.status !== 401) throw err

    // A cookie can always mint a fresh token; a pasted token cannot.
    if (credential.kind === 'cookie') {
      return await buddyList.getFriendActivity(await getAccessToken(true))
    }

    throw needsCredential('That access token was rejected, it has probably expired.')
  }
}

// Verify a candidate credential before we start using it.
async function validate (kind, secret) {
  if (kind === 'token') {
    await buddyList.getFriendActivity(secret)
    return
  }

  const info = await buddyList.getWebAccessToken(secret)
  await buddyList.getFriendActivity(info.accessToken)
  token = {
    value: info.accessToken,
    expiresAt: info.accessTokenExpirationTimestampMs || Date.now() + 60 * 60 * 1000
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

function sendJson (res, status, payload) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(payload))
}

// Reject cross-origin writes so a random page can't plant a credential.
function sameOrigin (req) {
  const origin = req.headers.origin
  if (!origin) return true

  try {
    const { hostname } = new URL(origin)
    return hostname === HOST || hostname === 'localhost' || hostname === '127.0.0.1'
  } catch (err) {
    return false
  }
}

function readBody (req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0

    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function handleCredentials (req, res) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Cross-origin request rejected' })

  if (req.method === 'DELETE') {
    credential = null
    token = null
    return sendJson(res, 200, { ok: true })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, DELETE')
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  let body

  try {
    body = JSON.parse(await readBody(req))
  } catch (err) {
    return sendJson(res, 400, { error: 'Expected a JSON body' })
  }

  const secret = typeof body.token === 'string' ? body.token.trim() : ''

  if (!secret) return sendJson(res, 400, { error: 'Paste a cookie or access token first' })
  if (/\s/.test(secret)) return sendJson(res, 400, { error: 'That value contains whitespace' })

  const kind = classify(secret)
  const previous = credential
  const previousToken = token

  credential = { kind, secret }
  token = null

  try {
    await validate(kind, secret)
  } catch (err) {
    credential = previous
    token = previousToken
    return sendJson(res, 400, {
      error: `That ${kind === 'cookie' ? 'sp_dc cookie' : 'access token'} was rejected (${err.message})`
    })
  }

  return sendJson(res, 200, { ok: true, kind })
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

  if (pathname === '/api/status') {
    return sendJson(res, 200, {
      configured: Boolean(credential),
      kind: credential ? credential.kind : null,
      tokenExpiresAt: credential && credential.kind === 'cookie' && token ? token.expiresAt : null
    })
  }

  if (pathname === '/api/credentials') {
    try {
      return await handleCredentials(req, res)
    } catch (err) {
      console.error(`credentials failed: ${err.message}`)
      return sendJson(res, 500, { error: err.message })
    }
  }

  if (pathname === '/api/activity') {
    try {
      const { friends = [] } = await getActivity()
      return sendJson(res, 200, { updatedAt: Date.now(), friends })
    } catch (err) {
      if (err.needsCredential) {
        return sendJson(res, 401, { error: err.message, needsCredential: true })
      }
      console.error(`activity failed: ${err.message}`)
      return sendJson(res, 502, { error: err.message })
    }
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
  if (credential) {
    console.log(`Using ${credential.kind} credential from ${process.env.SP_DC ? 'SP_DC' : '.sp-dc'}`)
  } else {
    console.log('No credential yet - paste an sp_dc cookie or access token in the UI.')
  }
})
