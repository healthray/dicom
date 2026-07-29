# AGENTS.md

This file provides guidance to AI coding agents (Claude, Codex, and other LLM tools) when working with code in
this repository.

> **This file is the single source of truth.** `CLAUDE.md` and `.claude/skills/` are **generated** by
> [preinstall.js](preinstall.js) and are gitignored. Edit `AGENTS.md` and the sources under `.agents/` — never
> the generated copies, and never add a separate `CLAUDE.md`.

## Project Overview

This is a **fork of OHIF v3** (Open Health Imaging Foundation), an extensible web-based medical imaging viewer,
customized as the **Healthray** DICOM viewer deployment. Read the [This fork](#this-fork) section before
answering anything about routing, entry points, or how a study gets loaded — that is where a generic OHIF
answer will be actively wrong.

Version 3.13.2. Current branch: `release-3.11`.

## Toolchain

**pnpm workspaces**, not yarn or npm. Node ≥ 24 (`.node-version` pins 24.15.0), pnpm ≥ 11
(`packageManager: pnpm@11.5.2`).

Workspace globs are in [pnpm-workspace.yaml](pnpm-workspace.yaml): `platform/*`, `extensions/*`, `modes/*`.
Note `nodeLinker: hoisted` and `frozenLockfile: true` — installs are strict by default.

## Development Commands

Run everything from the repo root. Root scripts delegate with `pnpm --filter <package>`.

```bash
pnpm install               # runs preinstall.js, which regenerates CLAUDE.md + .claude/skills

pnpm run dev               # dev server via rspack, http://localhost:3000 (override with OHIF_PORT)
pnpm run dev:fast          # dev server via rsbuild — faster, uses rsbuild.config.ts
pnpm run dev:orthanc       # dev against a local Orthanc PACS
pnpm run dev:dcm4chee      # dev against a local dcm4chee PACS
pnpm run dev:static        # dev against static DICOMweb files

pnpm run build             # production build of @ohif/app
pnpm run build:dev         # development-mode build

pnpm run test:unit         # jest, all projects, with coverage
pnpm run test:e2e          # Playwright (see the ohif-test-agent skill)
pnpm run test:e2e:ui       # Playwright UI mode

pnpm run clean             # remove build output in every package
```

**Build system:** `rspack` for the main dev server and production build
(`rspack serve --config .webpack/webpack.pwa.js`), and `rsbuild` for `dev:fast`. The `.webpack/` directory name
is historical — the bundler is rspack. Extensions are auto-registered at build time by
`platform/app/.webpack/writePluginImportsFile.js`, which generates the gitignored
`platform/app/src/pluginImports.js` from [platform/app/pluginConfig.json](platform/app/pluginConfig.json).

**Testing:** Jest runs as a multi-project setup rooted at [jest.config.js](jest.config.js), collecting
`platform/*/jest.config.js` and `extensions/*/jest.config.js`. Playwright specs live in [tests/](tests/) and run
against port **3335** with `data-cy` as the `testIdAttribute`.

## Architecture Overview

### Monorepo Structure

| Directory | Package | Role |
|---|---|---|
| `platform/app/` | `@ohif/app` | The viewer application — routes, app config, bundler config |
| `platform/core/` | `@ohif/core` | Services, managers, DICOM metadata, data source interface |
| `platform/ui-next/` | `@ohif/ui-next` | Current UI component library |
| `platform/ui/` | `@ohif/ui` | Legacy UI component library |
| `platform/i18n/` | `@ohif/i18n` | Translations |
| `platform/cli/` | `@ohif/cli` | Extension/mode scaffolding CLI |
| `platform/docs/` | `ohif-docs` | Docusaurus documentation site |
| `extensions/*` | `@ohif/extension-*` | Modular functionality plugins |
| `modes/*` | `@ohif/mode-*` | Workflow configurations that compose extensions |

### Extensions

Package names do not always match directory names — check `package.json` before importing.

| Directory | Package |
|---|---|
| `cornerstone/` | `@ohif/extension-cornerstone` — image rendering engine |
| `cornerstone-dicom-seg/` | `@ohif/extension-cornerstone-dicom-seg` — DICOM Segmentation |
| `cornerstone-dicom-sr/` | `@ohif/extension-cornerstone-dicom-sr` — DICOM Structured Report |
| `cornerstone-dicom-rt/` | `@ohif/extension-cornerstone-dicom-rt` — RTSTRUCT |
| `cornerstone-dicom-pmap/` | `@ohif/extension-cornerstone-dicom-pmap` — Parametric Map |
| `cornerstone-dynamic-volume/` | `@ohif/extension-cornerstone-dynamic-volume` — 4D volumes |
| `default/` | `@ohif/extension-default` — standard OHIF functionality, data sources |
| `dicom-microscopy/` | `@ohif/extension-dicom-microscopy` — whole-slide imaging |
| `dicom-pdf/` | `@ohif/extension-dicom-pdf` |
| `dicom-video/` | `@ohif/extension-dicom-video` |
| `measurement-tracking/` | `@ohif/extension-measurement-tracking` |
| `tmtv/` | `@ohif/extension-tmtv` — PET/CT total metabolic tumor volume |
| `usAnnotation/` | **`@ohif/extension-ultrasound-pleura-bline`** — note the mismatch |
| `test-extension/` | `@ohif/extension-test` |

### Modes

`basic`, `basic-dev-mode`, `basic-test-mode` (`@ohif/mode-test`), `longitudinal`, `microscopy`,
`preclinical-4d`, `segmentation`, `tmtv`, `usAnnotation` (`@ohif/mode-ultrasound-pleura-bline`).

Modes compose rather than duplicate: [modes/longitudinal/src/index.ts](modes/longitudinal/src/index.ts) spreads
`@ohif/mode-basic` and overrides only the panels and viewports it changes. Follow that pattern.

### Extension System

Each extension exports modules (viewports, tools, panels, commands) that the app dynamically loads. An
extension is an object with a required `id` plus any of the `get*Module` functions — see
[extensions/default/src/index.ts](extensions/default/src/index.ts) for the full surface:

`preRegistration`, `onModeEnter`, `onModeExit`, `getDataSourcesModule`, `getViewportModule`,
`getLayoutTemplateModule`, `getPanelModule`, `getHangingProtocolModule`, `getSopClassHandlerModule`,
`getToolbarModule`, `getCommandsModule`, `getUtilityModule`, `getCustomizationModule`.

### Service-Oriented Design (PUB-SUB)

Services are registered with the Services Manager and reached via `servicesManager.services`.

Core services ([platform/core/src/services/](platform/core/src/services/)): `DisplaySetService`,
`MeasurementService`, `HangingProtocolService`, `CustomizationService`, `ToolBarService`, `PanelService`,
`ViewportGridService`, `CineService`, `StudyPrefetcherService`, `WorkflowStepsService`, `MultiMonitorService`,
`UserAuthenticationService`, `UIDialogService`, `UIModalService`, `UINotificationService`,
`UIViewportDialogService`, and the `DicomMetadataStore`.

Cornerstone services ([extensions/cornerstone/src/services/](extensions/cornerstone/src/services/)):
`ViewportService` (a.k.a. `cornerstoneViewportService`), `SegmentationService`, `ToolGroupService`,
`SyncGroupService`, `CornerstoneCacheService`, `ColorbarService`, `ViewedDataService`.

Most services extend the pub/sub interface at `pubSubServiceInterface.ts`.

### Commands Manager

Tracks named commands scoped to a context. `commandsManager.runCommand(name, options)` looks the command up
across the active contexts in order and runs the first match. Commands are defined in an extension's
`commandsModule.ts` (sometimes `getCommandsModule.tsx`).

### Extension Manager

Aggregates and exposes extension modules across the app, manages data sources, and is the registry for
accessing extension functionality.

### Key Technologies

React 18 + TypeScript, Cornerstone3D (`@cornerstonejs/*`), DICOM / DICOMweb, ONNX Runtime (SAM segmentation),
Zustand for stores, TailwindCSS.

---

## This fork

These are deliberate Healthray-specific deviations from upstream OHIF. **Do not "fix" them back toward stock
OHIF behaviour.**

### `/home` is the only entry point

[platform/app/src/routes/Local/Local.tsx](platform/app/src/routes/Local/Local.tsx) is the entry route. It
fetches a file from a URL and loads it into the in-memory `DicomMetadataStore`:

```
/home?url=<file-url>[&fileType=zip|dcm|pdf]
```

### Format is detected from bytes, not from the query parameter

[platform/app/src/routes/Local/detectFileFormat.ts](platform/app/src/routes/Local/detectFileFormat.ts) reads the
first `HEADER_BYTES` (132) and matches magic bytes — zip signatures and `%PDF` at offset 0, `DICM` at offset 128
after the DICOM preamble. **Detection wins over `?fileType=`**; a contradiction is logged as a warning. This
exists because the route previously defaulted to `zip` and fed single DICOM files to JSZip.

Load path: `getBlobByURL` → `detectFormat` → (`JSZip` for archives, or wrap in a `File` with the detected MIME
type) → `filesToStudies` → `DicomMetadataStore`.

### Routes are gated

[platform/app/src/routes/index.tsx](platform/app/src/routes/index.tsx):

- `ALLOWED_MODE_ROUTES = ['viewer', 'microscopy']` — every other mode route renders the Healthray notice.
- `/notfoundserver`, `/notfoundstudy`, `/debug` and `/localbasic` are **deliberately not registered**. Code that
  still navigates to them falls through to the not-found route, which is the intended outcome.
- Viewer routes are gated on `DicomMetadataStore` containing at least one study, which only `/home` populates.
  **The viewer cannot be deep-linked or refreshed into.**

### Branding

[platform/app/src/components/HealthrayNotice.tsx](platform/app/src/components/HealthrayNotice.tsx) is the card
shown on every non-viewer screen. Asset URLs **must** be prefixed with `publicUrl`
([platform/app/src/utils/publicUrl.ts](platform/app/src/utils/publicUrl.ts)) — a relative `./logo.png` resolves
against the current path and 404s on two-segment routes such as `/viewer/dicomlocal`.

---

## Development Patterns

### Never modify core architecture

Do not modify `platform/core`. Implement solutions via extensions and modes. Only touch core as a last resort,
when every other approach fails or there is a genuine architectural constraint — and say so explicitly.

### Prefer pub/sub over `useEffect`

Subscribe to a service rather than polling or deriving state in an effect:

```ts
useEffect(() => {
  const subscriptions = [
    cornerstoneViewportService.subscribe(EVENTS.VIEWPORT_DATA_CHANGED, handleViewportDataChanged),
    syncGroupService.subscribe(EVENTS.VIEWPORT_REMOVED, onHotKeyRemoval),
    syncGroupService.subscribe(EVENTS.VIEWPORT_ADDED, onHotKeyAddition),
  ];

  return () => {
    subscriptions.forEach(({ unsubscribe }) => unsubscribe());
  };
}, []);
```

Always return the unsubscribe cleanup.

### Where code goes

| What | Where | Follow the example of |
|---|---|---|
| Tool | `extensions/cornerstone/src/tools/` | register in `toolNames.ts`, add to `getToolbarModule.tsx`, map in `measurementServiceMappings/` |
| Store (Zustand) | extension's `stores/` | `useLutPresentationStore.ts`, `useSynchronizersStore.ts` |
| Hook | extension's `hooks/` | `usePatientInfo.tsx` |
| Provider | extension's `providers/` or `contexts/` | `ViewportGridProvider.tsx` |
| Synchronizer | extension's `synchronizers/` | `frameViewSynchronizer.ts` |
| Utility | extension's `utils/` | `formatPN.ts` |
| Icon | `icons/`, then register | `import { addIcon } from '@ohif/extension-default/src/utils'` |
| Command | extension's `commandsModule.ts` | `extensions/cornerstone/src/commandsModule.ts` |

### Overriding OHIF components

Create the replacement in your extension's `components/` directory and import it instead of the `ui-next`
component. A mode's `layoutTemplate` tells you where the original is wired up — see
[modes/longitudinal/src/index.ts](modes/longitudinal/src/index.ts).

### Service integration

```javascript
const { measurementService, displaySetService } = servicesManager.services;
```

Register a new service from the extension's `preRegistration` via `servicesManager.registerService`.

## Code Style

Prettier ([.prettierrc](.prettierrc)) — `printWidth: 100`, `singleQuote: true`, `trailingComma: 'es5'`,
`arrowParens: 'avoid'`, `singleAttributePerLine: true`, `proseWrap: 'always'`, 2-space indent, semicolons.
Includes `prettier-plugin-tailwindcss`, so Tailwind class order is enforced.

ESLint ([.eslintrc.json](.eslintrc.json)) — TypeScript + React + prettier. `curly` is an error: always brace
control statements.

## Skills

Skills are committed under `.agents/skills/` and mirrored into `.claude/skills/` by
[preinstall.js](preinstall.js). Add new skills to `.agents/skills/`, then re-run `node preinstall.js`.

| Skill | Use for |
|---|---|
| `ohif-test-agent` | Writing or debugging Playwright E2E tests |
| `ohif-extension-mode-authoring` | Creating or modifying an extension or mode |
| `ohif-viewport-debug` | Diagnosing rendering, layout, display set, or tool problems |
| `ohif-dicom-data` | Data sources, SOP class handlers, display set creation, the `/home` load path |

## Medical Imaging Specifics

### DICOM Support

Multi-modality (CT, MR, X-Ray, Mammography, Ultrasound, PET), SOP Class handlers for specialized types (RT, SEG,
SR, PMAP), and DICOMweb for web-based retrieval. Data sources live in
[extensions/default/src/](extensions/default/src/): `DicomWebDataSource`, `DicomJSONDataSource`,
`DicomLocalDataSource`, `DicomWebProxyDataSource`, `MergeDataSource`.

### Hanging Protocols

Define how images are arranged and displayed. They live in `hps/` directories, are JSON with viewport matching
rules, and support priors comparison and multi-monitor layouts. Resolved by `HangingProtocolService`.

### Measurement Tools

Cornerstone Tools integration for annotations — bidirectional measurements, polylines, splines, freehand.
Export to DICOM SR and CSV. AI-assisted segmentation via ONNX models.
