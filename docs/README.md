# Documentation

The repository is organized by audience and lifecycle. Start here instead of
opening the historical probe notes first.

## Start here

1. [Beginner deployment guide](guides/BEGINNER_DEPLOYMENT_GUIDE_ZH.md) — Docker
   setup, cookie configuration, first health check, and a small Create test.
2. [Current API reference](current/API_REFERENCE.md) — the complete local HTTP
   route list and request behavior.
3. [Runtime SOP](current/SUNO_API_RUNTIME_SOP.md) — container, proxy, captcha,
   health-check, and recovery rules.

## Current production contract

These documents describe the code shipped on `main` and should be preferred for
new integrations:

- [Suno API guide](current/SUNO_API_GUIDE.md) — supported capabilities and
  minimal examples.
- [Playback media](current/SUNO_PLAYBACK_MEDIA.md) — ordinary song playback
  retrieval through `media_urls` and Mango decryption. This route does not call
  Suno's Download function.
- [Account archive command](current/SUNO_ACCOUNT_ARCHIVE.md) — resumable MP3/WAV
  archive CLI and manifest contract.
- [Pure HTTP stems and CLI](current/STEMS_HTTP_API_AND_CLI_2026-08-01.md) — Song
  Auto Split and Studio Multitrack production path.
- [Studio and stems](current/STUDIO_AND_STEMS.md) — Studio exports, projects,
  media analysis, and Studio 2.0 transport.
- [Studio feature guide](current/SUNO_STUDIO_FEATURE_GUIDE_2026-08-08.md) —
  detailed Studio HTTP contracts and verification boundaries.
- [Studio operations runbook](current/SUNO_STUDIO_OPERATIONS_RUNBOOK_2026-08-08.md)
  — backup, deployment, monitoring, and rollback.
- [Studio OpenCLI runtime](current/SUNO_STUDIO_OPENCLI_RUNTIME.md) — the
  non-billing OpenCLI bridge and safety defaults.

## Task guides

- [Create verification guide](guides/CREATE_VERIFICATION_ZH.md) — challenge
  branching, same-browser hCaptcha handling, and success criteria.
- [Create quick reference](guides/CREATE_AGENT_QUICK_REFERENCE_ZH.md) — short
  Agent handoff card.
- [Account archive operations](guides/ACCOUNT_ARCHIVE.md) — selection, locking,
  retries, and local API recovery.

## Historical evidence

[Archive index](archive/README.md) contains dated captures, probes, audits, and
older browser-backed acceptance records. They are retained for protocol
history and regression investigation; they are not the default deployment
instructions.

## Packaging and licensing

- [Open-source packaging notes](meta/OPEN_SOURCE_NOTES.md) — what is included
  and what is intentionally excluded.
- [Snapshot verification](meta/VERIFICATION.md) — packaging and test evidence.
- [Third-party notices](../THIRD_PARTY_NOTICES.md) — project and dependency
  notices.

The source of truth for implementation remains `src/`, `scripts/`, and `tests/`.
Documentation is intentionally separated so moving or adding a note cannot
change the runtime API surface.
