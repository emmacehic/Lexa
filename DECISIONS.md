# Decisions

Every deviation from the original specification, and why. Newest at the bottom.

---

## Dependencies beyond §4

§4 pins the stack and forbids substitutions. These are additions, not
substitutions — each one is required to implement a §-numbered requirement.

| Package | Required by | Why |
|---|---|---|
| `@node-rs/argon2` | §3 (Argon2id) | §4 names no hashing library; this is the maintained prebuilt Argon2id binding. |
| `nodemailer` | §3 (magic link), §4 (`SMTP_URL`) | `SMTP_URL` is in the environment list but no mailer is named. |
| `tus-js-client` | §6.1 (chunked, resumable upload) | Supabase Storage's resumable endpoint speaks tus. Without it the upload is a single PUT and neither chunked nor resumable. |
| `ioredis` | §4 (BullMQ + Redis) | BullMQ's connection; it is BullMQ's own peer, not a second queue library. |
| `@tanstack/react-virtual` | §13 (virtualize the segment list, measured heights) | §4 names no virtualization library. |
| `ffmpeg-static` | §4 ("static ffmpeg binary") | Named in the spec in prose. |
| `@google-cloud/storage` | §6.2, §6.3 (GCS staging bucket) | The staging bucket is required; the client is not named. |
| `@google/genai` | §6.4 (Gemini 2.5 Flash) | The current Google GenAI SDK. |
| `tsx`, `@eslint/eslintrc` | tooling | Running `worker/index.ts` and `prisma/seed.ts`; ESLint flat-config compatibility. |
| `exceljs` | XLSX annotation sheet export | The reference annotation workflow uses a three-sheet .xlsx workbook (Instructions / Samples / Annotations). No spec section covers XLSX but it matches the researcher's real tooling. |

No state library was added beyond Zustand, and no UI kit.

---

## Schema additions (§5)

§5 says "implement exactly". The models below are implemented exactly as
written. These are additions required by other sections:

- **`Invite`** — §3 requires invitation-only registration with links scoped to a
  project. Only the SHA-256 hash of the token is stored.
- **`MagicLinkToken`** — §3 requires email magic-link sign-in. Single-use,
  15-minute expiry, hash-only storage.
- **`UploadEvent`** — §13 requires a rate limit of 10 uploads/hour/user. Counted
  in Postgres rather than adding a second Redis dependency for it.
- **`Recording.progress`, `Recording.stage`** — §6.3 requires "a `progress`
  field the UI subscribes to", and §7 requires the processing screen to show the
  live pipeline stage.
- **`Recording.refinementSkipped`** — §6.4 requires discarded refinement chunks
  to be logged; this makes it visible per recording rather than only in the
  worker log.
- **`Revision.undone`** — §5 requires undo *and* redo across the last 100
  actions. A boolean cursor on the revision row is the smallest way to have
  both without a second table.

Back-relations (`User.recordings`, `Recording.segments`, …) were added where
Prisma requires them to compile. They add no columns.

---

## Auth without a Prisma adapter

§3 asks for Auth.js v5 with a Credentials provider *and* email magic-link.
Auth.js's own Email provider requires a database adapter, and `PrismaAdapter`
would force `Account`, `Session` and extra `User` columns into the schema that
§5 does not have.

Instead: JWT sessions only, and the magic link is a second Credentials provider
that exchanges a single-use token from `MagicLinkToken`. Same user-facing
behaviour, no schema drift.

---

## Segmentation: the merge rule is bounded by the cut rules

§6.5 says to merge any segment shorter than 1.2 s into its neighbour. Applied
literally, dense speech breaks this: the 9.0 s / 90-character rule cuts a run
into pieces that are each under 1.2 s, the merge rule glues them straight back
together, and the result is a 240-character segment that violates the rule that
produced it.

The merge now happens only when the merged segment would still respect the 9.0 s
and 90-character limits. A short fragment with no legal neighbour is left as its
own segment.

*This is a real change to the specified behaviour. Everything else in §6.5 is
implemented as written.*

## Segmentation thresholds are compared in milliseconds

`2.05 - 1.50` is `0.5499999999999998` in binary floating point, so an exactly
0.55 s silence would not have triggered a cut. All §6.5 comparisons are done on
values rounded to whole milliseconds.

---

## Re-alignment: a word inserted inside an annotation joins it

§8.3 defines what happens to unchanged, replaced, inserted and deleted tokens.
§9.4 defines what happens to an annotation when its words are deleted. Neither
says what happens when a word is typed *into the middle* of an annotated span.

Leaving it unannotated would make the span non-contiguous, which §9.3 rules out
("a code-switch spanning several words reads as one continuous shape"). So an
inserted word whose neighbours on both sides belong to the same annotation joins
that annotation. A word inserted at either edge does not.

## Interpolation across a zero-width gap

§8.3.5 distributes inserted words' timings across the gap between the
surrounding anchors. When there is no gap — two measured words that abut — the
inserted words are given zero-length timings at that instant rather than
stealing time from a measured word, which §1.3 forbids. They are
`INTERPOLATED`, so the UI already tells the truth about them.

---

## Splitting a segment through an annotation is refused

§9.1 forbids a span crossing a segment boundary, and §8.4 allows splitting a
segment at the caret. The two can collide. Rather than silently truncating the
annotation, the split is refused with: *"Splitting here would cut an annotation
in half. Remove the annotation first, then split."*

---

## Export: extra tiers for custom labels

§10.4 specifies three tiers — `transcript`, `loanword`, `code-switch`. §5 allows
a project to define custom label types. Exporting only the three would silently
drop those annotations on the way out, so ELAN and TextGrid emit one extra tier
per custom label **that actually occurs** in the recording. A corpus with no
custom labels exports exactly the three tiers the spec names.

## Export: `annotatedBy` is the email local part

§10.1's example shows `"annotatedBy": "m.keller"`. Users have a name and an
email, not a username, so the local part of the email is used.

## Export: two more formats than the four listed

§10 lists four options and then adds Praat TextGrid as a fifth. A words-level
CSV is also required by §10.2 ("Also offer a words-level CSV"), and WebVTT and
SubRip are separate downloads rather than one option. That makes seven entries
in the sheet.

---

## CSP keeps `unsafe-inline` for styles

§13 requires a CSP without `unsafe-inline`. `script-src` has none: a per-request
nonce is issued in `middleware.ts` and Next stamps it onto its own scripts.
`style-src` does keep `unsafe-inline`, because the workspace positions the
active-word underline, the waveform playhead and the annotation tints with
inline `style` attributes, which CSP counts as inline styles. The injection
surface that matters — scripts — is nonce-only.

---

## Design pass (§15.3)

Screenshotted the workspace and critiqued it against §11:

- The three ambient colour fields were specified at 8–12 % opacity, but at
  60 vw with a 120 px blur they blanketed the viewport and competed with the
  glass. Reduced to 38–44 vw, 5–8 %, 160 px blur — "nearly subliminal" is the
  binding phrase in §11.1.
- **Removed one thing:** the audio-only player carried a framed inset box that
  repeated the filename. The header already names the recording and the waveform
  is the picture, so the box is gone.
- Fixed a layout bug the screenshot exposed: the export sheet's preview column
  had no `min-w-0`, so a long JSON line pushed the Download button outside the
  sheet's clipped bounds.

---

## BullMQ queue name (2026-08-24)

`bullmq@5.81` (resolved from `^5.34.6`) throws `Queue name cannot contain :`.
The queue is an internal name, not a spec surface, so it was renamed from
`lexa:transcribe` to `lexa-transcribe`. Job ids use the same rule:
`transcribe-${recordingId}`, not `transcribe:${recordingId}`.

---

## Annotation fields for research sheet (2026-08-24)

The reference annotation workflow (`Loanword_CodeSwitch_Annotation_Sheet.xlsx`)
requires fields not in the §5 schema. Added to `Annotation`:

| Field | Type | Reference column |
|---|---|---|
| `nativeAlternative` | `String?` | `native_alternative` |
| `pronunciation` | `String?` | `pronunciation` — constrained to `local`, `foreign`, `mixed/unclear` |
| `confidence` | `String?` | `confidence` — annotator's confidence (`high`/`medium`/`low`), not STT confidence |

Also added `UNCLEAR` as a third built-in label type (the sheet lists
LOANWORD, CODE_SWITCH, UNCLEAR). Keyboard shortcut `⌥U`.

The XLSX export produces a three-sheet workbook that matches the reference sheet
structure exactly: Instructions, Samples (one row per segment), Annotations
(one row per annotation).

---

## Thesis platform extensions (2026-08-24, session 3)

These additions close the gap between the spec and Emma's MA thesis proposal
requirements. None violate the original specification — they extend it.

### Speaker model

Added `Speaker` (name, languagesSpoken, proficiency, notes) with a
`Recording.speakerId` FK. The thesis proposal requires "relevant information
about the speakers and their language background" (§6.2). Speaker management
is in the Admin panel per project.

### Recording metadata

Added `Recording.sourceUrl` and `Recording.sourceContext` (both optional
strings). These populate the previously-empty `source_url` and `source_context`
columns in the XLSX Samples sheet.

### Inter-annotator agreement

Added `Recording.sourceRecordingId` self-FK for clone tracking. The clone API
(`/api/admin/clone`) copies segments + words without annotations. The IAA API
(`/api/admin/iaa`) computes word-level percent agreement and Cohen's kappa.

### Import capability

Added transcript import (SRT/VTT/plain text → segments + words with
INTERPOLATED timing) and XLSX annotation import (parse Annotations sheet,
match forms to segments). These skip the STT pipeline and are only available
for recordings without existing segments (transcript) or for adding annotations
to existing segments (XLSX).

### Annotation guidelines

Added `Project.guidelines` (nullable text). Annotators see `/guidelines` which
renders each project's guidelines. Admins edit them in the Admin panel.
The default text ships in `content/annotation-guidelines.md` and is copied
into new projects at creation time.

### Library filtering

Client-side project filter, status filter, filename search, and sort controls.
No server-side changes — the library page already loads all visible recordings.

---

## Local fallback architecture (2026-08-25, session 4)

### Whisper local STT fallback

The spec (§6.3) specifies Google Cloud Speech-to-Text v2 (chirp_2). GCP has
no usable free tier for V2. Rather than requiring billing, the worker now
branches: if `GCP_PROJECT_ID` + `GCP_SERVICE_ACCOUNT_JSON` +
`GCS_STAGING_BUCKET` are all set, it uses GCP as before. Otherwise, it uses a
local `whisper.cpp` server via its OpenAI-compatible `/inference` endpoint.

New file: `lib/stt-whisper.ts`. Same `SttResult` return type as `lib/stt.ts`.
Whisper supports 99 languages and produces word-level timestamps. The worker
skips the GCS staging step entirely when using Whisper.

Uses `hwdsl2/whisper-server` (faster-whisper, OpenAI-compatible API) on port
9000 rather than the raw whisper.cpp server. The API endpoint is
`/v1/audio/transcriptions` with `timestamp_granularities[]=word`.

Env vars: `WHISPER_SERVER_URL` (default `http://localhost:9000`),
`WHISPER_MODEL` (default `base`), `WHISPER_API_KEY` (Bearer token the
image auto-generates into its volume). Requests send
`Authorization: Bearer` when the key is set. Retrieve it with
`docker exec lexa-whisper whisper_manage --getkey`.

### Ollama refinement fallback

The spec (§6.4) specifies Gemini for orthography refinement. The free tier
still exists (Flash models, 1500 RPD) but requires an API key from Google AI
Studio. When `GEMINI_API_KEY` is missing, `lib/gemini.ts` now falls back to
Ollama's OpenAI-compatible chat completions API at `OLLAMA_URL/v1`. The same
system prompt and temperature=0 are used.

Env vars: `OLLAMA_URL` (default `http://localhost:11434`), `OLLAMA_MODEL`
(default `llama3.2`).

### Supabase project

Created a dedicated Supabase project "lexa" (ID `ecbyyzjdnnfxivthaxks`,
region `eu-central-1`, free tier). Private `recordings` bucket created via
SQL. Service role key must be copied from the Supabase Dashboard (Settings >
API) into `.env.local`.

---

## Storage tus and new Supabase secret keys (2026-08-25)

Supabase's resumable `/storage/v1/upload/resumable` API still parses
`Authorization: Bearer` as a JWT. The new secret keys (`sb_secret_…`) are
not JWTs, so tus creation fails with `Invalid Compact JWS`.

The object API (`supabase.storage.upload`) accepts those keys. The browser
now asks `/api/uploads/sign` for a short-lived PUT URL and uploads the
file **directly to Supabase Storage** with XHR progress. That avoids
proxying multi-hundred-megabyte videos through the Cloudflare tunnel
and this PC. `/api/uploads/direct` remains as a server-side fallback.
tus-js-client is kept for the spec's chunked/resumable path, but it is
not used for `sb_secret_…` keys:
the tus client was stalling at 0% (`findPreviousUploads` never settled
after the failed JWT tus attempt), and Storage tus still rejects those
keys as `Invalid Compact JWS`.

Library delete is allowed for any project member with write access (not
only admins). The object is removed from the private bucket first; the
database row is deleted only after that, or if the object is already
gone (stuck `UPLOADED` rows that never received bytes). Complete
recordings stay locked for contributors.

Middleware is skipped for `/api/uploads/*` and
`middlewareClientMaxBodySize` is 10 GB so a large file is not truncated
by the default 10 MB clone limit.

### Upload size limit is 10 GB, not 2 GB

Spec §6.1 caps uploads at 2 GB. Pilot field recordings can exceed
that. `MAX_UPLOAD_BYTES` in `lib/mime.ts` is 10 GB; Next.js middleware
and tus advertise the same cap. Duration limit remains 4 hours.

---

## Local disk storage for pilot hosting (2026-08-28)

Spec §4 names Supabase Storage for media. For the self-hosted pilot
on the operator's PC, `STORAGE_BACKEND=local` stores recordings under
`LOCAL_MEDIA_PATH` instead. Uploads use resumable tus through
`/api/uploads/tus` (required for multi-GB files through the Cloudflare
tunnel). Playback streams from `/api/recordings/[id]/stream` with Range
support. Supabase credentials are not required when `STORAGE_BACKEND=local`.
Set `STORAGE_BACKEND=supabase` (default) to restore cloud storage.

### `Recording.byteSize` is BIGINT, not INT

Spec §5 types `byteSize` as `Int`. Files above ~2 GB overflow
Postgres INT4. The column is `BigInt` (INT8) so uploads up to 10 GB fit.
The API still uses JavaScript numbers (safe below 2⁵³).

### Extra audio containers for the pilot

Spec §6.1 lists core formats. Added `aiff`, `aif`, `opus`,
`3gp`, and `weba`, plus `audio/*` / `video/*` on the file picker so
phones offer both audio and video. Sniffing distinguishes audio-only
WebM/Matroska from video.

Local tus staging uses `LOCAL_MEDIA_PATH/.tus-staging` so finished files
can be renamed on the same drive. When temp and storage differ (e.g.
`C:` → `S:`), `storeObjectFromFile` copies instead of renaming.

The tus-js-client resume lookup (`findPreviousUploads`) can stall at 0%
progress; local uploads set `storeFingerprintForResuming: false` and send
session cookies via `onBeforeRequest`. Chunks are 5 MB. Upload progress
is shown inside the metadata wizard so it is not hidden behind the modal.

**Update 2026-08-30:** A brief experiment routed local files ≤512 MB through
`/api/uploads/direct`, but a 60 MB mp3 still failed (0% or never finished).
Local uploads use tus only again.

---

## Hybrid storage: small files on Supabase, large on disk (2026-08-31)

`STORAGE_BACKEND=hybrid` sends uploads at or below `HYBRID_SUPABASE_MAX_BYTES`
(default 100 MB) straight to Supabase Storage (signed PUT, no Cloudflare tunnel
hop). Larger files use local disk via direct POST or tus, same as
`STORAGE_BACKEND=local`. Each recording stores its `storageLocation`
(`LOCAL` | `SUPABASE`) so playback, download, delete, and the worker read from
the correct place. Requires both `LOCAL_MEDIA_PATH` and Supabase credentials.

If Supabase signing or the signed PUT upload fails, the sign route and upload
client fall back to local disk automatically (`forceLocal` on retry).

---

## Framer Motion first paint (2026-08-25)

Chrome that is in the SSR tree (`LoginForm` card, library upload bar,
review-tray button, processing bar) used `motion.*` with `initial` /
`animate`. The server HTML had no `transform` (or `opacity: 0`); the
client hydrated with `opacity: 1; transform: none`. React 19 reports
that as a hydration attribute mismatch and will not patch it.

Those first-paint nodes are now ordinary `div`/`button`/`form`. Motion
is only used for overlays that mount after interaction (drop veil,
sheets, selection toolbar). `optimizePackageImports` for framer-motion
was removed — it produced different server/client module graphs.

The theme boot script is a blocking `<script nonce>` in the layout, not
`next/script`. Browsers strip the `nonce` attribute after parse; the
tag has `suppressHydrationWarning` so React 19 does not warn. `html`
and `body` also suppress the `data-theme` attribute the script may set
before hydrate.

---

## Matrix language is Bosnian (2026-08-25)

§5's example project languages are `de-CH, en-US`. This corpus is
Bosnian speech with German and English loanwords / code-switches.
Whisper accepts only one ASR language and was taking the project's
first code, so `de-CH` forced every token into German.

Fieldwork's language codes are now `bs-BA, de-CH, en-US` (matrix first).
Whisper is sent `language=bs`. Annotation language tags for switches
remain German/English. The seed migrates the old two-code German
default if it is still in place.

### `flag-icons` dependency for language picker

`flag-icons@7` added for the annotation wizard's two-country language
picker. Contributors select "From" and "To" countries with real flag
icons instead of typing BCP-47 codes. The tag stored in `languageTag`
becomes `bs→de` (two languages separated by `→`) or a single language
code if only one is picked. Spec §4 lists the allowed stack; this is a
CSS-only asset package with no runtime logic, so it falls under
"design token" territory rather than a new framework dependency.

### Annotation wizard replaces hidden ⌄ dropdown

Clicking Loanword / Code-switch / Unclear (or ⌥L/⌥C/⌥U) now opens a
step-by-step wizard instead of immediately creating the annotation with
all detail fields empty. Steps: source language (flag picker) →
pronunciation → confidence → native alternative → note. Every step can
be skipped. The old ⌄ expand panel remains for editing existing
annotations.

### Open self-registration added alongside invite-only flow

Spec §3 requires invitation-only registration. The login page now has a
"Create account" flow where users enter name, email, password, spoken
languages (flag picker), and proficiency level. New accounts are
automatically assigned to the first (oldest) project as CONTRIBUTOR.
The invitation flow remains intact for targeted onboarding. This was
added because the project operator needs contributors to self-register
without admin intervention for each new participant.

### Light/dark toggle, no system option

Spec §11.2 says appearance follows the system with a manual override.
The header control is now a two-state switch (light / dark) and the OS
preference is ignored. Default is light. Stored `lexa.theme` values of
`system` are treated as light.

### Dark-only moving ambient; light is flat white

Spec §11.1 describes one ambient layer for both appearances. Light mode
is now a flat white canvas. Dark mode uses a drifting blue/black
gradient plus larger colour fields so glass surfaces have depth.

### Spelling corrections as a built-in annotation type

Spec §9.3 lists loanword, code-switch, and unclear. A fourth built-in
type, `correction`, marks a transcription spelling fix. The original
surface stays on `Word.text` and on the annotation's `surface`; the
corrected form is stored in `nativeAlternative` and confidence in
`confidence`. The transcript displays the corrected spelling.

Corrections do **not** use `Word.annotationId`. Spec §9.1's "one
annotation per word" still holds for linguistic labels (loanword /
code-switch / unclear). A spelling correction lives on a second FK,
`Word.correctionId` → `Annotation` via relation `SpellingCorr`, so a
word can be both corrected and labelled. The Correct / Remove capsule
stays above the word; loanword / code-switch / unclear stay below.

### Admin role is read from the database

Spec §3 puts `role` on the JWT. The Admin link and `/admin` now also
read `User.role` from Postgres on every request, so a contributor never
keeps admin chrome from a stale token. `/admin` is wrapped in a layout
that redirects anyone who is not `ADMIN`.

### People tab on /admin

Spec §7 lists corpus statistics by contributor. Admin also has a People
tab: every account by name, with that person's annotations, assigned
recordings, and recent work from the revision log.

### Project name is collected at upload

Spec §3 says admins create projects and contributors upload into ones
they belong to. Seed no longer creates a "Fieldwork" project. The
library upload bar has no project picker. The first metadata question
after choosing a file is the project name. That name creates a project
(or reuses one the uploader already belongs to, case-insensitive) and
the uploader is added as a member. Admin can still create projects from
`/admin`. New projects get language codes `bs-BA, de-CH, en-US`.

Self-registration no longer auto-joins the oldest project. Contributors
join a project when they upload and name it.

The metadata wizard has no Skip / Skip all. It asks three questions:
project name, speaker ID, and main language. Remaining Speaker columns
stay nullable and can still be filled from `/admin`.

### Sign out posts to /logout

Client `signOut()` from `next-auth/react` followed `AUTH_URL` after
clearing the session. Locally that URL is often `:3000` while `pnpm
dev` is on `:3001`, so the library Sign out control looked dead. The
button is now a POST to `/logout`, which calls `signOut({ redirect:
false })` and 303-redirects to `/login` on the current origin.

### Login card copy

Spec §11 `/login` is "one centred glass card". The tool name **Lexa** is
the only large heading on that card (login and create account share it).
The subtitle keeps the product description and adds the credit on the
same line: **Transcription and code-switching annotation. Created by
Emma Cehic**.

### Seeded admin display name

`SEED_ADMIN_NAME` defaults to `Admin`, not `Lexa Admin`, so the library
line reads "Signed in as Admin" rather than repeating the product name.

### Sharing from this machine

The live app is not deployed to Vercel. A Cloudflare quick tunnel
(`trycloudflare.com`) forwards HTTPS to `pnpm start` on the host machine.
`AUTH_URL` must be that HTTPS origin so session cookies are `Secure`. The
tunnel URL is ephemeral.

### Whisper's 99 languages, not a 30-country slice

Pickers were `COUNTRIES.slice(0, 30)` — countries, and only the first
thirty. They now list Whisper's 99 ISO 639-1 languages (searchable, no
cap). Spec §5's "max 4" on `Project.languageCodes` is a Google
Speech-to-Text limit. Whisper is not capped at four. GCP still uses the
first four codes; Whisper auto-detects when more than one language is
listed, and uses the single tag when there is only one.

### Account creation has no email

Spec §3 is email + password + magic link. Self-registration now asks
for name, password, spoken languages, and proficiency. A unique
placeholder `u-…@local.lexa` is stored so `User.email` stays unique.
Sign-in is by **name** (or by email for existing accounts such as the
seeded admin). Magic-link still needs a real email. Spoken languages
are stored on `User.spokenLanguages` with per-language proficiency in
`User.languageProficiency` (JSON array of `{ code, proficiency }`).

### Upload wizard is three questions

The post-upload wizard was fifteen speaker-background steps (age,
gender, origin country, current country, generation, home language,
and so on). Contributors now answer project name, speaker ID,
**Dominant** language, and **Heritage** language. `mainLanguage` in
the database is set from dominant for export compatibility. Extra
Speaker columns remain in the schema and on `/admin`.

### Annotation toolbar stays inside the viewport

The Correct / High-Medium-Low capsule sits above the selected word.
On the first line that placed it outside the transcript's overflow
box, so High / Medium / Low were clipped by the header. The toolbar
now portals to `document.body` as `position: fixed` and clamps to
the viewport (and stacks if above and below would overlap).

### Project names are unique case-insensitively

Upload and admin create/rename reject names that differ only by
capitalisation. If a contributor uploads to "bosnia123" while
"Bosnia123" already exists, they join that project instead of
creating a duplicate. Existing duplicates (e.g. Bosnia123 vs
bosnian123) are not merged automatically — rename or consolidate
in admin.

### Contributors cannot delete locked complete work

Anyone with write access can delete a recording (including a finished
transcript) after an explicit confirmation that names the file and
states the action is permanent. The Delete button lives on the library
row, the workspace header, and the processing page. `COMPLETE`
recordings stay admin-only so a locked corpus cannot be wiped by a
contributor. There is no soft-delete/archive yet.

### Corpus counts distinguish annotation types

The corpus preview header reports linguistic annotations, transcript
corrections, and total marked items separately so a correction is
not lumped into "annotations."

### Whisper GPU with CPU fallback

`lexa-whisper` now uses `hwdsl2/whisper-server:cuda` with
`WHISPER_DEVICE=auto` and `WHISPER_COMPUTE_TYPE=float16`. The image
uses CUDA when the NVIDIA toolkit can see the GPU, otherwise CPU.
The previous CPU container is kept stopped as `lexa-whisper-cpu`.
The existing `/var/lib/whisper` volume (API key + model cache) is
reused — nothing in Postgres, Redis, or that volume was deleted.
Recreate with `scripts/start-whisper.ps1`.

### Whisper model upgrade: base → large-v3

The `base` model (74M params) produced poor results for Bosnian:
wrong characters, Cyrillic mixing, phantom words. Switched to
`large-v3` (~1.5B params) for significantly better accuracy on
non-English languages. Set via `WHISPER_MODEL=large-v3` in
`.env.local` and the Docker `-e WHISPER_MODEL=large-v3` flag.
Transcription is slower (~2× wall-clock) but far more accurate.

Node's built-in `fetch` (undici) times out after 5 minutes of no
response headers. Whisper only sends headers when the whole file is
done, so `large-v3` on a 1-hour file looked stuck at 74% and then
failed with `fetch failed`. The worker now POSTs with `node:http`
and a 3-hour idle timeout. No new package.

On this Windows host, a 140 MB POST to `localhost:9000` hung in
Docker Desktop's proxy and Whisper never saw the file. Local
Whisper calls now `docker cp` the FLAC into `lexa-whisper` and
`curl` `127.0.0.1:9000` from inside the container.

---

## Transcript find (2026-09-17)

§8 does not specify in-transcript search. A find bar sits above the
transcript column (not in the header). Matches are computed in the
browser from the stored word tokens: NFC case-fold, substring as you
type, and consecutive-word phrase when the query has spaces. Diacritics
are not stripped. Hits are painted on the existing word spans; timings,
anchors, and the corpus are untouched. `⌘F` / `Ctrl+F` focuses the bar
instead of the browser find dialog. Enter / Shift+Enter (and ↑ ↓) walk
matches.

---

## Annotation count menus (2026-09-18)

§8's player legend only showed counts. The loanword, code-switch, and
unclear pills now open a list of the ACTIVE annotations that still have
words, in time order. Choosing a row selects those words, scrolls the
transcript there, and seeks the playhead. Orphans stay in the review
tray. Surfaces are shown as stored.

