# Open-Source Packaging Notes

Source snapshot date: August 11, 2026.

Included:

- generic Next.js API source;
- account archive, stems, and Studio CLIs;
- non-paid archive tests;
- generic public assets;
- Docker and local-development configuration;
- public documentation.

Excluded:

- `.env` and all credentials;
- runtime Cookie files and backups;
- downloaded media, manifests, ZIP files, and `.part` state;
- Studio state and paid-submission records;
- `.next`, `node_modules`, logs, packet captures, and private backup trees;
- production-only documentation containing machine paths or live acceptance
  details;
- the removed non-original audio-slicing upload feature.

All output defaults have been changed to repository-local `output/` and
`studio-state/` storage. Docker binds only to localhost unless the operator
explicitly changes `SUNO_API_BIND`.
