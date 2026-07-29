import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import JSZip from 'jszip';
import { DicomMetadataStore } from '@ohif/core';

import filesToStudies from './filesToStudies';
import { HEADER_BYTES, detectFormat, mimeTypeForFormat, type FileFormat } from './detectFileFormat';

import { resolveLocalFileUrl, redactUrl } from './resolveFileUrl';

import { extensionManager } from '../../App';
import HealthrayNotice from '../../components/HealthrayNotice';
import { publicUrl } from '../../utils/publicUrl';
import { useAppConfig } from '@state';

type LocalProps = {
  modePath: string;
};

function Local({ modePath }: LocalProps) {
  const navigate = useNavigate();
  const [loadingFile, setLoadingFile] = useState(true);
  const [isError, setIsError] = useState(false);
  const [searchParams] = useSearchParams();
  const [appConfig] = useAppConfig();

  const microscopyExtensionLoaded = extensionManager.registeredExtensionIds.includes(
    '@ohif/extension-dicom-microscopy'
  );

  const getBlobByURL = async (fileUrl: URL) => {
    const response = await fetch(fileUrl.toString(), {
      // `?url=` is attacker-controllable, and on this deployment the URL is
      // itself the access credential. Each option closes a specific leak:
      //   no-referrer  - the signed URL sits in the document URL, so the default
      //                  policy would hand it to the origin being fetched.
      //   redirect:error - a 302 would otherwise bypass the origin allowlist
      //                  checked in resolveLocalFileUrl.
      //   credentials:omit - never attach cookies to a third-party fetch.
      mode: 'cors',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    // Without this an error body (S3's XML "AccessDenied", an HTML 404 page) is
    // handed to the parsers below and surfaces as a misleading format error.
    if (!response.ok) {
      throw new Error(`Request failed with HTTP ${response.status} ${response.statusText}`);
    }
    return response.blob();
  };

  /** A display name for the file manager; the URL path is the only thing we can read. */
  const fileNameFromUrl = (fileUrl: URL) => {
    try {
      return (
        decodeURIComponent(fileUrl.pathname.split('/').filter(Boolean).pop() || '') ||
        'download.dcm'
      );
    } catch {
      return 'download.dcm';
    }
  };

  const unZip = async unzipData => {
    const zip = new JSZip();
    const isZip = Object.keys(unzipData.files).filter(fileName =>
      fileName.toLowerCase().endsWith('.zip')
    );
    if (isZip.length) {
      const a = await unzipData.file(isZip[0]).async('blob');
      return unZip(await zip.loadAsync(a));
    }
    return unzipData;
  };

  const onLoad = async () => {
    const rawFileUrl = searchParams.get('url');
    let fileUrl: URL | null = null;

    try {
      // Validate before fetching. `?url=` is attacker-controllable and this
      // deployment has no authentication, so possession of the URL is the only
      // thing gating access — it has to be an origin we chose to trust.
      fileUrl = resolveLocalFileUrl(rawFileUrl, {
        allowedOrigins: appConfig?.allowedLocalFileOrigins,
        pageOrigin: window.location.origin,
        configName: appConfig?.name,
      });

      const requestedType = searchParams.get('fileType');
      const blob = await getBlobByURL(fileUrl);

      // Identify the file from its own bytes rather than trusting ?fileType=.
      // Only the header is read, so the archive is never buffered twice: `blob`
      // itself is still what JSZip receives below.
      const header = new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer());
      const detected = detectFormat(header);

      if (detected && requestedType && detected !== requestedType) {
        console.warn(
          `Local: ?fileType=${requestedType} contradicts the downloaded file, which is a ${detected}. Using ${detected}.`
        );
      } else if (!detected) {
        console.warn(
          `Local: could not identify ${redactUrl(fileUrl)} from its header (not a zip, DICOM or PDF); reading it as ${
            requestedType || 'dcm'
          }.`
        );
      }

      // Detected format wins, then ?fileType=, then a best-effort DICOM read —
      // which is what a valid DICOM lacking the 128-byte preamble needs.
      const format: FileFormat = detected ?? ((requestedType as FileFormat) || 'dcm');

      let studies = null;

      if (format === 'zip') {
        const zip = new JSZip();
        let unzipData = await zip.loadAsync(blob);
        unzipData = await unZip(unzipData);
        const files = await Promise.all(
          Object.entries(unzipData.files)
            .filter(([_, val]) => !val.dir)
            .map(async ([fileName]) => {
              const fileData = await unzipData.files[fileName].async('arraybuffer');
              return new File([fileData], fileName, { type: 'application/dicom' });
            })
        );
        studies = await filesToStudies(files);
      } else {
        // Wrap in a File so FileLoaderService picks its loader from the detected
        // format instead of whatever Content-Type the server happened to send.
        const file = new File([blob], fileNameFromUrl(fileUrl), {
          type: mimeTypeForFormat(detected),
        });
        studies = await filesToStudies([file]);
      }

      // filesToStudies only console.logs per-file failures, so without this an
      // archive of unreadable entries would "succeed" having loaded nothing.
      if (!studies?.length) {
        throw new Error('No readable DICOM instances were found in the downloaded file.');
      }

      const query = new URLSearchParams();

      if (microscopyExtensionLoaded) {
        // TODO: for microscopy, we are forcing microscopy mode, which is not ideal.
        //     we should make the local drag and drop navigate to the worklist and
        //     there user can select microscopy mode
        const smStudies = studies.filter(id => {
          const study = DicomMetadataStore.getStudy(id);
          return (
            study.series.findIndex(s => s.Modality === 'SM' || s.instances[0].Modality === 'SM') >=
            0
          );
        });

        if (smStudies.length > 0) {
          smStudies.forEach(id => query.append('StudyInstanceUIDs', id));

          modePath = 'microscopy';
        }
      }

      // Todo: navigate to work list and let user select a mode
      studies.forEach(id => query.append('StudyInstanceUIDs', id));
      query.append('datasources', 'dicomlocal');

      setLoadingFile(false);
      navigate(`/${modePath}?${decodeURIComponent(query.toString())}`);
    } catch (error) {
      // The notice deliberately stays generic for end users, so this console
      // entry is the only place the real cause is reported. The URL is redacted
      // because its query string carries the signature that authorises access.
      console.error(`Local: failed to load ${redactUrl(fileUrl)} —`, error);
      setLoadingFile(false);
      setIsError(true);
    }
  };

  // Set body style
  useEffect(() => {
    onLoad();
    document.body.classList.add('bg-black');
    return () => {
      document.body.classList.remove('bg-black');
    };
  }, []);

  if (isError) {
    return <HealthrayNotice title="Something went wrong..." />;
  }

  return (
    <HealthrayNotice>
      {loadingFile && (
        <img
          className="mx-auto block h-14"
          src={`${publicUrl}loading-gif.gif`}
          alt="loadingGif"
        />
      )}
    </HealthrayNotice>
  );
}

export default Local;
