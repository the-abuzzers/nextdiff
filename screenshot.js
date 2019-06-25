const puppeteer = require('puppeteer')
const { promisify } = require('util')
const { join, dirname } = require('path')
const { Toolkit } = require('actions-toolkit')
const exec = promisify(require('child_process').exec)
const mkdir = promisify(require('fs').mkdir)

const payload = require(process.env.GITHUB_EVENT_PATH)
const state = payload.deployment_status.state
const url = payload.deployment_status.target_url
const sha = payload.deployment.sha
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')

const tools = new Toolkit({
  event: ['deployment_status'],
  secrets: ['GITHUB_TOKEN', 'ZEIT_TOKEN']
})

function ellipsis(txt, l = 25) {
  return txt.length > l ? `…${txt.slice(-22)}` : txt
}

function createCommentBody(pages, screenshotsUrl, max) {
  const grouped = pages.slice(0, max).reduce((pv, cv, i) => {
    const j = Math.floor(i / 3)
    ;(pv[j] || (pv[j] = [])).push(cv)
    return pv
  }, [])
  const rest = pages.slice(6)

  return `#### 📝Changed Next.js pages:

${grouped.map(
  group => `
<table>
  <thead>
    <tr>
      ${group
        .map(
          page =>
            `<th>
              <a href="${url}${page}">
                <code>${ellipsis(page)}</code>
              </a>
            </th>`
        )
        .join('')}
    </tr>
  </thead>
  <tbody>
    <tr>
      ${group
        .map(
          page =>
            `<td valign="top">
              <a href="${url}${page}" target=“_blank”>
                <img src="${screenshotsUrl}${page}.png" alt="Screenshot of ${page}" width="200">
              </a>
            </td>`
        )
        .join('')}
    </tr>
  </tbody>
</table>
`
)}

${
  rest.length > 0
    ? `And ${rest.length} other pages:
${rest
  .map(page => `- <a href="${url}${page}"><code><b>${page}</b></code></a>`)
  .join('\n')}`
    : ''
}

Commit ${sha} (<a href="${url}">${url}</a>).`
}

async function upsertComment(pull, body) {
  const { data: comments } = await tools.github.issues.listComments({
    owner,
    repo,
    issue_number: pull.number
  })

  const comment = comments.find(comment =>
    comment.body.startsWith('#### 📝Changed Next.js pages:')
  )

  if (!comment) {
    await tools.github.issues.createComment({
      owner,
      repo,
      issue_number: pull.number,
      body
    })
  } else {
    await tools.github.issues.updateComment({
      owner,
      repo,
      comment_id: comment.id,
      body
    })
  }
}

async function run() {
  if (state !== 'success') {
    console.log('deployment status is not success, not running')
    process.exit(78)
    return
  }

  const {
    data: [pull]
  } = await tools.github.repos.listPullRequestsAssociatedWithCommit({
    owner,
    repo,
    commit_sha: sha
  })

  if (!pull) {
    console.log('no pr associated with this commit, not running')
    process.exit(78)
    return
  }

  // parse arguments
  const dir = (tools.arguments.dir || 'pages').replace(/^\/|\/$/g, '')
  const max = tools.arguments.max ? Number(tools.arguments.max) : 6

  console.log('running git to get diff')
  const { stdout: diffResult } = await tools.runInWorkspace('git', [
    'diff',
    '--name-only',
    `origin/${pull.base.ref}...`
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
    await mkdir(join(__dirname, 'dist', dirname(page)), { recursive: true })
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
  await upsertComment(pull, createCommentBody(pages, screenshotsUrl, max))

  process.exit(0)
  return
}

run().catch(err => {
  console.log(err)
  process.exit(1)
  return
})
