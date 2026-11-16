const fs = require('fs')
const path = require('path')

const COOKIE_PATH = path.join(__dirname, '.sp-dc')

// Resolve the sp_dc cookie from the SP_DC environment variable, falling back to
// a local .sp-dc file (git-ignored). The cookie is a full-account credential,
// so it must never be hardcoded in source or committed.
module.exports = function loadCookie () {
  if (process.env.SP_DC) return process.env.SP_DC.trim()

  try {
    const cookie = fs.readFileSync(COOKIE_PATH, 'utf8').trim()
    if (cookie) return cookie
  } catch (err) {
    // fall through to the error below
  }

  throw new Error('Missing sp_dc cookie: set SP_DC or create a .sp-dc file.')
}
