import Section from './components/Section';

export default function Home() {
  const routes = [
    '/api/get_limit',
    '/api/workspaces',
    '/api/create_precheck',
    '/api/generate',
    '/api/custom_generate',
    '/api/cover_generate',
    '/api/extend_audio',
    '/api/mashup_generate',
    '/api/song_auto_stems_download',
    '/api/studio_multitrack',
    '/api/studio/multitrack',
    '/api/studio/export',
    '/api/studio/generate',
    '/api/studio/projects',
    '/api/studio/media/:clipId',
    '/api/studio/unverified_actions',
    '/api/get?ids=...',
    '/api/feed_by_ids',
    '/docs',
  ];

  return (
    <>
      <Section>
        <div className="flex flex-col m-auto py-20 text-center items-center justify-center gap-4 my-8 lg:px-20 px-4 bg-indigo-900/90 rounded-2xl border shadow-2xl">
          <span className="px-5 py-1 text-xs font-light border rounded-full border-white/20 uppercase text-white/50">
            Pure HTTP Rewrite
          </span>
          <h1 className="font-bold text-6xl text-white/90">Suno API Final</h1>
          <p className="text-white/80 text-lg max-w-3xl">
            Suno HTTP runtime with verified create / poll / download flows and fixed direct-HTTP
            Studio adapters. Paid and unverified Studio writes remain disabled by default.
          </p>
        </div>
      </Section>
      <Section className="my-10">
        <div className="prose lg:prose-lg max-w-3xl">
          <h2>Current scope</h2>
          <ul>
            <li>Clerk session bootstrap + keepAlive</li>
            <li>Dynamic Browser-Token timestamp per request</li>
            <li>Create session token bootstrap</li>
            <li>Pure HTTP create via <code>/api/generate/v2-web/</code></li>
            <li><code>/api/feed/v3</code> for polling / clip reads</li>
            <li>Quota + workspace reads</li>
            <li>Verified pure-HTTP Song Auto split and Studio Multitrack downloads with resumable ZIP finalization</li>
            <li>Studio Full Song / Selected Range Library export, state-based Multitrack, project/version reads, and media analysis</li>
            <li>Instrument/Cover single-submit ledger with paid gate, idempotency, and poll-only recovery</li>
          </ul>
          <h2>Routes</h2>
          <ul>
            {routes.map((route) => (
              <li key={route}><code>{route}</code></li>
            ))}
          </ul>
        </div>
      </Section>
    </>
  );
}
