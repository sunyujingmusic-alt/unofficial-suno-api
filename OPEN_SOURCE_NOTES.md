# unofficial-suno-api Open Source Packaging Notes

This folder is a standalone copy prepared for publication.

Copied from the runtime source tree:

- Next.js source under `src/`
- public assets under `public/`
- `Dockerfile`, `Dockerfile.production`, and `docker-compose.yml`
- package metadata and lockfile
- API documentation under `docs/`

Intentionally not copied or not meant to commit:

- `.env`
- runtime cookie files
- `.git`
- `.next`
- `node_modules`
- generated `output/`
- local logs or browser profiles

Application-specific workflows are intentionally excluded. The generic custom
create checkpoint is `final_song.json`, enforced by
`POST /api/create_from_final_song`.
