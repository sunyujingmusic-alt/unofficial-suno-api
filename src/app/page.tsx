import Section from './components/Section';

export default function Home() {
  const routes = [
    '/api/get_limit',
    '/api/workspaces',
    '/api/create_precheck',
    '/api/captcha_coordinates',
    '/api/create_from_final_song',
    '/api/generate',
    '/api/custom_generate',
    '/api/clip?id=...',
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
          <h1 className="font-bold text-4xl sm:text-5xl lg:text-6xl break-words text-white/90">
            unofficial-suno-api
          </h1>
          <p className="text-white/80 text-lg max-w-3xl">
            Unofficial Suno HTTP runtime for create, poll, workspaces, and the strict
            <code className="mx-1">final_song.json</code> handoff.
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
            <li><code>final_song.json</code> field-contract validation before custom create</li>
            <li>Pure HTTP create via <code>/api/generate/v2-web/</code></li>
            <li><code>/api/feed/v3</code> for polling / clip reads</li>
            <li>Quota + workspace reads</li>
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
