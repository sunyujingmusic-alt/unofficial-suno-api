# Suno V5.5 Browser Capture Notes — 2026-04-08

This note records the browser-side findings captured from the managed Suno create page on 2026-04-08.

## Primary finding: model switch from V5 to V5.5

Previously retained V5 browser captures used:

- `mv = chirp-crow`
- response `model_name = chirp-crow`
- response `major_model_version = v5`

The 2026-04-08 V5.5 browser captures showed:

- `mv = chirp-fenix`
- response `model_name = chirp-fenix`
- response `major_model_version = v5.5`

## Captured request / response evidence

Primary successful request:

- `tmp/live-v55-capture/2026-04-08T01-34-13-627Z_generate_request.json`
- `tmp/live-v55-capture/2026-04-08T01-34-14-281Z_generate_full.json`

Important fields from that request:

```json
{
  "url": "https://studio-api-prod.suno.com/api/generate/v2-web/",
  "method": "POST",
  "postData": {
    "token": null,
    "generation_type": "TEXT",
    "mv": "chirp-fenix",
    "metadata": {
      "web_client_pathname": "/create",
      "is_max_mode": false,
      "is_mumble": false,
      "create_mode": "custom",
      "user_tier": "...",
      "create_session_token": "...",
      "disable_volume_normalization": false
    }
  }
}
```

Important fields from the response:

```json
{
  "clips": [
    {
      "major_model_version": "v5.5",
      "model_name": "chirp-fenix"
    }
  ]
}
```

## Captcha / trust-window findings

### 1. First manual create required image captcha

In the managed browser, the first V5.5 create in this session encountered an image captcha. The user solved it manually and the create succeeded.

### 2. Second create succeeded with `token = null`

A later create in the same browser session was captured with:

- `postData.token = null`
- response `200`

This strongly suggests that create is **not** strictly enforcing a fresh captcha token on every request after the browser session has already passed a challenge.

### 3. Trust window survived refresh and a new create window

Additional low-cost experiments were run manually:

1. Refresh the current create page, then create again
2. Open a new browser window, navigate to `https://suno.com/create`, then create again

In both cases, the user reported **no image captcha reappeared**, and successful generated clips were visible afterward.

Observed generated songs from these follow-up experiments:

- `白玉兰传承`
  - `a9a6d5b6-8d92-401d-a167-7fe41088cc79`
  - `c41d6a63-21ec-46c3-97ac-e0e240523757`
- `白玉兰新芽`
  - `fcadd6f2-ff67-4a6c-adbd-5f10936a7117`
  - `69ae1cf4-28ee-4b77-8c1c-098d0a4374a0`

## Current interpretation

The most conservative interpretation is:

- the trust window is **not merely tab-local**
- it survives at least:
  - page refresh
  - another create page in a new browser window
- it currently looks more like a **browser session / account trust window** than a one-request token gate

## What remains unverified

The following were **not** yet proven by this capture set:

- whether the trust window survives a full browser restart
- whether it survives hours of idle time
- whether it survives across days
- whether auth refresh / cookie rotation / IP changes reset it immediately

## Engineering implication

The correct workflow interpretation is:

- keep **2Captcha** as an important automation path
- allow **manual verification** as a first-class human-in-the-loop recovery/boost path
- do **not** treat manual success as justification to remove automated captcha handling
