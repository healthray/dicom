# Extension module map

Which module type does what, what it returns, and which extension to read as the canonical example.

**These are stable rules, not an API listing.** For the exact signature of any module or the current set of
entries it returns, open the file — the source evolves and the source is right.

## Module id naming

Every module entry is addressable from a mode as:

```
<packageName>.<moduleType>.<entryName>
```

For example `@ohif/extension-cornerstone.panelModule.panelSegmentation` — the `panelSegmentation` entry of
`getPanelModule` in `@ohif/extension-cornerstone`.

The `<moduleType>` segment is the **module name minus the `get` prefix, camelCased**: `getPanelModule` →
`panelModule`, `getViewportModule` → `viewportModule`, `getSopClassHandlerModule` → `sopClassHandlerModule`,
`getLayoutTemplateModule` → `layoutTemplateModule`, `getHangingProtocolModule` → `hangingProtocolModule`.

A typo'd module string does **not** throw — the panel or viewport silently does not render. Reference modules
through the constants exported by `@ohif/mode-basic` (`ohif`, `cornerstone`, `dicomsr`, `dicomSeg`, `dicomRT`,
`dicompdf`, `dicomvideo`, `dicomPmap`, `dicomecg`) rather than typing the string.

## Modules

| Module | Returns | Read this |
|---|---|---|
| `getViewportModule` | `[{ name, component }]` — component receives `displaySets`, `viewportOptions`, `servicesManager` | `extensions/dicom-pdf/src/index.tsx` (smallest), `extensions/cornerstone/src/getViewportModule` |
| `getPanelModule` | `[{ name, iconName, iconLabel, label, component }]` | `extensions/default/src/getPanelModule.tsx` |
| `getToolbarModule` | `[{ name, defaultComponent, clickHandler }]` — the button *types*, not the buttons | `extensions/default/src/getToolbarModule.tsx` |
| `getCommandsModule` | `{ actions, definitions, defaultContext }` | `extensions/cornerstone/src/commandsModule.ts` |
| `getSopClassHandlerModule` | `[{ name, sopClassUids, getDisplaySetsFromSeries }]` | `extensions/dicom-pdf/src/getSopClassHandlerModule.js` |
| `getHangingProtocolModule` | `[{ name, protocol }]` | `extensions/default/src/getHangingProtocolModule.js` |
| `getLayoutTemplateModule` | `[{ name, id, component }]` | `extensions/default/src/getLayoutTemplateModule.js` |
| `getDataSourcesModule` | `[{ name, type, createDataSource }]` | `extensions/default/src/getDataSourcesModule.js` |
| `getCustomizationModule` | `[{ name, value }]` — `name: 'default'` registers at default scope | `extensions/default/src/getCustomizationModule.tsx` |
| `getUtilityModule` | `[{ name, exports }]` — plain functions shared across extensions | `extensions/default/src/index.ts` (the `common` entry) |

## Lifecycle

| Hook | When | Use for |
|---|---|---|
| `preRegistration({ servicesManager, commandsManager, configuration })` | Once, before any module is read | Registering services, initializing libraries (`initCornerstoneTools`), one-time setup |
| `onModeEnter({ servicesManager, extensionManager, commandsManager })` | Each time a mode using this extension is entered | Subscriptions, tool group setup |
| `onModeExit(...)` | On leaving the mode | **Clear every store, unsubscribe everything, free retained memory** |

`extensions/default/src/index.ts` is the model for `onModeExit`: it clears each Zustand store and releases
retained Blobs. An extension that adds state and does not clear it here leaks across mode switches.

## Which extension is canonical for what

| Concern | Extension |
|---|---|
| Data sources, study browser, layout template, context menu, most default UI | `default/` |
| Rendering, tools, tool groups, sync groups, segmentation, viewport services | `cornerstone/` |
| Smallest end-to-end example of a complete extension | `dicom-pdf/` |
| SOP-class-specific viewport + handler pair | `dicom-video/`, `dicom-pdf/` |
| Segmentation (labelmap) | `cornerstone-dicom-seg/` |
| Segmentation (contour / RTSTRUCT) | `cornerstone-dicom-rt/` |
| Structured reports | `cornerstone-dicom-sr/` |
| Parametric maps | `cornerstone-dicom-pmap/` |
| 4D / dynamic volumes | `cornerstone-dynamic-volume/` |
| Whole-slide imaging | `dicom-microscopy/` |
| PET/CT fusion, TMTV workflow | `tmtv/` |
| Measurement tracking prompts and tracked panels | `measurement-tracking/` |

## Directory vs package name

Never infer the package name from the directory. Known mismatches:

| Directory | Package |
|---|---|
| `extensions/usAnnotation/` | `@ohif/extension-ultrasound-pleura-bline` |
| `extensions/test-extension/` | `@ohif/extension-test` |
| `modes/basic-test-mode/` | `@ohif/mode-test` |
| `modes/usAnnotation/` | `@ohif/mode-ultrasound-pleura-bline` |
| `platform/app/` | `@ohif/app` (not `@ohif/viewer`) |
| `platform/docs/` | `ohif-docs` |
