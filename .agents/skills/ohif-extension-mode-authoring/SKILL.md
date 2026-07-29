---
name: ohif-extension-mode-authoring
description: Author or modify OHIF extensions and modes — create a new extension, add a viewport/panel/toolbar/command/customization module to an existing one, register it in pluginConfig.json, or build a mode by composing @ohif/mode-basic. Use this skill whenever work touches extensions/*, modes/*, pluginConfig.json, a get*Module function, a commandsModule, a layoutTemplate, a hanging protocol registration, or when the user asks to "add a tool/panel/button/viewport", "make a new extension or mode", or "change what panels a mode shows". Also use it when a change is tempting to make in platform/core — this skill covers how to do it from an extension instead.
---

# OHIF Extension & Mode Authoring

Extensions supply capabilities. Modes compose those capabilities into a workflow. Almost every feature request
in this repo is one or the other — and almost none of them require touching `platform/core`.

## The first rule

**Never modify `platform/core`.** Implement the feature via an extension or a mode. Core is a last resort, only
when every other approach fails or there is a genuine architectural constraint — and when you do it, say so
explicitly and explain why the extension path was impossible.

The escape hatches that make this achievable, in the order you should try them:

1. **Customization** — `getCustomizationModule` overrides a value the app already reads (panel lists, toolbar
   sections, context menus, most UI text and behaviour switches).
2. **Command** — `getCommandsModule` adds behaviour any toolbar button, hotkey, or other command can invoke.
3. **New module** — a viewport, panel, or toolbar entry contributed by your extension.
4. **Component override** — put a replacement in your extension's `components/` and import it instead of the
   `ui-next` original.
5. **Mode composition** — change what the workflow wires together without changing any extension.

## Workflow

1. **Decide extension or mode.** New *capability* (a tool, viewport, panel, data source, SOP class handler) →
   extension. New or changed *workflow* (which panels, which viewports, which tools appear together) → mode. If
   the capability already exists and you only need it arranged differently, it is a mode change — do not write
   an extension.
2. **Find the closest existing example and read it end to end.** This is the highest-value step. See the table
   in [references/module-map.md](references/module-map.md) for which extension is canonical for each module
   type. `extensions/dicom-pdf/` is the smallest complete extension; `extensions/default/` is the widest.
3. **Check the package name.** Directory names and package names differ (`extensions/usAnnotation/` is
   `@ohif/extension-ultrasound-pleura-bline`, `extensions/test-extension/` is `@ohif/extension-test`,
   `modes/basic-test-mode/` is `@ohif/mode-test`). Read `package.json`; never infer.
4. **Write the code**, following the structure below.
5. **Register it** — extensions in [platform/app/pluginConfig.json](../../../platform/app/pluginConfig.json),
   modes in their own `package.json` plus the mode's `extensionDependencies`.
6. **Restart the dev server.** `pluginImports.js` is generated at build time by
   `platform/app/.webpack/writePluginImportsFile.js`. A new extension or mode is **not** picked up by hot
   reload — you must restart `pnpm run dev`.
7. **Verify in the app**, not just by reading. See "Verifying" below.

## Extension anatomy

An extension is a plain object whose only required property is `id`. Everything else is optional.

```
extensions/<name>/
├── package.json          # name: @ohif/extension-<name>
└── src/
    ├── id.js             # derives id from package.json — do not hardcode
    ├── index.tsx         # the extension object, default-exported
    ├── get*Module.tsx    # one file per module type
    ├── commandsModule.ts
    ├── components/       # React components, incl. ui-next overrides
    ├── hooks/            # usePatientInfo.tsx is the model
    ├── stores/           # Zustand; useLutPresentationStore.ts is the model
    ├── utils/            # formatPN.ts is the model
    └── synchronizers/    # frameViewSynchronizer.ts is the model
```

`id.js` always derives from the package name, and exports one id per module the extension contributes:

```js
import packageJson from '../package.json';

const id = packageJson.name;
const SOPClassHandlerId = `${id}.sopClassHandlerModule.dicom-pdf`;

export { id, SOPClassHandlerId };
```

The module functions an extension may export — the full surface is visible in
[extensions/default/src/index.ts](../../../extensions/default/src/index.ts):

`preRegistration`, `onModeEnter`, `onModeExit`, `getDataSourcesModule`, `getViewportModule`,
`getLayoutTemplateModule`, `getPanelModule`, `getHangingProtocolModule`, `getSopClassHandlerModule`,
`getToolbarModule`, `getCommandsModule`, `getUtilityModule`, `getCustomizationModule`.

Each returns an **array of `{ name, ... }` entries**, and each entry becomes addressable as
`<packageName>.<moduleType>.<name>` — the string modes use to reference it. See
[references/module-map.md](references/module-map.md) for the naming rules and what each module returns.

### Lazy-load viewport components

Viewports are heavy. Follow `extensions/dicom-pdf/src/index.tsx`:

```tsx
const Component = React.lazy(() => import(/* webpackPrefetch: true */ './viewports/MyViewport'));

const MyViewport = props => (
  <React.Suspense fallback={<div>Loading...</div>}>
    <Component {...props} />
  </React.Suspense>
);
```

### Clean up in `onModeExit`

Anything an extension accumulates during a session must be released. `extensions/default/src/index.ts` clears
every one of its Zustand stores and frees retained Blobs there. If you add a store, clear it in `onModeExit`.

## Mode anatomy

Modes compose. **Do not write a mode from scratch** — spread `@ohif/mode-basic` and override only what changes.
[modes/longitudinal/src/index.ts](../../../modes/longitudinal/src/index.ts) is the model and is short enough to
read in full.

```ts
import { basicLayout, basicRoute, mode as basicMode, modeInstance as basicModeInstance,
         extensionDependencies as basicDependencies, ohif, cornerstone } from '@ohif/mode-basic';

export const extensionDependencies = {
  ...basicDependencies,
  '@ohif/extension-measurement-tracking': '^3.0.0',
};

export const myInstance = {
  ...basicLayout,
  id: ohif.layout,
  props: { ...basicLayout.props, leftPanels: [...], rightPanels: [...], viewports: [...] },
};

export const myRoute = { ...basicRoute, path: 'my-mode', layoutInstance: myInstance };

export const modeInstance = { ...basicModeInstance, id, routeName: 'viewer', routes: [myRoute],
                              extensions: extensionDependencies };

export default { ...basicMode, id, modeInstance, extensionDependencies };
```

`@ohif/mode-basic` exports namespaced id constants (`ohif`, `cornerstone`, `dicomsr`, `dicomSeg`, `dicomRT`,
`dicompdf`, `dicomvideo`, `dicomPmap`, `dicomecg`) so you reference modules by constant rather than by
hand-typed string. Use them — a typo'd module string fails silently by rendering nothing.

Key `modeInstance` properties are documented in [references/mode-instance.md](references/mode-instance.md):
`routes`, `extensions`, `sopClassHandlers` (**order matters**), `hangingProtocol`, `toolbarButtons`,
`toolbarSections`, `toolGroupAdditions`, `initToolGroups`, `modeCustomizations`, `activatePanelTriggers`,
`isValidMode` / `modeModalities` / `nonModeModalities` / `excludedModalities`, and the `onModeEnter` /
`onModeExit` lifecycle.

## Registration

**Extension** — add to [platform/app/pluginConfig.json](../../../platform/app/pluginConfig.json):

```json
{ "packageName": "@ohif/extension-my-thing", "default": false, "version": "3.0.0" }
```

`default: false` means "available but not loaded unless a mode depends on it". Only `@ohif/extension-default`
omits it.

**Mode** — declare its extensions in `extensionDependencies` and add the mode to `pluginConfig.json`'s `modes`
array. A mode's dependencies are what actually causes those extensions to load.

Both require a dev-server restart.

## Where code goes

| What | Where | Model to copy |
|---|---|---|
| Tool | `extensions/cornerstone/src/tools/` | register in `toolNames.ts`, expose via `getToolbarModule.tsx`, map in `measurementServiceMappings/` |
| Zustand store | extension's `stores/` | `useLutPresentationStore.ts`, `useSynchronizersStore.ts` |
| Hook | extension's `hooks/` | `usePatientInfo.tsx` |
| Provider / context | extension's `providers/` or `contexts/` | `ViewportGridProvider.tsx` |
| Synchronizer | extension's `synchronizers/` | `frameViewSynchronizer.ts` |
| Utility | extension's `utils/` | `formatPN.ts` |
| Icon | `icons/`, then register | `import { addIcon } from '@ohif/extension-default/src/utils'` |
| Command | extension's `commandsModule.ts` | `extensions/cornerstone/src/commandsModule.ts` |
| Hanging protocol | extension's `hps/` | `extensions/cornerstone/src/hps/` |

## Services

Access via destructuring; register your own from `preRegistration`.

```ts
const { displaySetService, measurementService, customizationService } = servicesManager.services;
```

**Prefer a service subscription over `useEffect`-derived state**, and always return the cleanup:

```ts
useEffect(() => {
  const subscriptions = [
    cornerstoneViewportService.subscribe(EVENTS.VIEWPORT_DATA_CHANGED, handleViewportDataChanged),
  ];
  return () => subscriptions.forEach(({ unsubscribe }) => unsubscribe());
}, []);
```

## This fork

Only `viewer` and `microscopy` mode routes are reachable — `ALLOWED_MODE_ROUTES` in
[platform/app/src/routes/index.tsx](../../../platform/app/src/routes/index.tsx). **A new mode with any other
`routeName` will render the Healthray notice instead of your mode.** Either name the route `viewer`, as
`modes/longitudinal` does, or add it to `ALLOWED_MODE_ROUTES` deliberately and say that you did.

Viewer routes are also gated on `DicomMetadataStore` being populated, which only `/home` does — you cannot
deep-link a mode route to test it. Load through `/home?url=...` first.

## Verifying

Static reading is not enough; module-id typos fail silently.

1. Restart `pnpm run dev` (required — `pluginImports.js` is generated at build time).
2. Load a study through `/home?url=<file-url>`.
3. Confirm the module actually appears — the panel renders, the button is in the toolbar, the viewport is
   selected for its SOP class.
4. `pnpm run test:unit` for any logic you added under `platform/*` or `extensions/*`.
5. For UI behaviour, add a Playwright spec — use the **`ohif-test-agent`** skill, do not hand-roll one.

## Rules

1. Never modify `platform/core`. Use customization → command → new module → component override → mode
   composition, in that order.
2. Read the closest existing extension or mode end to end before writing.
3. Derive `id` from `package.json` in `id.js`; never hardcode a package name.
4. Reference modules through the `@ohif/mode-basic` id constants, not hand-typed strings.
5. Compose modes by spreading `@ohif/mode-basic`; never write one from scratch.
6. Register extensions in `pluginConfig.json` and modes in their `extensionDependencies`, then restart the dev
   server.
7. Lazy-load viewport components with `React.lazy` + `Suspense`.
8. Clear any store you add in `onModeExit`.
9. Subscribe to services rather than deriving state in `useEffect`; always return the unsubscribe cleanup.
10. `sopClassHandlers` order matters — more general handlers come last.
11. Check `package.json` for the real package name; directory names lie.
12. A new mode route must be `viewer`/`microscopy` or explicitly added to `ALLOWED_MODE_ROUTES`.

## Pre-output self-check

Before returning an extension or mode change, confirm:

1. Nothing under `platform/core/` was modified — or the reason it was unavoidable is stated explicitly.
2. `id` is derived from `package.json`, and every module id string is built from it.
3. The extension is in `pluginConfig.json`, and the mode lists it in `extensionDependencies`.
4. Module references use the `@ohif/mode-basic` constants where one exists.
5. Every new store is cleared in `onModeExit`; every subscription returns an unsubscribe.
6. Viewport components are lazy-loaded.
7. A new mode's `routeName` is reachable under `ALLOWED_MODE_ROUTES`.
8. The dev-server restart requirement is stated to the user, with the exact command.
9. If it was not run, that is stated plainly along with what to run to verify.
