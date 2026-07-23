# Third-Party Notices

## SunoAI-API/Suno-API

This project's early implementation was referenced from and/or based on:

- Project: SunoAI-API/Suno-API
- Repository: https://github.com/SunoAI-API/Suno-API
- License: MIT License
- Original copyright notice: Copyright (c) 2024 Suno API

`unofficial-suno-api` has since been substantially rewritten and extended
through Vibe Coding, including updated create flows, captcha handling,
`final_song.json` middleware, Docker packaging, and open-source documentation.

The final project is published under the MIT License. The original MIT license
and copyright notice above are retained here for attribution and license
compatibility.

## Runtime Dependencies

This repository's own source code is licensed under MIT. Third-party npm
packages and system packages used to build or run the project keep their own
licenses.

Notable examples:

- Next.js may install optional image-processing dependencies such as
  `sharp`/`libvips`; those dependencies keep their own licenses as recorded in
  `package-lock.json`.

Users who redistribute Docker images or dependency bundles should review and
comply with the licenses of the included third-party packages.
