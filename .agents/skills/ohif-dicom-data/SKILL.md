---
name: ohif-dicom-data
description: Work on how DICOM data enters OHIF — the /home?url= local-file load path, file format detection, data sources (DICOMweb, DICOM JSON, local, proxy, merge), SOP class handlers and display set creation, and DicomMetadataStore. Use this skill when a study or series fails to load, a file "isn't recognized" or loads as the wrong type, a URL returns nothing, a new modality or SOP class needs supporting, DICOMweb/PACS endpoints or app configs are being changed, or the user asks about zip vs single .dcm vs PDF handling, filesToStudies, fileLoaderService, wadouri, or study/series metadata. Distinct from viewport rendering — use ohif-viewport-debug once the study has loaded but does not display.
---

# OHIF DICOM Data & Loading

This skill covers everything **up to** a display set existing. Once display sets exist and the problem is that
they do not render, switch to the **`ohif-viewport-debug`** skill.

## Two ways data enters

| Path | Used by | Entry point |
|---|---|---|
| **Local file over HTTP** | This fork's `/home` route — the primary path | `platform/app/src/routes/Local/Local.tsx` |
| **Data source** | DICOMweb / PACS, JSON manifests | `extensions/default/src/getDataSourcesModule.js` |

Both converge on `DicomMetadataStore`, then `DisplaySetService`.

---

## The `/home` load path (this fork)

```
/home?url=<file-url>[&fileType=zip|dcm|pdf]
   │
   ▼ getBlobByURL         throws on !response.ok  ← stops S3 XML / HTML 404 bodies
   │                        reaching the parsers as a bogus "format error"
   ▼ first 132 bytes → detectFormat()             ← magic bytes, NOT ?fileType=
   │
   ├── zip → JSZip → unZip (recursive, handles nested zips)
   │            → File[] typed 'application/dicom'
   │
   └── dcm/pdf → one File typed mimeTypeForFormat(detected)
   │
   ▼ filesToStudies(files)
   ▼ FileLoaderService per file → DICOMFileLoader | PDFFileLoader
   ▼ dicomImageLoader.wadouri.fileManager.add(file) → loadFile → getDataset
   ▼ DicomMetadataStore.addInstance(dataset)
   ▼ returns DicomMetadataStore.getStudyInstanceUIDs()
```

### Format detection beats the query parameter

[detectFileFormat.ts](../../../platform/app/src/routes/Local/detectFileFormat.ts) reads `HEADER_BYTES` (132)
and matches: zip signatures (`PK\x03\x04`, `PK\x05\x06`, `PK\x07\x08`) at offset 0, `%PDF` at offset 0, and
`DICM` at offset **128** (after the DICOM Part 10 preamble).

**Detection wins over `?fileType=`.** A contradiction logs a warning and the detected format is used. This
exists because the route used to default to `zip`, so a URL pointing at a single DICOM file was fed to JSZip
and failed. When `detectFormat` returns `null` (unrecognised bytes), the code falls back to `?fileType=` and
then to `dcm` — which is what a valid DICOM lacking the 128-byte preamble needs.

The functions are pure over a `Uint8Array` with no Blob/File/DOM dependency, so they are unit-testable —
[detectFileFormat.test.ts](../../../platform/app/src/routes/Local/detectFileFormat.test.ts) is where format
changes get covered. **Add a case there before changing detection.**

### Why the file is re-wrapped

`FileLoaderService.getLoader` dispatches purely on `file.type`:

```js
if (fileType === 'application/pdf') { return PDFFileLoader; }
else { return DICOMFileLoader; }   // default
```

That is why `Local.tsx` wraps the blob in a `new File([blob], name, { type: mimeTypeForFormat(detected) })`
rather than passing the blob through — the server's `Content-Type` is not trusted. If you change how files are
constructed, preserve this.

### The silent-failure trap

`processFile` in [filesToStudies.js](../../../platform/app/src/routes/Local/filesToStudies.js) catches every
per-file error and only `console.log`s it. One corrupt file in a zip does **not** fail the load — it silently
does not appear. When a series is "missing", check the browser console for these logs before anything else.

---

## Data sources

Registered by `getDataSourcesModule` in `extensions/default/src/`:

| Name | Type | Directory |
|---|---|---|
| `dicomweb` | `webApi` | `DicomWebDataSource/` |
| `dicomwebproxy` | `webApi` | `DicomWebProxyDataSource/` |
| `dicomjson` | `jsonApi` | `DicomJSONDataSource/` |
| `dicomlocal` | `localApi` | `DicomLocalDataSource/` |
| `merge` | `mergeApi` | `MergeDataSource/` |

The interface they implement is `platform/core/src/DataSources/IWebApiDataSource.js`. Which one is active comes
from the app config's `dataSources` / `defaultDataSourceName` — configs live in
[platform/app/public/config/](../../../platform/app/public/config/) and are chosen with the `APP_CONFIG`
environment variable (`pnpm run dev:orthanc`, `dev:dcm4chee`, `dev:static` each select one).

Reach the active source at runtime with `extensionManager.getActiveDataSource()[0]`.

See [references/data-and-sopclass.md](references/data-and-sopclass.md) for the data source surface, the
`retrieve.directURL` / `retrieve.renderedURL` pattern, and adding a source.

---

## SOP class handlers and display sets

A SOP class handler turns a series into one or more display sets. Without a matching handler a series produces
**no display set at all** — it is absent from the panel rather than blank in a viewport.

```js
{ name: 'dicom-pdf', sopClassUids, getDisplaySetsFromSeries }
```

`extensions/dicom-pdf/src/getSopClassHandlerModule.js` is the smallest complete example.

**Three things must line up** — miss any one and the data silently does not appear:

1. The handler is exported from the extension's `getSopClassHandlerModule`.
2. The handler id is in the mode's `sopClassHandlers` array — **order matters, general handlers last**.
3. The handler id is in some `viewports[].displaySetsToDisplay` in the mode's `layoutInstance.props`.

Details and the display set contract are in
[references/data-and-sopclass.md](references/data-and-sopclass.md).

---

## DicomMetadataStore

The in-memory store of study/series/instance metadata. `DicomMetadataStore.addInstance(naturalizedDataset)` is
what every path ultimately calls; `getStudyInstanceUIDs()` is what `filesToStudies` returns.

In this fork the store is also **an access control gate**: viewer routes are gated on it being populated, and
only `/home` populates it. See [platform/app/src/routes/index.tsx](../../../platform/app/src/routes/index.tsx).
Consequences:

- The viewer cannot be deep-linked or refreshed into. That is intentional, not a bug.
- To reproduce any data problem you must go through `/home?url=<file-url>`.
- `dicomlocal.getStudyInstanceUIDs()` returns `[]` against a cold store, which is what makes `Mode.tsx` skip its
  redirect and render nothing.

---

## Debugging checklist

1. **Did the fetch succeed?** Network tab. `getBlobByURL` throws on non-2xx precisely so an error body is not
   misreported as a format problem. CORS failures show here.
2. **What format was detected?** Console — a mismatch with `?fileType=` is logged as a warning, and an
   unrecognised header is logged too.
3. **Did any file fail to parse?** Console — `processFile` logs and swallows per-file errors.
4. **Is anything in the store?** `window.services` is available; check display sets:
   ```js
   window.services.displaySetService.getActiveDisplaySets()
     .map(ds => ({ modality: ds.Modality, handler: ds.SOPClassHandlerId }));
   ```
5. **Empty display sets but data in the store?** No SOP class handler matched — check the mode's
   `sopClassHandlers`.
6. **Display sets exist but nothing renders?** Stop here and use the **`ohif-viewport-debug`** skill.

---

## Rules

1. Detection from magic bytes wins over `?fileType=`; do not reintroduce trust in the query parameter or the
   server `Content-Type`.
2. Keep `getBlobByURL`'s `response.ok` check — without it, error pages reach the parsers as format errors.
3. Preserve the `File` re-wrap with `mimeTypeForFormat`; `FileLoaderService` dispatches on `file.type` alone.
4. Add a case to `detectFileFormat.test.ts` when changing format detection.
5. Per-file errors in `filesToStudies` are swallowed by design — check the console before assuming a data
   source problem.
6. A new SOP class handler needs all three registrations: the module, the mode's `sopClassHandlers`, and a
   `displaySetsToDisplay` entry.
7. `sopClassHandlers` order matters — general handlers last.
8. Reproduce through `/home?url=...`; the viewer cannot be deep-linked in this fork.
9. Implement changes in extensions or the app route, never `platform/core`.

## Pre-output self-check

1. The stage that failed is named — fetch, detection, parse, store, or display set creation.
2. Format detection changes come with a `detectFileFormat.test.ts` case.
3. A new SOP class handler is registered in all three places.
4. `response.ok`, the `File` re-wrap, and detection-over-`?fileType=` precedence are all still intact.
5. Nothing under `platform/core/` was modified, or the reason is stated.
6. If the app was not run, that is stated plainly with a concrete `/home?url=...` reproduction command.
