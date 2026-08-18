export default function DocsPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16 prose lg:prose-lg">
      <h1>Suno API Final / Pure HTTP Rewrite</h1>
      <p>
        This build keeps the validated HTTP runtime, the production pure-HTTP stems routes,
        and the fixed direct-HTTP Studio adapters from report §25.10.
        Chrome/CDP is not part of their normal execution path.
      </p>

      <h2>Available endpoints</h2>
      <ul>
        <li><code>GET /api/get_limit</code> — read credits / quota</li>
        <li><code>GET /api/workspaces</code> — list workspaces (<code>?show_trashed=true|1</code> supported)</li>
        <li><code>POST /api/create_precheck</code> — run <code>/api/c/check</code> and, when challenge is required, solve Turnstile before create</li>
        <li><code>POST /api/generate</code> — prompt-mode create</li>
        <li><code>POST /api/custom_generate</code> — custom-mode create + wait; clients handle MP3/WAV download separately</li>
        <li><code>POST /api/cover_generate</code> — cover-mode create from an existing clip</li>
        <li><code>POST /api/extend_audio</code> — Remix / extend from an existing clip</li>
        <li><code>POST /api/mashup_generate</code> — combine exactly two existing clips through Suno Mashup</li>
        <li><code>POST /api/song_auto_stems_download</code> — locate a song by clip ID, extract Auto split stems, and download a verified ZIP</li>
        <li><code>POST /api/studio_multitrack</code> — resolve a studio_export clip ID to the exact Studio project and download a verified Multitrack WAV ZIP</li>
        <li><code>POST /api/studio/multitrack</code> — render captured Studio state, reuse by request fingerprint, and atomically validate a Multitrack WAV ZIP</li>
        <li><code>POST /api/studio/export</code> — Full Song or Selected Time Range render to a Suno Library Clip</li>
        <li><code>POST /api/studio/generate</code> — paid Instrument/Cover create with three gates, durable idempotency, credit ledger, and poll-only recovery</li>
        <li><code>GET|POST /api/studio/projects</code> — Studio project list/create/read/save and version routes</li>
        <li><code>GET|POST /api/studio/media/:clipId</code> — read-only waveform, downbeats, MIDI, aligned lyrics, novelty, stems, and project association</li>
        <li><code>GET /api/studio/unverified_actions</code> — list P2 writes that remain disabled or catalog-only</li>
        <li><code>POST /api/concat</code> — build a Studio timeline from ordered clip ids and render a merged full-length clip</li>
        <li><code>GET /api/get?ids=a,b,c</code> — fetch clips by ids</li>
        <li><code>POST /api/feed_by_ids</code> — fetch clips by ids with JSON body</li>
        <li><code>GET|POST /api/archive_account</code> — archive the authenticated account library; GET returns read-only persisted status for one output directory</li>
      </ul>

      <h2>Studio concat payload</h2>
      <pre><code>{`{
  "title": "My merged song",
  "wait_audio": true,
  "clips": [
    { "clip_id": "clip-id-1", "duration": 6, "order": 0 },
    { "clip_id": "clip-id-2", "duration": 6, "order": 1 },
    { "clip_id": "clip-id-3", "duration": 6, "order": 2 }
  ]
}`}</code></pre>
      <p>
        If <code>duration</code> is omitted, the server will fetch each clip and try to infer it from upstream metadata before building the Studio timeline.
      </p>

      <h2>Current verified behavior</h2>
      <ul>
        <li>Create currently posts to <code>POST /api/generate/v2-web/</code></li>
        <li>Polling / clip reads currently use <code>/api/feed/v3</code></li>
        <li>This runtime now treats <code>/api/c/check</code> as the explicit first step of create: precheck first, then branch by <code>required</code></li>
        <li>If <code>required: false</code>, runtime proceeds directly to <code>POST /api/generate/v2-web/</code></li>
        <li>If <code>required: true</code>, runtime enters the captcha branch first, solves Turnstile through 2Captcha, and only then continues create</li>
        <li>For this runtime, <code>required: true</code> should be interpreted as a challenge branch, not automatically as cookie invalidation or a broken create endpoint</li>
        <li>Default hot-song output root is <code>/Volumes/素材/TEMP/chu/热搜generate歌曲</code></li>
        <li>Default output timestamp timezone is <code>Asia/Shanghai</code> unless <code>SUNO_OUTPUT_TIMEZONE</code> is overridden</li>
        <li><code>custom_generate</code> and <code>generate</code> use a longer route timeout to stay aligned with the internal wait/poll path</li>
        <li>Current browser-captured V5.5 default model is <code>chirp-fenix</code>; older V5 captures used <code>chirp-crow</code></li>
        <li>Recent browser evidence suggests a short captcha trust window inside the same browser session: after one successful manual image-captcha solve, later creates could still succeed with <code>token = null</code>, including after page refresh and a new create window</li>
        <li><code>/api/custom_generate</code> now stops after create + wait and returns clip metadata; download/落盘 failures should be handled by the caller instead of aborting the create request</li>
        <li><code>/api/cover_generate</code> accepts <code>cover_clip_id</code> plus optional persona / workspace arguments and maps the Suno Cover path into the current HTTP runtime</li>
        <li><code>/api/extend_audio</code> accepts <code>audio_id</code> and <code>continue_at</code> and maps the Suno Remix/extend path into the current HTTP runtime</li>
        <li><code>/api/mashup_generate</code> accepts exactly two IDs in <code>mashup_clip_ids</code> and maps the browser-verified <code>task=mashup_condition</code> contract into the current HTTP runtime</li>
        <li><code>/api/song_auto_stems_download</code> accepts <code>clip_id</code> and <code>stem_format</code> (<code>wav</code> or <code>mp3</code>); it discovers or creates a stem bank, renders through HTTP, validates the ZIP, repairs the manifest when needed, and reuses a verified archive keyed only by clip ID and format</li>
        <li><code>/api/studio_multitrack</code> accepts a completed <code>studio_export</code> clip ID, resolves <code>studio_project_id</code>, reads the exact project state and renders through HTTP, validates every WAV header, records SHA256, and reuses the archive by clip ID</li>
        <li><code>/api/studio/multitrack</code> is the direct state-based path: it derives bounds, locks by request fingerprint, reuses verified output, and otherwise runs SHA-256, <code>unzip -tq</code>, WAV counting, and representative-WAV <code>ffprobe</code></li>
        <li><code>/api/studio/export</code> returns a Library Clip ID and polls <code>/api/feed/v3</code>; Full Song and Selected Time Range do not directly download a local file</li>
        <li><code>/api/studio/generate</code> is off by default and requires the paid server gate, request confirmation, and a matching Studio token; retries never recreate an ambiguous or already submitted job</li>
        <li>Workspace Project IDs and Studio Project IDs are separate public fields; the save-project adapter forces the URL Studio ID into Suno&apos;s wire field named <code>project_id</code></li>
        <li>Revision clone and archive/unarchive/bookmark/metadata writes are disabled unless the separate unverified-write gate is explicitly enabled; editor P2 writes are not forwarded</li>
        <li>Keep a stems ZIP after first download: Auto split was observed to cost 50 credits, while verified local reuse does not click Extract again</li>
        <li>Same-clip requests use a filesystem lock; unrelated Song/Studio clips, Create, polling, and ordinary downloads can run concurrently</li>
        <li>If a long <code>--via-local-api</code> account archive loses its caller connection, the CLI monitors the same output directory&apos;s persisted run status and returns that run&apos;s final result without resubmitting</li>
        <li>Detailed Studio references: <code>docs/SUNO_STUDIO_FEATURE_GUIDE_2026-08-08.md</code> and <code>docs/SUNO_STUDIO_OPERATIONS_RUNBOOK_2026-08-08.md</code></li>
      </ul>
    </main>
  );
}
