# Current Documentation

This directory contains the current production contract for the `main` branch.
Use these files for new clients, deployments, and incident response.

| Document | Use it for |
| --- | --- |
| [API reference](API_REFERENCE.md) | Complete local HTTP endpoint list |
| [Suno API guide](SUNO_API_GUIDE.md) | Supported behavior and examples |
| [Runtime SOP](SUNO_API_RUNTIME_SOP.md) | Docker, proxy, captcha, health checks, and recovery |
| [Playback media](SUNO_PLAYBACK_MEDIA.md) | Ordinary playback media retrieval and Mango decryption |
| [Account archive](SUNO_ACCOUNT_ARCHIVE.md) | Resumable account-library MP3/WAV archiving |
| [Pure HTTP stems and CLI](STEMS_HTTP_API_AND_CLI_2026-08-01.md) | Song Auto Split and Studio Multitrack |
| [Studio and stems](STUDIO_AND_STEMS.md) | Studio projects, exports, media, and transport |
| [Studio feature guide](SUNO_STUDIO_FEATURE_GUIDE_2026-08-08.md) | Detailed Studio API contracts |
| [Studio operations](SUNO_STUDIO_OPERATIONS_RUNBOOK_2026-08-08.md) | Deployment, monitoring, backup, and rollback |
| [Studio OpenCLI runtime](SUNO_STUDIO_OPENCLI_RUNTIME.md) | OpenCLI bridge and non-billing safety defaults |

The dated filenames reflect the verification date of a contract, not a
different deployment branch. If a historical note conflicts with this
directory, this directory wins unless the implementation and tests have been
updated first.
