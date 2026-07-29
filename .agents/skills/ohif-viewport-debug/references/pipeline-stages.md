# Pipeline stages in detail

Per-stage checks, events, and traps. **These are stable rules, not an API listing** — for a method signature or
the current set of events, open the service source, which is authoritative.

Service locations:
- Core: [platform/core/src/services/](../../../../platform/core/src/services/)
- Cornerstone: [extensions/cornerstone/src/services/](../../../../extensions/cornerstone/src/services/)

Event names are namespaced strings (`event::displaySetService:displaySetsAdded`). A typo'd `subscribe` fails
**silently** — always read the name from the service's `EVENTS` file or `someService.EVENTS`, never from memory.

---

## 1. DisplaySetService

Turns series into display sets by running the mode's SOP class handlers over them.

**Check**

```js
window.services.displaySetService.getActiveDisplaySets()
  .map(ds => ({ uid: ds.displaySetInstanceUID, modality: ds.Modality,
                handler: ds.SOPClassHandlerId, frames: ds.numImageFrames,
                loading: ds.isLoading, reason: ds.unsupportedReason }));
```

**Events** (`DisplaySetService/EVENTS.js`)

| Event | Fires when |
|---|---|
| `DISPLAY_SETS_ADDED` | New display sets created |
| `DISPLAY_SETS_CHANGED` | The active set list changed |
| `DISPLAY_SETS_REMOVED` | Display sets removed |
| `DISPLAY_SET_SERIES_METADATA_INVALIDATED` | Series metadata replaced — a common source of stale UI |

**Traps**

- No handler claims the series → **no display set at all**. The series is missing from the panel, not blank in
  a viewport. `getDisplaySetsFromUnsupportedSeries` in `extensions/default/src/` is the catch-all; if a series
  lands there, no specific handler matched.
- `sopClassHandlers` order in the mode instance matters. General handlers must come last — in `modes/basic`,
  `dicomvideo.sopClassHandler` is deliberately first so video transfer syntaxes are claimed before the generic
  image handler sees them.
- Display sets are created asynchronously as metadata arrives. An empty list immediately after load is timing,
  not failure.

---

## 2. HangingProtocolService

Matches display sets to viewport slots using protocol rules.

**Check**

```js
const hp = window.services.hangingProtocolService;
hp.getActiveProtocol();            // protocol + stage index
hp.getMatchDetails?.();            // why each viewport got what it got, when available
```

**Events** (`HangingProtocolService.ts`, `static EVENTS`)

| Event | Meaning |
|---|---|
| `PROTOCOL_CHANGED` | A new protocol is to be applied immediately |
| `PROTOCOL_RESTORED` | An earlier state was restored, **not** re-applied |
| `STAGE_ACTIVATION` | Stage activation status is known |
| `CUSTOM_IMAGE_LOAD_PERFORMED` | Custom image load finished |
| `NEW_LAYOUT` | Deprecated — do not use in new code |

**Traps**

- "Wrong layout" is usually the **stage**, not the protocol. Check the stage index before the matching rules.
- Protocols are registered from `getHangingProtocolModule` and live in extension `hps/` directories. Matching
  is by display set attributes; custom attributes are registered under
  `HangingProtocolService/custom-attribute/`.
- `PROTOCOL_RESTORED` deliberately does not re-apply. Code that only listens to `PROTOCOL_CHANGED` will miss
  restores and appear to lose state on navigation.
- Protocol changes do not always transition viewports through `needsRender` synchronously — the one documented
  case where a render-wait helper is insufficient.

---

## 3. ViewportGridService and the mode `viewports` mapping

The grid holds which viewport shows which display set. The **mode** decides which viewport component is even
eligible.

**Check**

```js
window.services.viewportGridService.getState();   // viewports, activeViewportId, layout
```

**The trap that looks like a rendering bug**

In the mode's `layoutInstance.props`:

```ts
viewports: [
  { namespace: cornerstone.viewport, displaySetsToDisplay: [ohif.sopClassHandler, ...] },
]
```

If a display set's SOP class handler id appears in **no** entry's `displaySetsToDisplay`, it renders nowhere —
silently. Adding a SOP class handler without adding it here is the most common cause of a blank pane. Verify
this before touching Cornerstone.

---

## 4. CornerstoneViewportService

Owns rendering engines, viewport creation, presentation state, and the Cornerstone3D binding.

**Check**

```js
const csvs = window.services.cornerstoneViewportService;
csvs.getCornerstoneViewport('<viewportId>');
csvs.getRenderingEngine();
```

**Events** (`CornerstoneViewportService.ts`)

| Event | Fires when |
|---|---|
| `VIEWPORT_DATA_CHANGED` | The viewport's data was replaced |
| `VIEWPORT_VOLUMES_CHANGED` | Volume bindings changed |

**Traps**

- **CPU fallback.** `cornerstone.getShouldUseCPURendering()` — CPU rendering silently disables volume, MPR and
  3D. `appConfig.showCPUFallbackMessage` controls whether the user is told. A "3D doesn't work" report on a
  machine without WebGL2 is this.
- Black canvas with correct state is usually VOI/windowing or camera, not data.
- Volume viewports need **volumes loaded**, not merely images cached — `CornerstoneCacheService` distinguishes
  these.
- MPR blanking during SEG hydration relates to volume actor handling (`vtkVolume` vs `vtkImageSlice` under the
  generic-viewport path). If you are chasing that, read the `VOLUME_ACTOR_CLASS_NAMES` comment in the service.

---

## 5. ToolGroupService

A tool responds only if it is **in the active tool group**, independent of whether its toolbar button renders.
A visible-but-dead button means the button exists and the tool does not.

```js
window.services.toolGroupService.getToolGroupForViewport('<viewportId>');
```

Tool groups are created by the mode's `initToolGroups` and extended by `toolGroupAdditions` (keyed `default`,
`mpr`, `SRToolGroup`, `volume3d`). `toolGroupService.destroy()` runs on mode exit.

---

## 6. SegmentationService / MeasurementService

**Traps**

- SEG, RT and SR display sets require **hydration**. An un-hydrated overlay not rendering is correct behaviour,
  not a bug — check for the hydration prompt first.
- `MeasurementService.clearMeasurements()` is called by `onModeEnter` in `modes/basic`. Measurements do not
  survive a mode change by default.
- Segmentation representations are per-viewport. A segmentation existing in the service does not mean a
  representation was added to the viewport you are looking at.

---

## 7. SyncGroupService

Viewports stay in step only when they are in the same sync group (zoom, pan, scroll, VOI have separate
groups). `syncGroupService.destroy()` runs on mode exit.

---

## Lifecycle: what is destroyed on mode exit

`modes/basic`'s `onModeExit` calls `destroy()` on `toolGroupService`, `syncGroupService`,
`segmentationService`, and `cornerstoneViewportService`, hides all dialogs and modals, and runs every
unsubscribe tracked on `this._unsubscriptions`.

Consequences worth remembering:

- Any reference held across a mode switch is stale.
- A subscription that was not registered on `_unsubscriptions` (or not cleaned up in a `useEffect` return)
  leaks and fires against destroyed viewports — which presents as a rendering bug.
- Extensions clear their own Zustand stores in their `onModeExit`; `extensions/default/src/index.ts` is the
  model.
