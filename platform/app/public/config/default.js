/** @type {AppTypes.Config} */

// Secure, minimal default configuration.
//
// This is what a plain production build with no APP_CONFIG produces, so it is
// deliberately locked down:
//   - The runtime `?url=` metadata sources (`dicomjson`, `dicomwebproxy`) are
//     NOT enabled — they widen the attack surface of a default deployment.
//   - The local file data source (`dicomlocal`) IS enabled: the `/home` route
//     needs it to display DICOM files it fetched and unzipped in the browser.
//   - `?customization=` URL loading is OFF: no `customizationUrlPrefixes` are
//     configured, so any `?customization=` value is rejected (and aborts boot
//     rather than silently loading).
//   - `dangerouslyUseDynamicConfig` (the `configUrl` query parameter) is off.
//
// It does not need to "just work" untouched — point the data source below at
// your own DICOMweb server. For a fully-featured setup with every data source
// and customization loading enabled, see config/dev.js (local development) and
// config/netlify.js (the public demo deploy).
window.config = {
  name: 'config/default.js',
  routerBasename: null,
  // whiteLabeling: {},
  extensions: [],
  modes: [],
  customizationService: {},

  // --- URL-driven customizations (?customization=) ----------------------------
  // OFF by default. To allow loading customization data files from the URL, set
  // `customizationUrlPrefixes` to a map of allowed prefixes. The `default` prefix
  // (no slashes) is used for values with no leading slash; every other prefix
  // must start AND end with a slash and is matched against the leading
  // `/segment/` of the value. Files are fetched and parsed as JSONC data — they
  // are never executed. Example (left disabled here on purpose):
  //
  // customizationUrlPrefixes: {
  //   default: './customizations/',                       // ?customization=tools/ctPresets
  //   '/remote/': 'https://cdn.example.com/ohif-custom/', // ?customization=/remote/siteA
  // },
  // ----------------------------------------------------------------------------

  // --- Native ("next") Generic Viewport --------------------------------------
  // OFF by default. Set `enabled: true` (or pass ?useNextViewports=true in the
  // URL) to drive viewports through cornerstone's native GenericViewport
  // ("next") API instead of the legacy Stack/Volume viewport classes.
  genericViewports: {
    enabled: false,
    // Render backend selection: 'cpu' | 'webgl' | 'auto' | a backend id
    // registered via cornerstone's registerRenderBackend (e.g. a webgpu
    // backend), or a map with per-viewport-type overrides, e.g.
    // { default: 'webgl', orthographic: 'cpu' }. The matching URL params take
    // precedence per-session: ?viewportRendering=cpu and
    // ?orthographic.viewportRendering=cpu.
    // viewportRendering: 'auto',
  },
  // ----------------------------------------------------------------------------
  // --- Intended-use notice -----------------------------------------------------
  // Rendered persistently in the viewer by `ClinicalUseNotice`. Set to a string
  // to override the wording, or to null to suppress it entirely.
  //
  // TODO(legal): the default wording is a PLACEHOLDER pending review. This
  // deployment is positioned as informational viewing only and is NOT cleared
  // or certified as a medical device, so a visible statement to that effect is
  // what keeps that position defensible. Do not suppress it without a
  // documented regulatory decision.
  //
  // clinicalUseNotice: 'Not for diagnostic use. For informational purposes only.',
  //
  // OHIF's own banner is suppressed below: it reads "OHIF Viewer is for
  // investigational use only" and links to ohif.org, which is the wrong brand
  // for this product and a different regulatory claim ("investigational use"
  // is a clinical-trial term, not a diagnostic-use disclaimer). The notice
  // above replaces it.
  investigationalUseDialog: {
    option: 'never',
  },
  // ----------------------------------------------------------------------------

  // --- Origins the `/home` route may fetch imaging from -----------------------
  // The `/home?url=` route fetches a DICOM zip / .dcm / PDF from a URL supplied
  // in the query string. That parameter is attacker-controllable, so the origin
  // is checked against this list before any request is made. The viewer's own
  // origin is always permitted and does not need listing.
  //
  // Entries must be bare origins — scheme + host + optional port, no path,
  // query, fragment or credentials. Anything else is ignored with a console
  // error rather than being silently widened.
  //
  // This is empty by default, which means the viewer will only load
  // same-origin files. A deployment serving signed URLs from object storage
  // MUST add that origin here or every load will be blocked:
  //
  //   allowedLocalFileOrigins: ['https://media.example.com'],
  //
  // Keep it as narrow as possible: this list is what stops `?url=` being
  // pointed at an arbitrary host.
  // Local dev origins belong in config/dev.js, not here: in production a
  // crafted `?url=http://localhost:.../` would make a *user's own browser*
  // probe their machine.
  allowedLocalFileOrigins: [
    'https://healthray-lab.s3.ap-south-1.amazonaws.com',
    'https://healthray-dicom.s3.ap-south-1.amazonaws.com',
    'https://stage-dicoms.s3.ap-south-1.amazonaws.com',
    'https://stage-lab.s3.ap-south-1.amazonaws.com',
    'https://uat-dicom.s3.ap-south-1.amazonaws.com',
    'https://uat-lab.s3.ap-south-1.amazonaws.com',
  ],
  // ----------------------------------------------------------------------------
  showStudyList: true,
  // some windows systems have issues with more than 3 web workers
  maxNumberOfWebWorkers: 3,
  // below flag is for performance reasons, but it might not work for all servers
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  experimentalStudyBrowserSort: false,
  strictZSpacingForVolumeViewport: true,
  groupEnabledModesFirst: true,
  allowMultiSelectExport: false,
  maxNumRequests: {
    interaction: 100,
    thumbnail: 5,
    // Prefetch number is dependent on the http protocol. For http 2 or
    // above, the number of requests can be go a lot higher.
    prefetch: 25,
  },
  // 'always' | 'dev' | 'production'. 'dev' keeps stack traces and internal
  // error detail out of the UI in a production build, where they leak
  // implementation detail to end users and can echo back request URLs. The
  // real cause is still reported to the browser console.
  showErrorDetails: 'dev',
  // `dangerouslyUseDynamicConfig` (load configuration from a `configUrl` query
  // parameter) is intentionally left OFF in the secure default build. See
  // config/dev.js for the documented shape.
  defaultDataSourceName: 'ohif',
  dataSources: [
    {
      // Read-only public demo server. Replace with your own DICOMweb server.
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'ohif',
      configuration: {
        friendlyName: 'AWS S3 Static wado server',
        name: 'aws',
        wadoUriRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        wadoRoot: 'https://d14fa38qiwhyfd.cloudfront.net/dicomweb',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'thumbnail',
        thumbnailRequestStrategy: 'fetch',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: true,
        staticWado: true,
        // Multiframe SEG loads fetch the whole instance as a single Part 10
        // object by default and wait for it: the per-frame endpoint is
        // efficient, but SEG frames are so small and numerous that one bulk
        // fetch beats hundreds of tiny requests. Per-frame loading is the
        // exception — set loadMultiframeAsPart10: false here to force it.
        singlepart: 'bulkdata,video',
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
          transform: url => url.replace('/pixeldata.mp4', '/rendered'),
        },
        omitQuotationForMultipartRequest: true,
      },
    },

    {
      // Required by the `/home` route: it fetches a DICOM zip / .dcm from the
      // `?url=` query parameter, unzips it in the browser, and hands the files
      // to this data source via `?datasources=dicomlocal`. Also backs the
      // `/localbasic` (straight-to-viewer) route. Nothing is uploaded — the
      // files live only in the browser's in-memory wadouri fileManager.
      namespace: '@ohif/extension-default.dataSourcesModule.dicomlocal',
      sourceName: 'dicomlocal',
      configuration: {
        friendlyName: 'dicom local',
      },
    },

    // The following data sources are intentionally NOT enabled in the secure
    // default because they broaden the attack surface of a default deployment.
    // Enable them only in a deployment you control (see config/dev.js):
    //   - dicomjson:     loads metadata from an arbitrary `?url=` (gate with
    //                    `dangerouslyAllowedOriginsForAuthenticatedEnvironments`).
    //   - dicomwebproxy: delegating proxy driven by `?url=`.
  ],
  httpErrorHandler: error => {
    // This is 429 when rejected from the public idc sandbox too often.
    console.warn(error.status);

    // Could use services manager here to bring up a dialog/modal if needed.
    console.warn('test, navigate to https://ohif.org/');
  },
};
