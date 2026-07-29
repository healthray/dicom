/**
 * Magic-byte detection for the formats the `/home` route can be handed.
 *
 * The route used to rely on a `?fileType=` query parameter and defaulted to
 * `zip`, so a URL pointing at a single DICOM file was fed to JSZip and failed.
 * Both formats are unambiguous in their first 132 bytes, so detect instead.
 *
 * Pure functions over a Uint8Array — no Blob/File/DOM dependency — so they are
 * unit-testable and cheap to call.
 */

export type FileFormat = 'zip' | 'dcm' | 'pdf';

/**
 * Bytes needed to identify every format below: a zip signature and `%PDF` sit at
 * offset 0, but DICOM's `DICM` magic follows a 128-byte preamble.
 */
export const HEADER_BYTES = 132;

/** Offset of the `DICM` magic in a DICOM Part 10 file, after the preamble. */
const DICOM_MAGIC_OFFSET = 128;

const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04], // local file header — the usual case
  [0x50, 0x4b, 0x05, 0x06], // end of central directory — an empty archive
  [0x50, 0x4b, 0x07, 0x08], // spanned/split archive
];

const matchesAscii = (bytes: Uint8Array, offset: number, ascii: string) => {
  if (bytes.length < offset + ascii.length) {
    return false;
  }
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) {
      return false;
    }
  }
  return true;
};

const matchesBytes = (bytes: Uint8Array, signature: number[]) => {
  if (bytes.length < signature.length) {
    return false;
  }
  return signature.every((byte, i) => bytes[i] === byte);
};

export const isZipHeader = (bytes: Uint8Array) =>
  ZIP_SIGNATURES.some(signature => matchesBytes(bytes, signature));

/**
 * DICOM Part 10: a 128-byte preamble followed by `DICM`.
 *
 * Note this deliberately does not mirror `DicomFileUploader._checkDicomFile`,
 * which guards on `arrayBuffer.length` — `undefined` on an ArrayBuffer, whose
 * size property is `byteLength` — so its short-buffer guard never fires.
 */
export const isDicomHeader = (bytes: Uint8Array) =>
  matchesAscii(bytes, DICOM_MAGIC_OFFSET, 'DICM');

export const isPdfHeader = (bytes: Uint8Array) => matchesAscii(bytes, 0, '%PDF');

/**
 * @returns the detected format, or null when the bytes match none of them (an
 *   HTML/JSON error page, a raw DICOM with no preamble, or anything else).
 */
export function detectFormat(bytes: Uint8Array): FileFormat | null {
  if (isZipHeader(bytes)) {
    return 'zip';
  }
  if (isDicomHeader(bytes)) {
    return 'dcm';
  }
  if (isPdfHeader(bytes)) {
    return 'pdf';
  }
  return null;
}

/** MIME type `FileLoaderService` uses to choose between its DICOM and PDF loaders. */
export const mimeTypeForFormat = (format: FileFormat | null) =>
  format === 'pdf' ? 'application/pdf' : 'application/dicom';
