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

1. Record a provider and its approved fields in `data/source-registry.json`. Leave it disabled until its terms and the intended commercial/non-commercial use have been checked.
2. Add editorial candidates to `data/editorial-candidates.json` only when the provider has expressly licensed the supplied `licensedBrief` for this workflow. Never paste a full article, scraped page, image, or F1 official RSS material into it.
3. Enable the approved source, set the required repository secrets, and run the scheduled workflow. It deduplicates canonical URLs, asks the model to make an original Korean summary from the licensed brief alone, validates length/category/provenance, then opens a pull request.
4. Inspect the attribution, facts, Korean copy, and Netlify deploy preview. Merge the PR only when it is correct. Production is never written directly by the workflow.

### Editorial article contract

Every published APEX story must identify at least two distinct, enabled sources in its `sources` array. The validation rejects a single-source story, duplicate source URL, unapproved source, missing source link, and common predictive/comparative wording. A `TECHNICAL` story also requires an `engineeringNotes` object with 2–4 entries selected from the reviewed library in `data/engineering-notes.json`.

`editorial-candidates.json` is intentionally empty until a provider is approved. When it is activated, each candidate needs `clusterId`, `sourceId`, `canonicalUrl`, `publishedAt`, `title`, and a provider-licensed `licensedBrief`. The editorial job creates a story only from a cluster that contains two distinct approved sources. The model receives the licensed briefs only, is instructed to retain their common facts, and cannot write its own engineering notes.

An enabled news source can use the guarded RSS collector by setting `connector` to `rss`, adding an HTTPS `feedUrl`, and explicitly permitting `licensedBrief` in `permittedFields`. The collector stores only the source-approved feed fields as review candidates. It never requests a disabled source, and the current registry has no enabled RSS source. Its conservative initial clustering uses a normalized source headline; only exact compatible clusters from two distinct approved sources reach the editorial job.

### Race data

Jolpica is enabled for calendar, classifications, fastest laps, and pit stops after the project owner confirmed on 2026-09-23 that APEX will operate without advertising or paid services. The project records CC BY-NC-SA 4.0 attribution and share-alike obligations in the source registry and on the public site. The six-hour workflow sets the non-commercial confirmation explicitly; no secret is required for this public project-status flag.

The race synchronizer writes calendar entries, classifications, fastest-lap values, pit-stop durations, and winner lap counts into `raceDetails`. Requests are serialized at a minimum 300 ms interval to remain below Jolpica's current unauthenticated burst limit, and the six-hour schedule remains below its sustained limit. Sector, top-speed, tyre-stint, and telemetry fields remain deliberately unavailable pending a provider agreement. A software library licence (including FastF1's MIT licence) is not itself permission to republish data obtained from upstream timing services.

### Official Formula 1 connection

The RACE screen contains two deliberately outbound-only links: official latest news on Formula1.com and official live timing through F1 TV. Their destinations and activation state are recorded in `data/official-f1-connection.json`.

This is not an RSS, API, scraping, storage, or AI-processing integration. Formula 1's current legal notices prohibit commercial use of its RSS feed and prohibit modifying its feed content; its guidelines also protect results and timing data and require an express licence for use with AI. Do not change either ingestion setting from `blocked-pending-express-licence` unless the project has documented written permission covering the exact data fields, territory, storage, redistribution, commercial status, and AI processing.

### GitHub setup

Copy this folder into the connected GitHub repository, then enable Actions. The `APEX data review` workflow runs every six hours or manually. Add `OPENAI_API_KEY` only as an Actions secret, never to the repository. Configure Vercel's normal Git integration so each generated pull request receives a preview deployment. The workflow uses the official OpenAI Responses API with `store: false`.

Sources and terms to re-check before activation: [Jolpica terms](https://github.com/jolpica/jolpica-f1/blob/main/TERMS.md), [Formula 1 legal notices](https://www.formula1.com/en/information/legal-notices.7egvZU48hzrypubGBNcQKt), and [OpenAI Responses API quickstart](https://platform.openai.com/docs/quickstart/make-your-first-api-request).

### Netlify connection

`netlify.toml` publishes only `dist/`. `npm run build` recreates that directory from the current UI files and the validated `data/published-content.json`, so scheduled data updates cannot leave Netlify serving an older JSON copy. Operational files such as the source registry, editorial candidates, scripts, and licence notes are not included in the public bundle.

Connect Netlify to the same GitHub repository and keep the configuration from `netlify.toml`. GitHub Actions prepares a review pull request; after review and merge, Netlify runs the build and deploys the approved JSON. Do not add `OPENAI_API_KEY` to Netlify: the editorial job uses the GitHub Actions secret only.

Before enabling a provider, run `npm run check:connections`. Copy the shape in `data/source-registry.example.json` into the real registry only after replacing all example values with the recorded provider licence and terms. News publication needs two enabled, distinct approved feeds. Jolpica additionally requires the non-commercial confirmation secret.
