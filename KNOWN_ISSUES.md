# Known Issues

## Lumina Gemini Image Understanding Connectivity

- Date: 2026-06-06
- Area: Lumina API integration, image understanding models
- Status: unresolved upstream/runtime validation

Lumina `/v1/models` returns these Gemini image-understanding candidates:

- `gemini-3.1-pro-preview`
- `gemini-3-pro-preview`
- `gemini-3-flash`

Direct Anthropic-compatible image requests using an inline project PNG reached Lumina but all three Gemini candidates timed out after 12 seconds in local validation. `gemini-3-flash-preview` is not available for this Lumina key and must not be configured for Lumina.

GPT image-understanding candidates were reachable with the same inline PNG. `gpt-5.5` and `gpt-5.3-codex` returned non-empty content; `gpt-5.4` and `gpt-5.4-mini` returned HTTP 200 with empty text in that smoke test.

Do not use local file URLs to validate image understanding providers. Convert local assets to base64 data before sending; some upstream providers cannot access localhost or private workspace URLs.

## Local Node 24 Blocks Native Test Dependencies

- Date: 2026-06-06
- Area: local test runner dependency
- Status: local environment issue; use Node 22

The shell default Node 24 currently fails before loading tests because macOS refuses to `dlopen`
some native dependencies, including:

- `node_modules/@rollup/rollup-darwin-arm64/rollup.darwin-arm64.node`
- `node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node`

Confirmed with the minimal command:

```bash
node -e "require('@rollup/rollup-darwin-arm64')"
```

The project dev server and validation commands work under the Node 22 installation used by the running service:

```bash
/opt/homebrew/Cellar/node@22/22.22.3/bin/node node_modules/vitest/vitest.mjs run ...
```

Attempts already made:

- `npm rebuild @rollup/rollup-darwin-arm64`
- remove and reinstall `@rollup/rollup-darwin-arm64@4.57.1`
- clear extended attributes on the native binary
- ad-hoc re-sign the native binary with `codesign --force --sign -`

All attempts still produced the same `mapping process and mapped file (non-platform) have different Team IDs`
error under default Node 24. Use Node 22 for local Vitest and Prisma scripts until the default local runtime is repaired.

## Storyboard Image Generation Task Stalls At Provider Call

- Date: 2026-06-09
- Area: Agent workflow, storyboard image generation API
- Status: resolved after updating HFSY provider key

Local API and worker queue are reachable:

- Workspace route returned HTTP 200.
- Episode storyboards API returned 3 storyboards and 3 panels.
- `POST /api/novel-promotion/{projectId}/regenerate-panel-image` returned `success: true` and created task `a7a07f0f-b049-4e9d-9a3e-f393551e04bc`.
- Worker picked up the task and moved it to `processing`.

The task then stayed at progress `18` for the full polling window, with heartbeat updates and no error/result. Billing metadata showed the configured image model as:

- `openai-compatible:hfsy-image-test::gpt-image-2`

This indicates the local app API, task queue, and worker handoff are working, but the external image generation provider call did not return within the validation window. Re-test with provider-side logs or a known-fast image model before treating the end-to-end Agent image stage as production-ready.

Resolution on 2026-06-09:

- Updated the stored `openai-compatible:hfsy-image-test` provider key with the new HFSY key.
- Direct `POST https://www.hfsyapi.cn/v1/images/generations` returned HTTP 200 in about 74 seconds.
- The response did not include `b64_json` despite `response_format: b64_json`; it returned `data[0].url`, which the existing template already supports.
- Retested `POST /api/novel-promotion/{projectId}/regenerate-panel-image`; task `3233b429-a969-4d92-af51-6183e2afef15` completed and wrote an image to panel `5c14d929-6594-4a9d-a6a4-29c9fd6b4faf`.
- The normalized media URL returned HTTP 200 with `content-type: image/png`.

## Agent Final Video Generation Needs A Default Video Model

- Date: 2026-06-09
- Area: Agent workflow, video generation stage
- Status: resolved with `doubao-seedance-1-0-pro-fast-251015`; Lite remains unavailable for this key

The Agent workflow now includes a final `视频生成` stage after storyboard images are ready. The local/default model configuration has been repaired:

- default video model resolves to `ark::doubao-seedance-1-0-pro-fast-251015`
- missing video capability options are now defaulted to `generationMode: normal`, `duration: 5`, `resolution: 720p`

Validation on 2026-06-09:

- `POST /api/novel-promotion/{projectId}/generate-video` returned HTTP 200 and queued task `c04ea9cf-f538-41a0-a851-d3cc0215672e`.
- The worker picked up the task and reached the Ark provider call.
- Ark returned `InvalidEndpointOrModel.NotFound` for `doubao-seedance-1-0-lite-i2v-250428`.
- Direct Ark validation with the same key returned HTTP 200 for `doubao-seedance-1-0-pro-fast-251015` and created task `cgt-20260609160631-h2c5j`.
- Nori route validation queued task `389681cd-8f09-46fd-81dc-e18c2467cbba`, created external Ark task `ARK:VIDEO:cgt-20260609160752-sstsd`, completed successfully, and wrote `images/panel-video-7a26998a-f8b7-487f-8565-94c0bd61e60b-1780992513639-vkhq62.mp4`.
- The local file endpoint returned HTTP 200 with `content-type: video/mp4`.

Current remaining blocker:

- `doubao-seedance-1-0-lite-i2v-250428` still returns `InvalidEndpointOrModel.NotFound` for this key.
- Use `doubao-seedance-1-0-pro-fast-251015` as the default validated Ark video model until Lite access/model naming is confirmed in the Volcengine console.

True one-prompt-to-video output is now unblocked for the local/default Ark setup as long as the project video model is `ark::doubao-seedance-1-0-pro-fast-251015`.

Update on 2026-06-10:

- Default test-mode video model was moved to `ark::doubao-seedance-2-0-260128`.
- Direct provider smoke created a Seedance 2.0 task successfully with this key.
- Live Agent smoke with real-person storyboard images reached the final video stage, but all 4 Ark video tasks failed before task creation with `InputImageSensitiveContentDetected.PrivacyInformation`.
- Ark message: the input image may contain a real person.

Current production risk:

- Real-person short-drama workflows can successfully generate story, script, locked assets, storyboards, and storyboard images, but Seedance 2.0 may reject image-to-video when the input storyboard contains a photorealistic person/face.
- This is an upstream/provider moderation or account-policy blocker, not a local queue or database write failure.
- Keep a non-real-person Agent live smoke as the code-path regression test. For真人短剧, confirm Volcengine account permissions/content policy or use a provider/model that explicitly supports generated real-person image-to-video.

## HFSY Reference Images Should Not Use Local URLs

- Date: 2026-06-09
- Area: image-to-image reference handling, HFSY image API
- Status: mitigated in local workflow

HFSY or other upstream image providers may not be able to fetch `localhost`, private workspace URLs, or transient Next.js image URLs. The current worker reference-image path normalizes character, location, prop, and panel sketch references through `normalizeReferenceImagesForGeneration`, which fetches the media locally and sends base64 `data:` URLs to the provider.

Do not store cloud storage access keys in the repository. If base64 references become too large or an upstream provider rejects `data:` URLs, add a managed object-storage uploader through environment variables or a secret manager, then emit public/signed HTTPS URLs from that uploader.
