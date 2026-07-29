# Data sources and SOP class handlers

**Stable rules, not an API listing.** For a current signature, open the source —
[platform/core/src/DataSources/IWebApiDataSource.js](../../../../platform/core/src/DataSources/IWebApiDataSource.js)
and the implementations under [extensions/default/src/](../../../../extensions/default/src/) are authoritative.

---

## The data source interface

`IWebApiDataSource.create({...})` adapts any HTTP-backed source to one interface so they are interchangeable.
A single implementation may back "read" and "write" with different underlying servers.

| Key | Purpose |
|---|---|
| `initialize` | Called once; resolves study/series lists for the route |
| `query.studies` / `query.series` / `query.instances` | Search. `query.studies` has the `mapParams` → `requestResults` → `processResults` triple |
| `retrieve` | Fetching metadata and pixel data; also `retrieve.directURL` / `retrieve.renderedURL` |
| `store.dicom` | Write. Throws "not implemented" by default — a source is read-only unless it supplies this |
| `reject` | Rejection/deletion operations |
| `getImageIdsForDisplaySet` / `getImageIdsForInstance` | Map display sets and instances to Cornerstone imageIds |
| `getStudyInstanceUIDs` | Which studies this source currently knows about |
| `getConfig` | Feature flags; defaults to `{ dicomUploadEnabled: false }` |
| `deleteStudyMetadataPromise` | Cache cleanup |

Every key has a default, so a partial implementation is valid — but the defaults are mostly no-ops, and a
no-op `query.studies.requestResults` returns nothing without erroring. **A "data source returns nothing" bug is
often an unimplemented key, not a failed request.**

### `retrieve.directURL` and `retrieve.renderedURL`

The pattern for non-image encapsulated data (PDF, video). From
`extensions/dicom-pdf/src/getSopClassHandlerModule.js`:

```js
const dataSource = extensionManager.getActiveDataSource()[0];
const renderedUrlParams = {
  instance,
  tag: 'EncapsulatedDocument',
  defaultType: MIMETypeOfEncapsulatedDocument || 'application/pdf',
  singlepart: 'pdf',
};
const renderedUrl = dataSource.retrieve.directURL(renderedUrlParams);
const getRenderedUrl = dataSource.retrieve.renderedURL
  ? options => dataSource.retrieve.renderedURL({ ...renderedUrlParams, url: renderedUrl }, options)
  : undefined;
```

`renderedURL` is **optional** — guard on it, as above. Not every source provides server-side rendering.

### Choosing the active source

App configs in [platform/app/public/config/](../../../../platform/app/public/config/) declare `dataSources` and
`defaultDataSourceName`; `APP_CONFIG` selects the file. `pnpm run dev:orthanc`, `dev:dcm4chee` and `dev:static`
each set it. At runtime: `extensionManager.getActiveDataSource()[0]`.

### Adding a data source

1. Implement a `createXApi` factory returning `IWebApiDataSource.create({...})`.
2. Add `{ name, type, createDataSource }` to a `getDataSourcesModule`.
3. Reference the name from an app config's `dataSources`.

`MergeDataSource` composes several sources behind one name — read it before building anything that needs two
back ends.

---

## SOP class handlers

A handler claims SOP class UIDs and converts a series into display sets.

```js
{
  name: 'dicom-pdf',                 // → @ohif/extension-dicom-pdf.sopClassHandlerModule.dicom-pdf
  sopClassUids,                      // array of SOP class UID strings
  getDisplaySetsFromSeries,          // (instances, servicesManager, extensionManager) => displaySet[]
}
```

The id string is built in `id.js` from the package name:

```js
const SOPClassHandlerId = `${id}.sopClassHandlerModule.dicom-pdf`;
```

Never hardcode it — the mode references this exact string, and a mismatch fails silently.

### The display set contract

`getDisplaySetsFromSeries` returns objects carrying at minimum the identity and grouping fields the rest of the
pipeline reads: `displaySetInstanceUID`, `SeriesInstanceUID`, `StudyInstanceUID`, `SOPInstanceUID`,
`SOPClassHandlerId`, `Modality`, `SeriesNumber`, `SeriesDate`, `SeriesDescription`, plus whatever the matching
viewport needs. Read a working handler and mirror its shape rather than assembling one from this list —
`dicom-pdf` for the simplest, `extensions/default/src/getSopClassHandlerModule.js` for the general image case.

`extensions/default/src/getDisplaySetsFromUnsupportedSeries.js` is the catch-all. **A series landing there means
no specific handler matched** — a fast way to confirm a registration problem.

### Three registrations, all required

| # | Where | Consequence if missed |
|---|---|---|
| 1 | Exported from the extension's `getSopClassHandlerModule` | Handler does not exist |
| 2 | In the mode's `sopClassHandlers` array | Series never reaches the handler; falls to unsupported |
| 3 | In some `viewports[].displaySetsToDisplay` in the mode's `layoutInstance.props` | Display set exists but renders nowhere — blank pane |

All three fail **silently**. When a new modality "doesn't show up", check them in this order.

### Order matters

Handlers are tried in `sopClassHandlers` array order and **more general handlers must come last**. In
`modes/basic`, `dicomvideo.sopClassHandler` is first so video transfer syntaxes are claimed before the generic
image handler sees them. Prepending a broad handler silently steals series from specific ones.

---

## The local file loaders

Used by the `/home` path, in `platform/app/src/routes/Local/`:

| File | Role |
|---|---|
| `fileLoaderService.js` | Picks a loader from `file.type` — `application/pdf` → PDF, everything else → DICOM |
| `dicomFileLoader.js` | `wadouri` load + naturalized dataset extraction |
| `pdfFileLoader.js` | PDF handling |
| `fileLoader.js` | Shared base class |
| `filesToStudies.js` | Fans files out, adds each to `DicomMetadataStore`, returns study UIDs |

Two behaviours to preserve:

- **Dispatch is on `file.type` only.** Nothing sniffs content at this layer, which is why `Local.tsx` sets the
  MIME type from `detectFormat` rather than the server's `Content-Type`.
- **`processFile` swallows per-file errors** with a `console.log`. One bad file in a zip is skipped, not fatal.
  This is deliberate, and it is why the browser console is the first place to look for a missing series.
