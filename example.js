const buddyList = require('./')
const loadCookie = require('./cookie')

async function main () {
  const accessTokenInfo = await buddyList.getWebAccessToken(loadCookie())

  console.log('Access token:', JSON.stringify(accessTokenInfo))

  const friendActivity = await buddyList.getFriendActivity(accessTokenInfo.accessToken)

  console.log(JSON.stringify(friendActivity, null, 2))
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})

// Run every minute
// setInterval(() => main(), 1000 * 60)
