const puppeteer = require('puppeteer')
const { promisify } = require('util')
const { join } = require('path')
const { Toolkit } = require('actions-toolkit')
const exec = promisify(require('child_process').exec)
const mkdir = promisify(require('fs').mkdir)

function createCommentBody(pages, screenshotsUrl) {
  return `<details>
  <summary>See changes</summary>

  | page | screenshot |
  |-|-|
  ${pages
    .map(page => `| \`${page}\` | ![${page}](${screenshotsUrl}${page}.png) |`)
    .join('\n  ')}
</details>`
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

  console.log('running git to get diff')
  const { stdout: diffResult } = await tools.runInWorkspace('git', [
    'diff',
    '--name-only',
    'HEAD',
    'origin/master'
  ])
  const pages = diffResult
    .split('\n')
    .filter(l => /^pages\//.test(l))
    .map(l => l.replace(/^pages/, '').replace(/\.[a-z]+$/, ''))

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
  for (let page of pages) {
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
    body: createCommentBody(pages, screenshotsUrl)
  })

  process.exit(0)
  return
}

run().catch(err => {
  console.log(err)
  process.exit(1)
  return
})
