#!/usr/bin/env node
/**
 * playlist/eguitar 악보 이미지 검색 연동 CLI
 * Usage:
 *   node fetch_score_image.cjs --title "곡명" --out D:/tmp/score.jpg
 * stdout: JSON { ok, scoreFound, outPath, meta }
 */
const fs = require('fs')
const path = require('path')

function parseArgs(argv) {
  const out = { title: '', out: '', module: '' }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--title') out.title = argv[++i] || ''
    else if (a === '--out') out.out = argv[++i] || ''
    else if (a === '--module') out.module = argv[++i] || ''
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv)
  if (!args.title || !args.out) {
    console.error(
      JSON.stringify({
        ok: false,
        error: 'usage: --title <song> --out <file>',
      }),
    )
    process.exit(2)
  }

  const modulePath =
    args.module ||
    process.env.PLAYLIST_SCORE_MODULE ||
    path.resolve(
      __dirname,
      '../../playlist/server/services/playlistScorePdf.js',
    )

  if (!fs.existsSync(modulePath)) {
    console.log(
      JSON.stringify({
        ok: false,
        scoreFound: false,
        error: `playlist score module not found: ${modulePath}`,
      }),
    )
    process.exit(0)
  }

  // playlist server deps resolve from that package
  const serverRoot = path.resolve(path.dirname(modulePath), '..')
  module.paths.unshift(path.join(serverRoot, 'node_modules'))

  const { findScoreImageBuffer, extractSongMeta } = require(modulePath)

  // YouTube 긴 제목 → 곡명 위주로 축약 (playlist extractSongMeta 전에)
  let searchTitle = args.title
  searchTitle = searchTitle
    .split(/\s+[|ㅣl]\s+/i)[0]
    .replace(/\s*[-–—]\s*(마커스|마커스워십|피아워십|워십|worship).*$/i, '')
    .replace(/\b(CCM|기타|guitar|cover|라이브|live|official)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (searchTitle.length < 2) searchTitle = args.title

  const meta = extractSongMeta(searchTitle)
  // 코드 진행용: 코드 악보를 조금 더 우선하도록 쿼리 힌트
  if (meta.title && !/코드/.test(meta.searchQuery || '')) {
    meta.searchQuery = `${meta.title} 코드 악보`
  }

  const result = await findScoreImageBuffer(meta)
  if (!result?.scoreFound || !result.buffer) {
    console.log(
      JSON.stringify({
        ok: true,
        scoreFound: false,
        title: meta.title,
        artist: meta.artist,
        searchQuery: meta.searchQuery,
      }),
    )
    return
  }

  fs.mkdirSync(path.dirname(args.out), { recursive: true })
  fs.writeFileSync(args.out, result.buffer)
  console.log(
    JSON.stringify({
      ok: true,
      scoreFound: true,
      outPath: args.out,
      title: meta.title,
      artist: meta.artist,
      searchQuery: meta.searchQuery,
      meta: result.meta || null,
    }),
  )
}

main().catch((err) => {
  console.log(
    JSON.stringify({
      ok: false,
      scoreFound: false,
      error: String(err?.message || err),
    }),
  )
  process.exit(0)
})
