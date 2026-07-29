---
name: ohif-viewport-debug
description: Diagnose OHIF viewport, rendering, and layout problems — a blank or black viewport, a series that will not display, the wrong layout or hanging protocol being applied, a tool that does not activate, segmentations or annotations not appearing, MPR/3D failing to build, stale or missing measurements, or viewports that fall out of sync. Use this skill whenever the user reports something "not showing", "not rendering", "blank", "black", "not loading", "wrong layout", "tool not working", or asks why a study displays incorrectly in the OHIF viewer. Covers the DisplaySetService to HangingProtocolService to ViewportGridService to CornerstoneViewportService pipeline and the window.services runtime inspection entry point.
---

# OHIF Viewport & Rendering Debugging

Most "it doesn't render" reports are not rendering bugs. They are a break somewhere in a four-stage pipeline,
and the stage tells you which service to look at. **Locate the stage before reading any rendering code.**

## The pipeline

```
DICOM metadata (DicomMetadataStore)
  │  instances grouped into series
  ▼
DisplaySetService              ← SOP class handlers turn series into display sets
  │  displaySets
  ▼
HangingProtocolService         ← matches display sets to viewport slots by rules
  │  a matched protocol + stage
  ▼
ViewportGridService            ← the grid: which viewport shows which display set
  │  viewport state
  ▼
CornerstoneViewportService     ← actual Cornerstone3D rendering onto WebGL
```

Failure at each stage looks different:

| Symptom | Failing stage | First thing to check |
|---|---|---|
| Series missing from the study/thumbnail panel entirely | `DisplaySetService` | No SOP class handler claimed it |
| Series in the panel, but never auto-displays | `HangingProtocolService` | No protocol rule matches it |
| Display set assigned but the pane is blank | mode `viewports` mapping | Its handler is not in any `displaySetsToDisplay` |
| Pane present, black canvas | `CornerstoneViewportService` | Image load failure, VOI/windowing, or CPU fallback |
| Renders, but tools do nothing | `ToolGroupService` | Tool not in the active tool group |
| Overlay (SEG/RT/annotation) missing | `SegmentationService` / `MeasurementService` | Not hydrated, or representation not added |
| Two viewports won't stay in step | `SyncGroupService` | Viewports not in the same sync group |

## Start here: inspect the live app

`extensions/cornerstone/src/init.tsx` exposes three globals unconditionally, so the browser console is the
fastest diagnostic tool available:

```js
window.services          // every registered service
window.extensionManager
window.commandsManager
```

Work down the pipeline in the console:

```js
// 1. Did the series become a display set at all?
window.services.displaySetService.getActiveDisplaySets()
  .map(ds => ({ id: ds.displaySetInstanceUID, modality: ds.Modality,
                sopHandler: ds.SOPClassHandlerId, images: ds.numImageFrames }));

// 2. Which protocol matched, and at which stage?
window.services.hangingProtocolService.getActiveProtocol();

// 3. What does the grid think each viewport is showing?
window.services.viewportGridService.getState();

// 4. Does Cornerstone have a viewport, and what is in it?
window.services.cornerstoneViewportService.getCornerstoneViewport('<viewportId>');
```

The first of those four that returns nothing (or the wrong thing) is your failing stage. Everything downstream
of it is a symptom, not the cause.

**Caveat:** a service read tells you about the *data model*, not the pixels. If the state looks right and the
canvas is still wrong, the problem is in rendering itself (VOI, transfer function, camera, CPU fallback) — not
in the state.

## Stage-by-stage

Detailed checks, the events each service broadcasts, and the traps in each are in
[references/pipeline-stages.md](references/pipeline-stages.md). The short version:

**DisplaySetService** — a series with no matching SOP class handler produces no display set. Handler order in
the mode's `sopClassHandlers` matters: more general handlers must come last, or they steal series from specific
ones. Events: `DISPLAY_SETS_ADDED`, `DISPLAY_SETS_CHANGED`, `DISPLAY_SETS_REMOVED`,
`DISPLAY_SET_SERIES_METADATA_INVALIDATED`.

**HangingProtocolService** — protocols live in `hps/` directories and are matched by rules against display set
attributes. A protocol matching but showing the wrong thing is usually a stage or `displaySetSelector`
problem, not a matching problem. Custom attributes live under `HangingProtocolService/custom-attribute/`.

**Mode `viewports` mapping** — the trap that looks like a rendering bug but is configuration: if a display
set's SOP class handler id is not listed in any `viewports[].displaySetsToDisplay` entry in the mode's
`layoutInstance.props`, it renders nowhere. Adding a SOP class handler without adding it here is the single
most common cause of a silently blank viewport.

**CornerstoneViewportService** — owns rendering engines, viewport creation, and presentation state. Check
whether CPU fallback is active (`cornerstone.getShouldUseCPURendering()`); CPU rendering silently disables
volume, MPR and 3D.

**ToolGroupService / SyncGroupService** — a tool must be *in the active tool group* to respond, regardless of
whether its toolbar button renders. `toolGroupAdditions` in the mode instance is how tools get layered on.

## Prefer pub/sub over `useEffect`

When the fix involves reacting to state, subscribe to the service. This is more reliable than deriving state in
an effect, and it is the repo's stated convention:

```ts
useEffect(() => {
  const subscriptions = [
    cornerstoneViewportService.subscribe(EVENTS.VIEWPORT_DATA_CHANGED, handleViewportDataChanged),
    syncGroupService.subscribe(EVENTS.VIEWPORT_REMOVED, onHotKeyRemoval),
    syncGroupService.subscribe(EVENTS.VIEWPORT_ADDED, onHotKeyAddition),
  ];

  return () => subscriptions.forEach(({ unsubscribe }) => unsubscribe());
}, []);
```

Always return the cleanup. A subscription leaked across a mode switch causes handlers to fire against destroyed
viewports — which presents as a *rendering* bug and wastes debugging time.

Every service's event names are on the service itself (`someService.EVENTS`) and in its `EVENTS.js`/`EVENTS.ts`
file. Read them there rather than guessing — event name strings are namespaced
(`event::displaySetService:displaySetsAdded`) and a typo'd subscribe fails silently.

## Timing traps

- Services are destroyed on mode exit (`toolGroupService`, `syncGroupService`, `segmentationService`,
  `cornerstoneViewportService` all have `destroy()` called by `onModeExit`). Anything holding a reference
  across a mode switch is stale.
- Hanging protocol changes do not always transition viewports through `needsRender` synchronously.
- SEG / RT / SR display sets require **hydration** before they render — an un-hydrated overlay is not a bug.
- Volume-based viewports (MPR, 3D) need volumes loaded, not just images cached.

## This fork

The viewer cannot be deep-linked. `ALLOWED_MODE_ROUTES = ['viewer', 'microscopy']` and viewer routes are gated
on `DicomMetadataStore` being populated, which only `/home` does. **To reproduce any viewport bug you must load
through `/home?url=<file-url>`** — refreshing a viewer URL gives you an empty store and a blank page, which is
expected behaviour and not the bug you are chasing.

If the study itself is not loading, the problem is upstream of this skill — use the **`ohif-dicom-data`** skill
for the `/home` load path, data sources, and SOP class handlers.

## Fixing

Once located, fix it from an extension or mode — never `platform/core`. See the
**`ohif-extension-mode-authoring`** skill for where the fix belongs.

Reproduce the failure with a Playwright spec where the behaviour is user-visible; use the **`ohif-test-agent`**
skill rather than hand-rolling one. Note that skill's guidance: assert on DOM/SVG signals where they exist, and
use a viewport-scoped screenshot only for canvas-only raster output. A `window.services` read is a debugging
tool and a test *setup* escape hatch — never a substitute for a render assertion.

## Rules

1. Locate the failing pipeline stage before reading rendering code.
2. Use `window.services` in the browser console as the first diagnostic; walk the four stages in order.
3. A service state read proves the data model, not the pixels — don't conclude "it renders" from it.
4. Check the mode's `viewports[].displaySetsToDisplay` before suspecting Cornerstone.
5. `sopClassHandlers` order matters; general handlers last.
6. Read event names from the service's `EVENTS` file; never type them from memory.
7. Subscribe to services instead of deriving state in `useEffect`, and always return the unsubscribe.
8. Remember services are destroyed on mode exit — stale references present as rendering bugs.
9. Reproduce through `/home?url=...`; the viewer cannot be deep-linked in this fork.
10. Fix from an extension or mode, never `platform/core`.

## Pre-output self-check

Before reporting a diagnosis:

1. The failing stage is named explicitly, with the evidence that isolated it.
2. Downstream symptoms are not being reported as separate causes.
3. Any claim that rendering works is backed by something other than a `window.services` read.
4. The proposed fix lives in an extension or mode, or the need for a core change is explicitly justified.
5. Any new subscription returns its unsubscribe.
6. If the app was not actually run, that is stated plainly, along with the exact steps to reproduce —
   including loading via `/home?url=...`.
