export default function DocsPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16 prose lg:prose-lg">
      <h1>unofficial-suno-api / Pure HTTP Rewrite</h1>
      <p>
        This unofficial build exposes the currently validated Suno HTTP
        capabilities for create, poll, workspace, captcha, and
        <code>final_song.json</code>-driven custom create.
      </p>

      <h2>Available endpoints</h2>
      <ul>
        <li><code>GET /api/get_limit</code> — read credits / quota</li>
        <li><code>GET /api/workspaces</code> — list workspaces (<code>?show_trashed=true|1</code> supported)</li>
        <li><code>POST /api/create_precheck</code> — run <code>/api/c/check</code> and report the current captcha branch</li>
        <li><code>POST /api/captcha_coordinates</code> — solve browser-captured hCaptcha coordinates through 2Captcha</li>
        <li><code>PATCH /api/captcha_coordinates</code> — report an incorrect coordinate result back to 2Captcha</li>
        <li><code>POST /api/create_from_final_song</code> — validate and write <code>final_song.json</code>, then submit the exact same title, lyrics, and styles to custom create</li>
        <li><code>POST /api/generate</code> — prompt-mode create</li>
        <li><code>POST /api/custom_generate</code> — custom-mode create + wait; clients handle MP3/WAV download separately</li>
        <li><code>GET /api/clip?id=...</code> — fetch one exact clip by id</li>
        <li><code>GET /api/get?ids=a,b,c</code> — fetch clips by ids</li>
        <li><code>POST /api/feed_by_ids</code> — fetch clips by ids with JSON body</li>
      </ul>

      <h2>Current verified behavior</h2>
      <ul>
        <li>Create currently posts to <code>POST /api/generate/v2-web/</code></li>
        <li>Polling / clip reads currently use <code>/api/feed/v3</code></li>
        <li><code>final_song.json</code> is the create checkpoint for custom songs: exactly <code>title</code>, <code>lyrics</code>, and <code>styles</code>, all strings</li>
        <li>This runtime now treats <code>/api/c/check</code> as the explicit first step of create: precheck first, then branch by <code>required</code></li>
        <li>If <code>required: false</code>, runtime proceeds directly to <code>POST /api/generate/v2-web/</code></li>
        <li>If <code>required: true</code>, runtime enters the captcha branch first and then continues by the currently reported challenge type</li>
        <li>For this runtime, <code>required: true</code> should be interpreted as a challenge branch, not automatically as cookie invalidation or a broken create endpoint</li>
        <li>Default output root is <code>SUNO_OUTPUT_DIR</code>, falling back to <code>./output</code> locally or <code>/app/output</code> in Docker Compose</li>
        <li>Default output timestamp timezone is <code>Asia/Shanghai</code> unless <code>SUNO_OUTPUT_TIMEZONE</code> is overridden</li>
        <li><code>custom_generate</code> and <code>generate</code> use a longer route timeout to stay aligned with the internal wait/poll path</li>
        <li>Current browser-captured V5.5 default model is <code>chirp-fenix</code>; older V5 captures used <code>chirp-crow</code></li>
        <li>Recent browser evidence suggests a short captcha trust window inside the same browser session: after one successful manual image-captcha solve, later creates could still succeed with <code>token = null</code>, including after page refresh and a new create window</li>
        <li><code>/api/custom_generate</code> now stops after create + wait and returns clip metadata; download/落盘 failures should be handled by the caller instead of aborting the create request</li>
        <li>Runtime is intentionally minimal; this repository focuses on the maintained HTTP paths rather than unrelated business workflows</li>
      </ul>
    </main>
  );
}
