# APEX — Phase 2 foundation

Desktop-first Formula 1 editorial site. The Phase 1 presentation remains intact; Phase 2 adds a guarded, review-first data pipeline. It ships with illustrative content only—no unreviewed live F1 information is shown.

## Run

Open `index.html` in a modern browser for a local sample. Netlify uses `npm run build` to create the public `dist/` bundle; the project has no third-party package dependencies.

For local-server navigation, from this folder use any static web server, for example:

```powershell
py -m http.server 8080
```

Then visit `http://localhost:8080`.

## Included

- Fixed APEX header and hash-based HOME / TECHNICAL / PADDOCK / RACE navigation.
- Hover and focus feedback for interactive elements, including emphasis on the HOME section titles.
- HOME 2026 sample constructor and driver standings, with a Phase 2 image-sequence animation placeholder.
- All ten 2026 team names in the TECHNICAL selector and latest-first team feeds.
- PADDOCK featured story plus DRIVER / TEAM / OTHER filters, retained as an AI-ready taxonomy for a future ingestion workflow.
- Horizontally scrollable 2026 sample circuit rail and completed/upcoming circuit states. A hidden `#globe-stage` mount point reserves the Phase 3 integration boundary without rendering a 3D globe in Phase 2.
- Race detail layout: circuit with sector annotations, race overview, strategy analysis, latest news, then race result. Approved data replaces only its matching fields; unavailable fields remain explicitly unavailable.

## Phase 2 data workflow

`data/published-content.json` is the only live-data input consumed by the browser. It is empty by default, so the original Phase 1 samples remain visible. Every proposed change must pass `npm run validate` and a pull-request review.

1. `data/source-registry.json` now contains 11 candidate news outlets. They are disabled until the exact feed, terms, and allowed fields are confirmed. A long source list is not the same as 11 working or approved feeds.
2. Add editorial candidates only from source-approved briefs that may be used for this workflow. Do not paste full articles, scraped pages, images, or Formula1.com RSS text into the pipeline.
3. Enable a confirmed source and run the scheduled workflow. Each eligible report can produce its own APEX story; multiple reports about one subject can be grouped. The model writes only from supplied approved briefs, then opens a pull request for review.
4. Inspect the attribution, facts, Korean copy, and Netlify deploy preview. Merge the PR only when it is correct. Production is never written directly by the workflow.

### Editorial article contract

Every published APEX story must identify at least one enabled source in its `sources` array. A single-source report is allowed; its claims must remain attributed to that publisher, especially rumors, allegations, and anonymous-source reporting. Multiple reports may be combined when they concern the same subject, but claims must not be blended into stronger certainty than the sources support. Validation rejects duplicate source URLs, unapproved sources, missing source links, and common predictive/comparative wording. A `TECHNICAL` story also requires an `engineeringNotes` object with 2–4 entries selected from the reviewed library in `data/engineering-notes.json`.

`editorial-candidates.json` is intentionally empty until a provider is approved. Each candidate needs `clusterId`, `sourceId`, `canonicalUrl`, `publishedAt`, `title`, and a source-approved `licensedBrief`. A cluster may contain one or several distinct sources. The model receives only the approved briefs, must keep single-source reports attributed, and cannot write its own engineering notes. Human review remains required before publication.

An enabled news source can use the guarded RSS collector by setting `connector` to `rss`, adding an HTTPS `feedUrl`, and explicitly permitting `licensedBrief` in `permittedFields`. The collector stores only source-approved feed fields as review candidates and never requests a disabled source. The current candidate list has no enabled news feed. Its initial grouping uses a normalized headline; single-source candidates are allowed, while matching headlines can be grouped for multi-source coverage. The source list is a set of candidates, not a claim that every publisher offers an RSS feed or permits this use.

### TECHNICAL research references

`data/technical-source-guide.json` records the 20 references requested for TECHNICAL coverage and the role each can play (technical reporting, engineering explanation, statistics, session data, or business reporting). These names and links are a research directory, not evidence and not active feeds. The editorial model only receives facts from a candidate's `technicalReferences` entries; each entry needs a source-specific `licensedBrief`, matching publisher URL, `termsReviewed: true`, and a guide record with `approvedForUse: true` plus an HTTPS `termsUrl`. The article will cite reference sources the model actually used. This avoids treating library documentation, live timing tables, opinion, or a site's name as proof of a news claim. The existing engineering-notes library remains the source for general educational component descriptions.

### Race data

Jolpica is enabled for calendar, classifications, fastest laps, and pit stops after the project owner confirmed on 2026-09-23 that APEX will operate without advertising or paid services. The project records CC BY-NC-SA 4.0 attribution and share-alike obligations in the source registry and on the public site. The six-hour workflow sets the non-commercial confirmation explicitly; no secret is required for this public project-status flag.

The race synchronizer writes calendar entries, classifications, fastest-lap values, pit-stop durations, and winner lap counts into `raceDetails`. Requests are serialized at a minimum 300 ms interval to remain below Jolpica's current unauthenticated burst limit, and the six-hour schedule remains below its sustained limit. Sector, top-speed, tyre-stint, and telemetry fields remain deliberately unavailable pending a provider agreement. A software library licence (including FastF1's MIT licence) is not itself permission to republish data obtained from upstream timing services.

### Official Formula 1 connection

The RACE screen contains two deliberately outbound-only links: official latest news on Formula1.com and official live timing through F1 TV. Their destinations and activation state are recorded in `data/official-f1-connection.json`.

This is not an RSS, API, scraping, storage, or AI-processing integration. Formula 1's current legal notices prohibit commercial use of its RSS feed and prohibit modifying its feed content; its guidelines also protect results and timing data and require an express licence for use with AI. Do not change either ingestion setting from `blocked-pending-express-licence` unless the project has documented written permission covering the exact data fields, territory, storage, redistribution, commercial status, and AI processing.

### GitHub setup

Copy this folder into the connected GitHub repository, then enable Actions. The `APEX data review` workflow runs every six hours or manually. Add `GEMINI_API_KEY` only as an Actions secret, never to the repository. Configure the deployment preview so each generated pull request can be reviewed before merge. The editorial workflow calls Google's Gemini Developer API directly and defaults to `gemini-3.8-flash`; `GEMINI_MODEL` can override the model.

Gemini setup and terms to review: [Gemini structured output API](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), [Gemini API pricing and free-tier data use](https://ai.google.dev/gemini-api/docs/pricing), and [Gemini API key guidance](https://ai.google.dev/gemini-api/docs/api-key). Free-tier availability and quotas depend on the selected model and project; Google's pricing page says free-tier prompts may be used to improve its products. Keep the key secret and restrict it to the Gemini API in Google AI Studio/Cloud.

### GitHub Pages deployment

GitHub Pages publishes only `dist/`. `npm run build` recreates that directory from the current UI files and the validated `data/published-content.json`, so scheduled data updates cannot leave the public site serving an older JSON copy. Operational files such as the source registry, editorial candidates, scripts, and licence notes are not included in the public bundle.

The `Deploy APEX to GitHub Pages` workflow runs whenever `main` changes. GitHub Actions prepares an editorial review pull request; after review and merge, GitHub Pages builds and deploys the approved JSON. Do not add `GEMINI_API_KEY` to GitHub Pages or browser code: only the editorial GitHub Actions job needs it, as a repository secret.

Before enabling a provider, run `npm run check:connections`. Copy the shape in `data/source-registry.example.json` into the real registry only after replacing all example values with the recorded provider licence and terms. A single approved news feed is enough for an attributed single-source article; the candidate outlets still need to be verified and enabled one by one. Jolpica additionally requires the non-commercial confirmation secret.
