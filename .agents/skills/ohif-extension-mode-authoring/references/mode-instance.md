# The mode instance

A mode is built from `@ohif/mode-basic` by spreading and overriding. This file covers the properties you will
actually change and the traps in each. The authoritative source is
[modes/basic/src/index.tsx](../../../../modes/basic/src/index.tsx) — read it when a property here is not enough.

## Shape

```
mode (default export)
├── id
├── extensionDependencies      # which extensions must load
└── modeInstance
    ├── routeName              # URL segment — see the ALLOWED_MODE_ROUTES trap
    ├── displayName
    ├── routes: [ { path, layoutTemplate, layoutInstance } ]
    ├── extensions
    ├── sopClassHandlers       # ORDER MATTERS
    ├── hangingProtocol
    ├── toolbarButtons / toolbarSections / toolGroupAdditions
    ├── initToolGroups
    ├── modeCustomizations
    ├── activatePanelTriggers
    ├── isValidMode + modeModalities / nonModeModalities / excludedModalities / excludedStudies
    └── onModeEnter / onModeExit
```

## Layout

`layoutInstance.props` is where panels and viewports are declared:

```ts
props: {
  leftPanels: [ohif.thumbnailList],
  rightPanels: [cornerstone.segmentation, cornerstone.measurements],
  leftPanelResizable: true,
  rightPanelClosed: true,
  rightPanelResizable: true,
  viewports: [
    { namespace: cornerstone.viewport, displaySetsToDisplay: [ohif.sopClassHandler, ...] },
  ],
}
```

`viewports` maps a viewport component to the display sets it can render. A display set whose SOP class handler
is not in any entry's `displaySetsToDisplay` **will not render anywhere** — this is the most common cause of a
blank viewport after adding a new SOP class handler.

The mode route seeds `leftPanels` / `rightPanels` into the standard customizations, so `?customization=` modules
and global customizations can modify them. Declare them as literal lists; do not compute them.

`layoutTemplate` is a function returning `structuredCloneWithFunctions(this.layoutInstance)` — inherit it from
basic rather than reimplementing it.

## `sopClassHandlers` — order matters

Handlers are tried in array order and **more general handlers must come last**. In `modes/basic`,
`dicomvideo.sopClassHandler` is first specifically so video transfer syntaxes are claimed before the generic
image handler sees them. Appending a broad handler to the front will silently steal series from specific
handlers.

## Mode validity

`isValidMode` is data-driven; you supply the data, not the logic:

| Property | Meaning |
|---|---|
| `excludedStudies` | `[{ attribute: value }]` — a study matching *every* attribute of any entry is invalid |
| `excludedModalities` | invalid if the study contains **any** of these |
| `modeModalities` | valid if the study contains at least one entry; a nested array requires **all** of its modalities (`[['PT','CT']]` needs both) |
| `nonModeModalities` | fallback — valid if the study has at least one modality **not** in this list |

`NON_IMAGE_MODALITIES` (`['SEG','RTSTRUCT','RTPLAN','PR','SR']`) is exported by `@ohif/mode-basic` and is the
usual `nonModeModalities` value.

## Toolbar and tool groups

`toolbarButtons` and `toolbarSections` use `{ $reference: '...' }` markers that the customization service
expands at read time — e.g. `[{ $reference: 'cornerstone.toolbarButtons' }]`. This is what lets a
`?customization=` module extend the toolbar without the mode restating it. Keep the reference form; do not
inline the expanded value.

`toolGroupAdditions` layers extra tools onto the groups created by `initToolGroups`, keyed by group name
(`default`, `mpr`, `SRToolGroup`, `volume3d`).

`initToolGroups` is a **mode instance property**, so an extending mode can substitute its own without touching
`onModeEnter`.

## Lifecycle

`onModeEnter` (from basic) clears measurements, calls `this.initToolGroups?.(...)`, registers the toolbar from
the resolved customizations, applies `toolGroupAdditions`, and wires `activatePanelTriggers`. It tracks
subscriptions on `this._unsubscriptions`.

**If your mode overrides `onModeEnter`, call the basic one and push your own unsubscribe functions onto
`this._unsubscriptions`** — the shared `onModeExit` is what cleans them up, along with destroying
`toolGroupService`, `syncGroupService`, `segmentationService` and `cornerstoneViewportService`.

`activatePanelTriggers` is empty by default so the UI state the user left is respected.
`defaultActivatePanelTriggers` is exported if you want the "open the segmentation panel when a segmentation is
added" behaviour.

## Customizations

`modeCustomizations` names a block registered at default scope via the mode's `customizations` export. The mode
route applies it as the **bottom** layer of the mode scope, so app config, `?customization=` modules, and global
customizations all override it by scope precedence and application order. Registered values are plain data —
`$` commands belong only in the customizations that *modify* them, never in the registered value.

`modeFactory` applies `modeConfiguration` onto `modeInstance` with `immutability-helper`, which is why `$push`
/ `$set` syntax works in mode configuration.

## This fork: the `routeName` trap

[platform/app/src/routes/index.tsx](../../../../platform/app/src/routes/index.tsx) sets
`ALLOWED_MODE_ROUTES = ['viewer', 'microscopy']`. Any other `routeName` renders the Healthray notice instead of
the mode, no matter how correctly the mode is written.

`modes/longitudinal` sets `routeName: 'viewer'` even though its route `path` is `longitudinal` — that is the
pattern to copy. If a genuinely new route name is required, add it to `ALLOWED_MODE_ROUTES` deliberately and
call the change out.
