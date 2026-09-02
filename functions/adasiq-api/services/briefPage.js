/**
 * Publish the brief as a real web page, next to the audio.
 *
 * Email clients strip <audio> — Zoho, Gmail and Outlook all do — so "play it
 * and read along" is not achievable inside an email no matter how it's marked
 * up. A page has no such problem: one link, player pinned at the top, the
 * brief underneath, and it works on the phone in the van.
 *
 * Published to the same GitHub Pages site as the mp3, so there's nothing new
 * to host.
 */
export async function publishBriefPage(html, audioUrl, dateISO) {
  const name = 'brief-' + dateISO + '.html'
  const publicUrl = 'https://absoluteadas.com/audio/' + name

  const page = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Ada — ${dateISO}</title>
<style>
  body{margin:0;background:#f6f3ed;}
  /* Pinned so the player stays reachable while he scrolls the brief. */
  .bar{position:sticky;top:0;z-index:2;background:#f6f3ed;
       border-bottom:1px solid #e8e3da;padding:12px 14px;}
  .bar audio{width:100%;max-width:552px;display:block;margin:0 auto;height:40px;}
  @media (prefers-color-scheme: dark){
    body{background:#f6f3ed;} /* deliberately stays light — it's read pre-dawn
                                 on a bright phone, and inverting a warm paper
                                 palette looks broken */
  }
</style>
</head><body>
${audioUrl ? `<div class="bar"><audio controls preload="none" src="${audioUrl}"></audio></div>` : ''}
${html}
</body></html>`

  try {
    const { commitBinaryFile } = await import('./brewArchive.js')
    const r = await commitBinaryFile({
      path: 'audio/' + name,
      buffer: Buffer.from(page, 'utf8'),
      message: 'Ada brief page ' + dateISO,
    })
    if (!r?.ok) return null
    return { url: publicUrl }
  } catch (e) {
    console.warn('[briefPage]', e.message)
    return null
  }
}
