<p align="center">
  <img src="client/public/youtube-pro.svg" width="88" alt="YouTube Pro logo">
</p>

<h1 align="center">YouTube Pro</h1>

<p align="center">
  Research, understand, write, and package a YouTube video in one local-first workflow.
</p>

YouTube Pro is an evidence-grounded workspace for YouTube research, idea selection, script writing, and thumbnail creation. It combines official public YouTube Data API v3 records with configurable OpenAI-compatible AI providers while keeping API keys on the local server.

The AI layer is provider-neutral. You can use OpenAI, `llama.cpp` / `llama-server`, LocalAI, Gemini's OpenAI-compatible endpoint, or another server that implements the common OpenAI chat/image contracts. Text and image generation can use the same server or completely different endpoints, models, keys, and timeouts.

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

Turn a selected idea into an editable script, then read it in a focused teleprompter with pace, size, cue, undo, and playback controls. Narration extraction is deterministic and local; it does not spend an AI request simply to remove timestamps and stage directions.

![YouTube Pro teleprompter with playback and reading controls](docs/images/script-teleprompter.png)

### Thumbnail Creator

Describe the outcome once, choose optional controls, and generate a thumbnail when the configured image endpoint implements OpenAI-compatible `/images/generations`.

![YouTube Pro Thumbnail Creator with a generated thumbnail preview and minimal creation controls](docs/images/thumbnail-creator.png)

A text-only llama.cpp server can power Research AI Insights, Ideas, Script Writer, title/section/paragraph regeneration, thumbnail text suggestions, and local narration extraction. Generated thumbnail images require an image-capable endpoint and a configured image model.

## Workflow

1. **Research**: Search up to 50 public YouTube videos, review the overview, analytics, coverage, and every returned video.
2. **AI Insights**: The configured OpenAI-compatible text model analyzes the exact active research snapshot.
3. **Grounded Ideas**: Ideas generate after valid Insights. Select one idea, then explicitly proceed to Script Writer.
4. **Script Writer**: Generate and edit a script from the selected idea package and its evidence. Section and paragraph regeneration use the same bounded evidence context.
5. **Thumbnail Creator**: Use the selected promise and thumbnail concept with the configured OpenAI-compatible image endpoint when one is enabled.

Each press of **New Workflow** creates a separate local project. The sidebar keeps recent workflows in browser IndexedDB and restores Research, Script, and Thumbnail state together. Uploaded reference images are intentionally not retained.

## Requirements

- Node.js 22.12 or newer.
- A YouTube Data API v3 key for official Research search and public statistics.
- An OpenAI-compatible text endpoint for AI-assisted features. This can be a free local server.
- Optional: a separate OpenAI-compatible image endpoint for generated thumbnails.

```bash
cp .env.example .env
npm install
npm run dev
```

The server listens on `127.0.0.1:5000` by default. Open `http://127.0.0.1:5000`.

## Configure everything from Settings

You can start without manually editing `.env` and configure all model/API-facing settings in **Settings**. The UI exposes:

### YouTube Data API

- API key
- clear/remove saved key

### LLM / text generation

- OpenAI-compatible base URL
- exact model ID
- API key
- clear/remove saved key
- request timeout in milliseconds
- `/models` discovery when the provider supports it
- a small live `/chat/completions` connection test with latency reporting

### Image generation

- independent OpenAI-compatible base URL
- exact image model ID
- independent API key
- clear/remove saved key
- image size (`WIDTHxHEIGHT` or `auto`)
- request/download timeout in milliseconds
- `/models` discovery when the provider supports it
- one-click reuse of the LLM endpoint URL when both services share a server

This lets you mix providers. For example, llama.cpp can handle text at `http://127.0.0.1:8080/v1` while a different LocalAI or hosted endpoint handles image generation at another URL with another API key.

Settings writes replacements to the ignored `.env` file with owner-only permissions. Saved secrets are never returned to the browser. Settings and provider diagnostics accept direct loopback, same-origin requests only and reject normal forwarded or reverse-proxy requests.

## Lowest-cost / free local setup

A low-cost configuration is:

- **YouTube research:** official YouTube Data API v3 free quota.
- **Research analytics:** computed locally from returned public metadata.
- **AI text:** local llama.cpp or LocalAI model, so there is no paid AI API usage.
- **Narration extraction:** local deterministic cleanup, no AI request.
- **Generated thumbnail image:** optional; leave the image model blank for text-only operation or point the image connection at a local image-capable server.

The server caches identical YouTube searches for 15 minutes by default, including concurrent identical requests. Failed requests are not cached. Tune this with `YOUTUBE_CACHE_TTL_MS` and `YOUTUBE_CACHE_MAX_ENTRIES`.

## OpenAI-compatible API behavior

Text requests use the configured LLM base URL plus:

- `POST /chat/completions`
- `GET /models` for optional Settings discovery

Image requests use the configured image base URL plus:

- `POST /images/generations`
- `GET /models` for optional Settings discovery

Structured text requests first use `response_format: {"type":"json_object"}`. If a compatible server rejects that optional field, YouTube Pro retries without it and still validates the returned JSON against application schemas.

Authorization headers are only sent when the corresponding provider key is non-empty. LLM and image keys are independent.

## Provider examples

### llama.cpp / llama-server for text

```dotenv
AI_TEXT_BASE_URL=http://127.0.0.1:8080/v1
AI_TEXT_API_KEY=
AI_TEXT_MODEL=local-model
AI_TIMEOUT_MS=120000

# Disable generated images:
AI_IMAGE_MODEL=
```

Standard llama.cpp is text-only. Use the Settings **Discover models** button if your build exposes `/models`; otherwise enter the exact loaded model ID manually.

### LocalAI for text and images on the same server

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
| `YOUTUBE_API_KEY` | YouTube Data API v3 search/public metadata | Required for Research |
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

Split variables take precedence over shared aliases. Saving from the current Settings UI writes split text/image configuration and synchronizes the old shared aliases with the text provider for backward compatibility.

## Compatibility notes

- OpenAI-compatible APIs are not perfectly identical. YouTube Pro intentionally uses a small common subset and validates structured responses.
- `/models` is optional in practice. Failure to discover models does not prevent manual model IDs from working.
- A server that supports `/chat/completions` but not `/images/generations` is fully usable for text features.
- Text and image endpoints may be different providers, hosts, authentication credentials, and timeout profiles.
- Image sizes and supported image model IDs are provider-specific.
- Reference-image editing is not standardized across the targeted OpenAI-compatible servers. Generic image generation currently rejects reference-image editing rather than silently ignoring references.
- Local models vary in JSON reliability. Instruction-tuned models with enough context window for the supplied research snapshot work best.
- If a local model is slow, increase the LLM timeout in Settings rather than exposing the application publicly.

## Data and request limits

- Research query: 1 to 200 characters.
- Research sample: 1 to 50 videos per search request.
- AI evidence input: exactly the active ordered snapshot, at most 50 videos, with deterministic aggregate analytics and provenance.
- Script input: topic up to 500 characters, custom tone traits up to 300, notes up to 5,000, script/section content up to 80,000 where applicable.
- Thumbnail references: PNG or JPEG, 128 to 4096 pixels, at most 5 MB after preparation per image, 12 MB decoded total, and no more than three references.
- Generated image downloads are capped at 25 MB.
- Global JSON body: 18 MB, needed for bounded base64 thumbnail references.
- Provider routes: 10 requests per client address per 60 seconds in the local server.

## Privacy and access model

- API keys stay server-side and `.env` is ignored.
- Saved secrets are never included in Settings status responses.
- Recent workflow history stays in the current browser profile.
- Request and response bodies are not logged.
- The application binds to loopback unless `HOST` is explicitly changed.
- Local AI endpoints keep prompt/evidence traffic on the machine. Hosted endpoints receive the prompts and research data needed for the selected AI operation.
- Do not expose the server directly to the internet. If remote access is required, add authentication and rate limiting at a trusted gateway and separately protect Settings.

## Commands

```bash
npm run dev       # development server
npm test          # contract and provider-behavior tests
npm run check     # TypeScript check
npm run build     # production client and server build
npm start         # run the production build
```

Continuous integration runs the test suite, TypeScript check, and production build on pull requests and pushes to `main`.

## Technology

- React 18, TypeScript, Vite, Tailwind CSS, and shadcn/ui
- Express 5
- OpenAI-compatible HTTP APIs with no provider SDK required for the active AI path
- YouTube Data API v3
- No server-side runtime database, session store, Passport authentication, or Replit-managed AI proxy

The legacy `@google/genai` dependency and Gemini implementation remain temporarily for migration compatibility and existing provider contract tests, but active routes use the provider-neutral OpenAI-compatible layer.

## Quotas and costs

| Component | Can be free/local? | Notes |
| --- | --- | --- |
| YouTube search/statistics | Free quota | Requires a YouTube Data API v3 key |
| Deterministic research analytics | Yes | Computed locally |
| Insights / Ideas / Scripts | Yes | Use local llama.cpp or LocalAI |
| Narration extraction | Yes | Deterministic local processing |
| Thumbnail text suggestions | Yes | Uses the configured text model |
| Generated thumbnail image | Yes, with a local image server | Otherwise use a hosted image-capable provider or leave disabled |

Useful provider documentation:

- [YouTube Data API quota costs](https://developers.google.com/youtube/v3/determine_quota_cost)
- [llama.cpp server](https://github.com/ggml-org/llama.cpp/tree/master/tools/server)
- [LocalAI](https://localai.io/)
- [OpenAI API reference](https://platform.openai.com/docs/api-reference)
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)

## License

YouTube Pro is open source under the [Apache License 2.0](LICENSE).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the local quality gate. Report security issues privately according to [SECURITY.md](SECURITY.md), never in a public issue.
