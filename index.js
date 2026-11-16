const crypto = require('crypto')

// TOTP secrets published by the current web player bundle, newest first.
// Each entry pairs the secret string with the `totpVer` the server expects.
const SECRETS = [
  { secret: ',7/*F("rLJ2oxaKL^f+E1xvP@N', version: 61 },
  { secret: 'OmE{ZA.J^":0FG\\Uz?[@WW', version: 60 },
  { secret: '{iOFn;4}<1PFYKPV?5{%u14]M>/V0hDH', version: 59 }
]
const CURRENT = SECRETS[0]

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// The bundle XORs each character with `(index % 33) + 9`, reinterprets the
// resulting digits as UTF-8, hex-decodes that, and uses it as the HMAC key.
function secretBytes (secret) {
  const xored = secret
    .split('')
    .map((char, i) => char.charCodeAt(0) ^ (i % 33 + 9))
    .join('')
  return Buffer.from(Buffer.from(xored, 'utf8').toString('hex'), 'hex')
}

const KEY = secretBytes(CURRENT.secret)
const TIME_STEP = 30 // seconds, RFC 6238 default
const DIGITS = 6

// RFC 6238 TOTP (HMAC-SHA1), matching the web player's implementation.
function generateTotp (key, timestampMs) {
  const counter = Math.floor(timestampMs / 1000 / TIME_STEP)
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))

  const hmac = crypto.createHmac('sha1', key).update(message).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const binary = ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3]

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

// The token endpoint validates a TOTP derived from Spotify's clock as well as
// our own, so this one is not fatal if it fails.
async function getServerTime () {
  try {
    const resp = await fetch('https://open.spotify.com/api/server-time', {
      headers: { 'User-Agent': USER_AGENT }
    })
    if (!resp.ok) return null
    const { serverTime } = await resp.json()
    const seconds = Number(serverTime)
    return Number.isFinite(seconds) ? seconds : null
  } catch (err) {
    return null
  }
}

exports.getWebAccessToken = async function getWebAccessToken (spDcCookie) {
  const serverTime = await getServerTime()
  const now = Date.now()

  const params = new URLSearchParams({
    reason: 'transport',
    productType: 'web_player',
    totp: generateTotp(KEY, now),
    totpServer: serverTime === null ? 'unavailable' : generateTotp(KEY, serverTime * 1000),
    totpVer: String(CURRENT.version)
  })

  const response = await fetch(`https://open.spotify.com/api/token?${params.toString()}`, {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      Cookie: `sp_dc=${spDcCookie}`
    }
  })

  if (!response.ok) {
    throw Object.assign(new Error(`Failed to get web access token: ${response.status}`), {
      response
    })
  }

  const info = await response.json()

  if (!info.accessToken) {
    throw Object.assign(new Error('Failed to get web access token: no accessToken in response'), {
      response
    })
  }

  return info
}

exports.getFriendActivity = async function getFriendActivity (webAccessToken) {
  // Looks like the app now uses `https://spclient.wg.spotify.com/presence-view/v1/buddylist`
  // but both endpoints appear to be identical in the kind of token they accept
  // and the response format.
  const res = await fetch('https://guc-spclient.spotify.com/presence-view/v1/buddylist', {
    headers: {
      'User-Agent': USER_AGENT,
      Authorization: `Bearer ${webAccessToken}`
    }
  })

  if (!res.ok) {
    throw Object.assign(new Error(`Failed to get friend activity: ${res.status}`), {
      response: res
    })
  }

  return res.json()
}
