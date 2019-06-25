const puppeteer = require('puppeteer')
const { promisify } = require('util')
const { join } = require('path')
const { Toolkit } = require('actions-toolkit')
const exec = promisify(require('child_process').exec)
const mkdir = promisify(require('fs').mkdir)

function ellipsis(txt, l = 25) {
  return txt.length > l ? `${txt.slice(0, l - 3)}…` : txt
}

function createCommentBody(pages, screenshotsUrl, url, max) {
  const grouped = pages.slice(0, max).reduce((pv, cv, i) => {
    const j = Math.floor(i / 3)
    ;(pv[j] || (pv[j] = [])).push(cv)
    return pv
  }, [])
  const rest = pages.slice(6)

  return `#### 📝Changed pages:

${grouped.map(
  group => `
|${group.map(page => ` [\`${ellipsis(page)}\`](${url}${page}) |`).join('')}
|${group.map(_ => `-|`).join('')}
|${group
    .map(
      page =>
        ` <a href="${url}${page}"><img src="${screenshotsUrl}${page}.png" alt="Screenshot of ${page}" width="200"></a> |`
    )
    .join('')}
`
)}

${
  rest.length > 0
    ? `And ${rest.length} other pages:
${rest.map(page => `- [\`${page}\`](${url}${page})`).join('\n')}`
    : ''
}`
}

const payload = require(process.env.GITHUB_EVENT_PATH)
const state = payload.deployment_status.state
const url = payload.deployment_status.target_url
const sha = payload.deployment.sha
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')

const tools = new Toolkit({
  event: ['deployment_status'],
  secrets: ['GITHUB_TOKEN', 'ZEIT_TOKEN']
})

async function run() {
  if (state !== 'success') {
    console.log('deployment status is not succeed, not running')
    process.exit(78)
    return
  }

  // parse arguments
  const dir = (tools.arguments.dir || 'pages').replace(/^\/|\/$/g, '')
  const base = tools.arguments.base || 'master'
  const max = tools.arguments.max ? Number(tools.arguments.max) : 6

  console.log('running git to get diff')
  const { stdout: diffResult } = await tools.runInWorkspace('git', [
    'diff',
    '--name-only',
    'HEAD',
    `origin/${base}`
  ])
  const pages = diffResult
    .split('\n')
    .filter(l => l.startsWith(dir))
    .map(l => l.slice(dir.length).replace(/\.[a-z]+$/, ''))

  if (pages.length === 0) {
    console.log('no page modified, not running')
    process.exit(78)
    return
  }

  console.log('pages modified')
  console.log({ url, pages })

  console.log('taking screenshots')
  await mkdir(join(__dirname, 'dist'), { recursive: true })
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })
  const firstPages = pages.slice(0, max)
  for (let page of firstPages) {
    const b = await browser.newPage()
    b.setViewport({ width: 1280, height: 800 })
    await b.goto(url + page)
    await b.screenshot({
      path: join(__dirname, 'dist', `${page}.png`),
      fullPage: true
    })
  }
  await browser.close()

  console.log('deploying screenshots')
  const { stdout: screenshotsUrl } = await exec(
    `/node_modules/.bin/now -t ${
      process.env.ZEIT_TOKEN
    } -n screenshot-next ${join(__dirname, 'dist')}`
  )
  console.log(`deployed to ${screenshotsUrl}`)

  console.log('commenting on pr')
  await tools.github.repos.createCommitComment({
    owner,
    repo,
    commit_sha: sha,
    body: createCommentBody(pages, screenshotsUrl, url, max)
  })

  process.exit(0)
  return
}

run().catch(err => {
  console.log(err)
  process.exit(1)
  return
})
