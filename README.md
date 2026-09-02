<p align="center">
  <img src="client/public/youtube-pro.svg" width="88" alt="YouTube Pro logo">
</p>

<h1 align="center">YouTube Pro</h1>

<p align="center">
  Research, understand, write, and package a YouTube video in one local-first workflow.
</p>

YouTube Pro is an evidence-grounded workspace for YouTube research, idea selection, script writing, and thumbnail creation. It combines official public YouTube Data API v3 records with any OpenAI-compatible AI endpoint while keeping API keys on the local server.

The AI layer is provider-neutral. You can use OpenAI, `llama.cpp`/`llama-server`, LocalAI, Gemini's OpenAI-compatible endpoint, or another server that implements the OpenAI chat-completions contract. A local text model can run the AI research/writing workflow with no paid AI API calls.

YouTube Pro is an independent project. It is not affiliated with, endorsed by, or sponsored by YouTube, Google, OpenAI, LocalAI, or llama.cpp.

## Product tour

### Research analytics

Search a topic, inspect the returned public-data snapshot, compare momentum and publication patterns, review data coverage, and continue into AI-assisted insights and ideas. Aggregate analytics such as medians, recency, visible-interaction ratios, tag counts, and public view velocity are calculated locally from the snapshot and do not consume AI tokens.

![YouTube Pro research analytics with video performance, momentum, duration, and publication graphs](docs/images/research-analytics.png)

### Source videos

Review every video included in the active public-data snapshot, with thumbnails, channel information, views, publication timing, likes, and comments visible in one grid.

![YouTube Pro source-video grid showing every video used in the research snapshot](docs/images/research-source-videos.png)

### AI Insights

Turn the active snapshot into a scan-first research brief with audience questions, opportunity themes, recommended moves, and a clear separation between observed evidence, inference, and metrics that require YouTube Studio.

![YouTube Pro AI Insights with visual summaries, evidence balance, and an expandable evidence ledger](docs/images/research-ai-insights.png)

### Script teleprompter

Turn a selected idea into an editable script, then read it in a focused teleprompter with pace, size, cue, undo, and playback controls. Narration extraction is deterministic and local; it no longer spends an AI request simply to remove timestamps and stage directions.

![YouTube Pro teleprompter with playback and reading controls](docs/images/script-teleprompter.png)

### Thumbnail Creator

Describe the outcome once, choose optional controls, and generate a thumbnail when the configured endpoint implements OpenAI-compatible `/images/generations`.

![YouTube Pro Thumbnail Creator with a generated thumbnail preview and minimal creation controls](docs/images/thumbnail-creator.png)

> OpenAI-compatible text APIs are much more widely implemented than image APIs. A text-only `llama.cpp` server can use Research, AI Insights, Ideas, Script Writer, title/section/paragraph regeneration, thumbnail text suggestions, and local narration extraction. Generated thumbnail images require a compatible image-generation endpoint and `AI_IMAGE_MODEL`.

These screenshots come from a live local development build using public YouTube metadata. They are not generated interface mockups.

## Workflow

The product follows one continuous workflow:

1. **Research**: Search up to 50 public YouTube videos, review the overview, analytics, coverage, and every returned video.
2. **AI Insights**: The configured OpenAI-compatible text model analyzes the exact active research snapshot. Claims retain their snapshot identity and source video IDs, or are explicitly labeled as aggregate inference or as requiring YouTube Studio.
3. **Grounded Ideas**: Ideas generate after valid Insights. Select one idea, then explicitly proceed to Script Writer.
4. **Script Writer**: Generate and edit a script from the selected idea package and its evidence. Section and paragraph regeneration use the same bounded evidence context.
5. **Thumbnail Creator**: Use the selected promise and thumbnail concept with an OpenAI-compatible image endpoint when one is configured.

There is no standalone Ideas screen. The legacy `/ideas` path redirects to the Ideas section inside Research.

Each press of **New Workflow** creates a separate local project. The sidebar keeps the eight most recent workflows in browser IndexedDB, lets the user rename or delete them, and reopens the last active Research, Script, or Thumbnail step. Research snapshots, generated ideas, editable scripts, thumbnail briefs, and generated thumbnail results are restored together. Uploaded reference images are intentionally not retained.

## Requirements

- Node.js 22.12 or newer. CI verifies Node.js 22.12 and the current Node.js 24 LTS line.
- A YouTube Data API v3 key for Research search and public statistics. Google provides a free quota; this is quota-limited, not a keyless API.
- An OpenAI-compatible text endpoint for AI Insights, Ideas, and Script Writer. This can be a free local server.
- Optional: an OpenAI-compatible image endpoint for generated thumbnails.

```bash
cp .env.example .env
npm install
npm run dev
```

The server listens on `127.0.0.1:5000` by default. Open `http://127.0.0.1:5000`.

You can also start without editing `.env` and configure the connections in **Settings**. Settings writes replacements to the ignored `.env` file with owner-only permissions. Saved secrets are never returned to the browser. Settings accepts direct loopback, same-origin requests only and rejects normal forwarded or reverse-proxy requests.

## Lowest-cost / free local setup

The cheapest supported setup is:

- **YouTube research:** official YouTube Data API v3 free quota.
- **Research analytics:** computed locally from the returned public metadata.
- **AI text:** local `llama.cpp` or LocalAI model, so there is no paid AI API usage.
- **Narration extraction:** local deterministic cleanup, no AI request.
- **Generated thumbnail image:** optional. Leave `AI_IMAGE_MODEL` blank if your local server is text-only, or configure a local image-capable LocalAI endpoint.

The server caches identical YouTube searches for 15 minutes by default, including concurrent identical requests. This avoids spending repeated search quota when you revisit or refresh the same research query. Failed requests are never cached.

You can tune this behavior with `YOUTUBE_CACHE_TTL_MS` and `YOUTUBE_CACHE_MAX_ENTRIES`. The cache is in-memory and resets when the server restarts.

## OpenAI-compatible configuration

The application calls these provider paths relative to `AI_BASE_URL`:

- `POST /chat/completions` for text features.
- `POST /images/generations` for generated thumbnail images.

Structured text requests first use `response_format: {"type":"json_object"}`. If a compatible server rejects that optional field, YouTube Pro automatically retries the request without `response_format` and still validates the returned JSON against the application schemas.

API keys are optional. The `Authorization: Bearer ...` header is sent only when `AI_API_KEY` is non-empty.

### llama.cpp / llama-server

Start `llama-server` with an instruction-following GGUF model, then use the local OpenAI-compatible endpoint. A typical configuration is:

```dotenv
AI_BASE_URL=http://127.0.0.1:8080/v1
AI_API_KEY=
AI_TEXT_MODEL=local-model
AI_IMAGE_MODEL=
```

`llama-server` commonly serves one loaded text model, so the model name may be informational depending on your server configuration. Leave the image model blank because standard llama.cpp is text-only.

### LocalAI

For a LocalAI server listening on port 8080:

```dotenv
AI_BASE_URL=http://127.0.0.1:8080/v1
AI_API_KEY=
AI_TEXT_MODEL=your-localai-text-model
AI_IMAGE_MODEL=your-localai-image-model
AI_IMAGE_SIZE=1024x1024
```

If LocalAI authentication is enabled, set `AI_API_KEY`. If you only installed a text model, leave `AI_IMAGE_MODEL` blank.

### OpenAI

```dotenv
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=your-openai-api-key
AI_TEXT_MODEL=your-text-model-id
AI_IMAGE_MODEL=your-image-model-id
AI_IMAGE_SIZE=1536x1024
```

Use exact model IDs available to your account rather than relying on a hardcoded allowlist.

### Gemini through its OpenAI compatibility endpoint

Gemini can also be used through its OpenAI-compatible endpoint:

```dotenv
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_API_KEY=your-gemini-api-key
AI_TEXT_MODEL=your-gemini-text-model
AI_IMAGE_MODEL=your-compatible-gemini-image-model
```

Existing installs that only contain `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, and `GEMINI_IMAGE_MODEL` are automatically mapped to this compatibility endpoint until an `AI_*` configuration is saved. The old variables are retained only for migration/backward compatibility; new installations should use `AI_*`.

### Other compatible servers

Set `AI_BASE_URL` to the server's `/v1`-style root and enter the exact model IDs exposed by that server. The base URL may be loopback, a private-LAN address, or HTTPS. URL-embedded usernames/passwords are rejected; use `AI_API_KEY` for Bearer authentication.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `YOUTUBE_API_KEY` | YouTube Data API v3 search and public metadata enrichment | Required for Research |
| `YOUTUBE_CACHE_TTL_MS` | In-memory lifetime for identical research searches | `900000` (15 min) |
| `YOUTUBE_CACHE_MAX_ENTRIES` | Maximum cached research queries per process | `100` |
| `AI_BASE_URL` | OpenAI-compatible API root | `http://127.0.0.1:8080/v1` |
| `AI_API_KEY` | Optional Bearer token/API key | Empty |
| `AI_TEXT_MODEL` | Exact text model ID | `local-model` |
| `AI_IMAGE_MODEL` | Exact image model ID; blank disables image generation | Empty |
| `AI_IMAGE_SIZE` | Provider-specific image size or `auto` | `1536x1024` |
| `AI_TIMEOUT_MS` | Text request timeout | `120000` |
| `AI_IMAGE_TIMEOUT_MS` | Image request/download timeout | `300000` |
| `PORT` | Local HTTP port | `5000` |
| `HOST` | Bind address | `127.0.0.1` |

## Compatibility notes

- OpenAI-compatible APIs are not perfectly identical. YouTube Pro intentionally uses a small common subset and validates every structured response.
- A server that supports `/chat/completions` but not `/images/generations` is fully usable for text features.
- Image sizes and supported image model IDs are provider-specific.
- Reference-image editing is not standardized across the OpenAI-compatible servers targeted here. The generic image path currently requires zero reference images; reference-image requests return an explicit unsupported-provider error instead of silently ignoring the images.
- Local models vary greatly in JSON reliability. Instruction-tuned models with enough context window for the supplied research snapshot work best.
- If a local model is slow, increase `AI_TIMEOUT_MS` rather than exposing the app publicly.

## Data and request limits

- Research query: 1 to 200 characters.
- Research sample: 1 to 50 videos per search request. YouTube's overall result count is approximate and is labeled separately from the returned sample.
- Research enrichment: public video statistics, duration, captions, tags, language, topic categories, selected status fields, live-stream details, and public channel metadata when available. Missing or private public fields remain unavailable, never zero-filled.
- AI evidence input: exactly the active ordered snapshot, at most 50 videos, its deterministic aggregate analytics, enrichment coverage, warnings, filters, query, retrieval time, and snapshot ID.
- Script input: topic up to 500 characters, custom tone traits up to 300, notes up to 5,000, script or section content up to 80,000 where applicable.
- Thumbnail references: PNG or JPEG, 128 to 4096 pixels, at most 5 MB after preparation per image, 12 MB decoded total, and no more than three references. Generic OpenAI-compatible image generation currently rejects reference-image editing as noted above.
- Global JSON body: 18 MB, needed for bounded base64 thumbnail references. URL-encoded input is limited to 64 KB and 100 parameters.
- Provider routes: 10 requests per client address per 60 seconds in this single-process local server.

## Privacy and access model

- There is no login screen, initial password, Thumbnail unlock, or Pro Script Studio gate.
- API keys stay server-side and `.env` is ignored.
- Recent workflow history stays in the current browser profile. It is not sent to a separate history service and never contains API keys.
- Request and response bodies are not logged.
- The application binds to loopback unless `HOST` is explicitly changed.
- A local AI endpoint keeps prompt/evidence traffic on the machine. Hosted endpoints receive the text prompts and research snapshot needed for the selected AI operation.
- Do not expose the server directly to the internet. If remote access is required, add authentication and rate limiting at a trusted gateway, and disable or separately protect local Settings.
- The in-memory rate limiter and YouTube cache are per process. They are suitable for this local-first default, not a distributed public deployment.

## Commands

```bash
npm run dev       # development server
npm test          # contract and provider-behavior tests
npm run check     # TypeScript check
npm run build     # production client and server build
npm start         # run the production build
```

Continuous integration runs the test suite, TypeScript check, and production build on every pull request and push to `main`.

## Technology

- React 18, TypeScript, Vite, Tailwind CSS, and shadcn/ui
- Express 5
- OpenAI-compatible HTTP APIs (no provider SDK required for the active AI path)
- YouTube Data API v3
- No server-side runtime database, session store, Passport authentication, or Replit-managed AI proxy

The legacy `@google/genai` dependency and Gemini implementation remain temporarily in the repository for migration compatibility and existing provider contract tests, but the application routes use the provider-neutral OpenAI-compatible layer.

## Quotas and costs

The project is designed so paid AI usage is optional:

| Component | Can be free/local? | Notes |
| --- | --- | --- |
| YouTube search/statistics | Free quota | Requires a YouTube Data API v3 key; quota limits still apply |
| Deterministic research analytics | Yes | Computed locally from public API records |
| Insights / Ideas / Scripts | Yes | Use local llama.cpp or LocalAI |
| Narration extraction | Yes | Deterministic local processing, no model call |
| Thumbnail text suggestions | Yes | Uses your local text model |
| Generated thumbnail image | Yes, with a local image server | Otherwise use a hosted image-capable provider or leave disabled |

Provider pricing and YouTube quotas change over time, so check the official documentation for your chosen endpoint before relying on a hosted cost estimate:

- [YouTube Data API quota costs](https://developers.google.com/youtube/v3/determine_quota_cost)
- [llama.cpp server](https://github.com/ggml-org/llama.cpp/tree/master/tools/server)
- [LocalAI](https://localai.io/)
- [OpenAI API reference](https://platform.openai.com/docs/api-reference)
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)

## License

YouTube Pro is open source under the [Apache License 2.0](LICENSE).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the local quality gate. Report security issues privately according to [SECURITY.md](SECURITY.md), never in a public issue.
