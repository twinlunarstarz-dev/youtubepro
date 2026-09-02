<p align="center">
  <img src="client/public/youtube-pro.svg" width="88" alt="YouTube Pro logo">
</p>

<h1 align="center">YouTube Pro</h1>

<p align="center">
  Research, understand, write, and package a YouTube video in one local-first workflow.
</p>

YouTube Pro is an evidence-grounded workspace for YouTube research, idea selection, script writing, transcript review, and thumbnail creation. It can use the official YouTube Data API v3, a local `yt-dlp` fallback, and independently configurable OpenAI-compatible text and image providers while keeping API keys on the local server.

The AI layer is provider-neutral. You can use OpenAI, `llama.cpp` / `llama-server`, LocalAI, Gemini's OpenAI-compatible endpoint, or another server that implements the common OpenAI chat/image contracts. Text and image generation can use the same server or completely different endpoints, models, keys, and timeouts.

YouTube Pro is an independent project. It is not affiliated with, endorsed by, or sponsored by YouTube, Google, OpenAI, LocalAI, llama.cpp, or yt-dlp.

## Product tour

### Research analytics

Search a topic, inspect the returned public-data snapshot, compare momentum and publication patterns, review data coverage, and continue into AI-assisted insights and ideas. Aggregate analytics such as medians, recency, visible-interaction ratios, tag counts, and public view velocity are calculated locally from the snapshot and do not consume AI tokens.

![YouTube Pro research analytics with video performance, momentum, duration, and publication graphs](docs/images/research-analytics.png)

### Source videos and transcripts

Review every video in the active snapshot with thumbnails, channel information, views, publication timing, likes, comments, tags, and other available public metadata. When `yt-dlp` is installed, the video detail dialog can fetch creator or automatic captions on demand. Transcript retrieval uses `--skip-download`; it does not intentionally download video/audio media.

![YouTube Pro source-video grid showing every video used in the research snapshot](docs/images/research-source-videos.png)

### AI Insights

Turn the active snapshot into a scan-first research brief with audience questions, opportunity themes, recommended moves, and a clear separation between observed evidence, inference, and metrics that require YouTube Studio. The prompt records whether the underlying research snapshot came from the official Data API or local yt-dlp so it does not misrepresent provenance.

![YouTube Pro AI Insights with visual summaries, evidence balance, and an expandable evidence ledger](docs/images/research-ai-insights.png)

### Script teleprompter

Turn a selected idea into an editable script, then read it in a focused teleprompter with pace, size, cue, undo, and playback controls. Narration extraction is deterministic and local; it does not spend an AI request simply to remove timestamps and stage directions.

![YouTube Pro teleprompter with playback and reading controls](docs/images/script-teleprompter.png)

### Thumbnail Creator

Describe the outcome once, choose optional controls, and generate a thumbnail when the configured image endpoint implements OpenAI-compatible `/images/generations`.

![YouTube Pro Thumbnail Creator with a generated thumbnail preview and minimal creation controls](docs/images/thumbnail-creator.png)

A text-only llama.cpp server can power AI Insights, Ideas, Script Writer, title/section/paragraph regeneration, thumbnail text suggestions, and local narration extraction. Generated thumbnail images require an image-capable endpoint and a configured image model.

## Workflow

1. **Research**: Search up to 50 public YouTube videos and review analytics, coverage, source videos, and optional transcripts.
2. **AI Insights**: The configured OpenAI-compatible text model analyzes the exact active research snapshot and its provenance.
3. **Grounded Ideas**: Ideas generate after valid Insights. Select one idea, then explicitly proceed to Script Writer.
4. **Script Writer**: Generate and edit a script from the selected idea package and its evidence. Section and paragraph regeneration use the same bounded evidence context.
5. **Thumbnail Creator**: Use the selected promise and thumbnail concept with the configured OpenAI-compatible image endpoint when one is enabled.

Each press of **New Workflow** creates a separate local project. Recent workflows are stored in browser IndexedDB. If browser persistence is unavailable, the current session remains usable and the UI reports that history could not be saved. Uploaded reference images are intentionally not retained.

## Requirements

- Node.js 22.12 or newer.
- For Research, either:
  - a YouTube Data API v3 key (recommended for the most consistent metadata), or
  - a current local `yt-dlp` installation for keyless/local research.
- An OpenAI-compatible text endpoint for AI-assisted features. This can be a free local server.
- Optional: a separate OpenAI-compatible image endpoint for generated thumbnails.

```bash
cp .env.example .env
npm install
npm run dev
```

The server listens on `127.0.0.1:5000` by default. Open `http://127.0.0.1:5000`.

A lightweight health endpoint is available at `http://127.0.0.1:5000/api/health`.

## Configure everything from Settings

You can start without manually editing `.env` and configure all external/model-facing settings in **Settings**.

### YouTube research

The UI exposes:

- research mode: `Automatic`, `YouTube Data API only`, or `yt-dlp only`
- YouTube Data API key and explicit key removal
- yt-dlp executable/path
- yt-dlp timeout
- local tool/version diagnostics
- research cache size and hit-rate diagnostics

`Automatic` mode prefers the official Data API when a key exists. If that request fails because the key is missing/rejected, quota is unavailable, the network times out, or the provider is unavailable, it can fall back to a working local yt-dlp installation. Results always record their source in research provenance.

### LLM / text generation

- OpenAI-compatible base URL
- exact model ID
- API key and explicit removal
- request timeout
- `/models` discovery when supported
- small live `/chat/completions` connection/latency test

### Image generation

- independent OpenAI-compatible base URL
- exact image model ID
- independent API key and explicit removal
- image size (`WIDTHxHEIGHT` or `auto`)
- request/download timeout
- `/models` discovery when supported
- one-click reuse of the LLM endpoint URL

This lets you mix providers. For example, llama.cpp can handle text at `http://127.0.0.1:8080/v1` while LocalAI or another OpenAI-compatible service handles images elsewhere.

Settings writes replacements to the ignored `.env` file with owner-only permissions. Saved secrets are never returned to the browser. Settings and provider diagnostics accept direct loopback, same-origin requests only and reject normal forwarded/reverse-proxy requests.

## Research source modes

### Automatic (recommended)

```dotenv
YOUTUBE_SOURCE=auto
YOUTUBE_API_KEY=optional-google-api-key
YTDLP_PATH=yt-dlp
```

This gives the official API priority while retaining a local fallback.

### Official API only

```dotenv
YOUTUBE_SOURCE=api
YOUTUBE_API_KEY=your-google-api-key
```

Use this when you need the most consistent YouTube public metadata and do not want local extraction.

### Local yt-dlp only

```dotenv
YOUTUBE_SOURCE=ytdlp
YOUTUBE_API_KEY=
YTDLP_PATH=yt-dlp
```

This removes the YouTube API-key requirement. yt-dlp is a third-party tool rather than an official YouTube API; YouTube changes can temporarily break extraction/search behavior, and metadata/search ordering can differ. Keep yt-dlp current.

YouTube Pro invokes yt-dlp through `execFile` without a shell, forces `--no-config`, bounds runtime/output, and uses `--skip-download`/`--no-playlist` for the research/transcript paths.

## Lowest-cost / fully local setup

A fully keyless/paid-API-free setup is possible when local tools/models are available:

- **YouTube research:** local yt-dlp.
- **Research analytics:** deterministic local calculations.
- **AI text:** local llama.cpp or LocalAI.
- **Narration extraction:** deterministic local cleanup.
- **Transcripts:** local yt-dlp captions.
- **Generated thumbnail:** optional local image-capable OpenAI-compatible endpoint, or leave image generation disabled.

For maximum research consistency, use the YouTube Data API free quota and keep yt-dlp as fallback.

Identical searches are cached for 15 minutes by default, including concurrent identical requests. Failed requests are not cached. Cache keys include the selected research source configuration so API and yt-dlp snapshots cannot cross-contaminate one another.

## OpenAI-compatible API behavior

Text requests use the configured LLM base URL plus:

- `POST /chat/completions`
- `GET /models` for optional Settings discovery

Image requests use the configured image base URL plus:

- `POST /images/generations`
- `GET /models` for optional Settings discovery

Structured text requests first use `response_format: {"type":"json_object"}`. If a compatible server rejects that optional field, YouTube Pro retries without it and still validates returned JSON against application schemas.

Authorization headers are sent only when the corresponding provider key is non-empty. LLM and image keys are independent.

## Provider examples

### llama.cpp / llama-server for text

```dotenv
AI_TEXT_BASE_URL=http://127.0.0.1:8080/v1
AI_TEXT_API_KEY=
AI_TEXT_MODEL=local-model
AI_TIMEOUT_MS=120000
AI_IMAGE_MODEL=
```

### LocalAI for text and images

```dotenv
AI_TEXT_BASE_URL=http://127.0.0.1:8080/v1
AI_TEXT_API_KEY=
AI_TEXT_MODEL=your-text-model
AI_TIMEOUT_MS=120000

AI_IMAGE_BASE_URL=http://127.0.0.1:8080/v1
AI_IMAGE_API_KEY=
AI_IMAGE_MODEL=your-image-model
AI_IMAGE_SIZE=1024x1024
AI_IMAGE_TIMEOUT_MS=300000
```

### Split local text + hosted image provider

```dotenv
AI_TEXT_BASE_URL=http://127.0.0.1:8080/v1
AI_TEXT_API_KEY=
AI_TEXT_MODEL=local-model

AI_IMAGE_BASE_URL=https://example-image-provider.test/v1
AI_IMAGE_API_KEY=your-image-provider-key
AI_IMAGE_MODEL=your-image-model
AI_IMAGE_SIZE=1024x1024
```

### OpenAI

```dotenv
AI_TEXT_BASE_URL=https://api.openai.com/v1
AI_TEXT_API_KEY=your-openai-api-key
AI_TEXT_MODEL=your-text-model-id

AI_IMAGE_BASE_URL=https://api.openai.com/v1
AI_IMAGE_API_KEY=your-openai-api-key
AI_IMAGE_MODEL=your-image-model-id
AI_IMAGE_SIZE=1536x1024
```

Use exact model IDs available to your account rather than relying on a hardcoded allowlist.

### Gemini through OpenAI compatibility

```dotenv
AI_TEXT_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_TEXT_API_KEY=your-gemini-api-key
AI_TEXT_MODEL=your-gemini-text-model
```

Existing installs that only contain `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, and `GEMINI_IMAGE_MODEL` are automatically mapped through Gemini's compatibility endpoint until modern AI settings are saved.

## Configuration reference

| Variable | Purpose | Default |
| --- | --- | --- |
| `YOUTUBE_SOURCE` | `auto`, `api`, or `ytdlp` research source | `auto` |
| `YOUTUBE_API_KEY` | Optional YouTube Data API v3 key | Empty |
| `YTDLP_PATH` | yt-dlp executable/path | `yt-dlp` |
| `YTDLP_TIMEOUT_MS` | yt-dlp research/transcript timeout | `120000` |
| `YOUTUBE_CACHE_TTL_MS` | In-memory lifetime for identical research searches | `900000` |
| `YOUTUBE_CACHE_MAX_ENTRIES` | Maximum cached research queries per process | `100` |
| `AI_TEXT_BASE_URL` | OpenAI-compatible LLM API root | `http://127.0.0.1:8080/v1` |
| `AI_TEXT_API_KEY` | Optional LLM Bearer token/API key | Empty |
| `AI_TEXT_MODEL` | Exact text model ID | `local-model` |
| `AI_TIMEOUT_MS` | LLM request timeout | `120000` |
| `AI_IMAGE_BASE_URL` | OpenAI-compatible image API root | shared/local default |
| `AI_IMAGE_API_KEY` | Optional independent image Bearer token/API key | Empty/shared fallback |
| `AI_IMAGE_MODEL` | Exact image model ID; blank disables generated images | Empty |
| `AI_IMAGE_SIZE` | Provider-specific image size or `auto` | `1536x1024` |
| `AI_IMAGE_TIMEOUT_MS` | Image request/download timeout | `300000` |
| `AI_BASE_URL` | Backward-compatible shared endpoint fallback | Local default |
| `AI_API_KEY` | Backward-compatible shared key fallback | Empty |
| `PORT` | Local HTTP port | `5000` |
| `HOST` | Bind address | `127.0.0.1` |

Split AI variables take precedence over shared aliases. Saving from the current Settings UI writes split text/image configuration and synchronizes the old shared aliases with the text provider for backward compatibility.

## Compatibility and limitations

- OpenAI-compatible APIs are not perfectly identical. YouTube Pro intentionally uses a small common subset and validates structured responses.
- `/models` is optional in practice. Failure to discover models does not prevent manual model IDs from working.
- A server that supports `/chat/completions` but not `/images/generations` is fully usable for text features.
- Text and image endpoints may be different providers, hosts, authentication credentials, and timeout profiles.
- Reference-image editing is not standardized across the targeted OpenAI-compatible servers. Generic image generation rejects reference-image editing rather than silently ignoring references.
- Local models vary in JSON reliability. Instruction-tuned models with enough context window for the research snapshot work best.
- yt-dlp is a resilient fallback, not an official YouTube API. Keep it updated and use Data API-only mode when strict official-source behavior is required.
- Search snapshots are public-data samples, not YouTube Studio/Analytics. Missing fields remain unavailable rather than being converted to zero.

## Data and request limits

- Research query: 1 to 200 characters.
- Research sample: 1 to 50 videos returned per request. yt-dlp may inspect additional candidates locally before filters are applied.
- AI evidence input: exactly the active ordered snapshot, at most 50 videos, with deterministic aggregate analytics and provenance.
- Transcript response: up to 200,000 characters / 10,000 caption segments.
- Script input: topic up to 500 characters, custom tone traits up to 300, notes up to 5,000, script/section content up to 80,000 where applicable.
- Thumbnail references: PNG or JPEG, 128 to 4096 pixels, at most 5 MB after preparation per image, 12 MB decoded total, and no more than three references.
- Generated image downloads are capped at 25 MB.
- Global JSON body: 18 MB, needed for bounded base64 thumbnail references.
- Provider routes: 10 requests per client address per 60 seconds in the local server.

## Daily-use reliability notes

- Startup rejects malformed `PORT`/`HOST` values rather than silently coercing them.
- `SIGINT` and `SIGTERM` perform graceful HTTP shutdown with a bounded fallback.
- `/api/health` provides a simple process health check.
- Settings diagnostics show the active research source, yt-dlp availability/version, and search-cache health.
- Browser workflow history uses IndexedDB. Failure of the small localStorage active-workflow pointer no longer breaks workflow saving/editing.
- API errors are decoded into readable messages instead of raw JSON strings.
- CI can be launched manually from **Actions → CI → Run workflow** in addition to pull-request and `main` push triggers.

## Privacy and access model

- API keys stay server-side and `.env` is ignored.
- Saved secrets are never included in Settings status responses.
- Recent workflow history stays in the current browser profile.
- Request and response bodies are not logged.
- The application binds to loopback unless `HOST` is explicitly changed.
- Local AI endpoints keep prompt/evidence traffic on the machine. Hosted endpoints receive the prompts and research data needed for the selected AI operation.
- yt-dlp contacts YouTube when used for research or transcripts.
- Do not expose the server directly to the internet. If remote access is required, add authentication and rate limiting at a trusted gateway and separately protect Settings.

## Commands

```bash
npm run dev       # development server
npm test          # contract and provider-behavior tests
npm run check     # TypeScript check
npm run build     # production client and server build
npm start         # run the production build
```

Continuous integration runs tests, TypeScript checking, and the production build on pull requests and pushes to `main`. It also supports `workflow_dispatch` so the same quality gate can be started manually from GitHub Actions.

## Technology

- React 18, TypeScript, Vite, Tailwind CSS, and shadcn/ui
- Express 5
- OpenAI-compatible HTTP APIs with no provider SDK required for the active AI path
- YouTube Data API v3 and optional local yt-dlp research/transcript fallback
- No server-side runtime database, session store, Passport authentication, or Replit-managed AI proxy

The legacy `@google/genai` dependency and Gemini implementation remain temporarily for migration compatibility and existing provider contract tests, but active routes use the provider-neutral OpenAI-compatible layer.

## Quotas and costs

| Component | Can be free/local? | Notes |
| --- | --- | --- |
| YouTube research | Yes | yt-dlp can be keyless/local; Data API free quota is recommended for consistency |
| Deterministic research analytics | Yes | Computed locally |
| Transcripts | Yes | yt-dlp creator/automatic captions when available |
| Insights / Ideas / Scripts | Yes | Use local llama.cpp or LocalAI |
| Narration extraction | Yes | Deterministic local processing |
| Thumbnail text suggestions | Yes | Uses the configured text model |
| Generated thumbnail image | Yes, with a local image server | Otherwise use a hosted image-capable provider or leave disabled |

Useful documentation:

- [YouTube Data API quota costs](https://developers.google.com/youtube/v3/determine_quota_cost)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [llama.cpp server](https://github.com/ggml-org/llama.cpp/tree/master/tools/server)
- [LocalAI](https://localai.io/)
- [OpenAI API reference](https://platform.openai.com/docs/api-reference)
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)

## License

YouTube Pro is open source under the [Apache License 2.0](LICENSE).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the local quality gate. Report security issues privately according to [SECURITY.md](SECURITY.md), never in a public issue.
