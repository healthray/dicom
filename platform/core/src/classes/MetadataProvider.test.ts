import metadataProvider from './MetadataProvider';

beforeEach(() => {
  (
    metadataProvider as unknown as {
      imageURIToUIDs: Map<string, unknown>;
    }
  ).imageURIToUIDs.clear();
});

describe('MetadataProvider', () => {
  it('uses the WADO frame query parameter as the frame number', () => {
    expect(
      metadataProvider.getUIDsFromImageID(
        'dicomweb:http://localhost/wado?requestType=WADO&studyUID=study-wado&seriesUID=series-wado&objectUID=sop-wado&contentType=application/dicom&transferSyntax=*&frame=5'
      )
    ).toEqual({
      StudyInstanceUID: 'study-wado',
      SeriesInstanceUID: 'series-wado',
      SOPInstanceUID: 'sop-wado',
      frameNumber: '5',
    });
  });

  it('uses the frame query parameter for local multiframe imageIds registered by base URL', () => {
    const baseImageId = 'blob:http://localhost/local-multiframe';
    const uids = {
      StudyInstanceUID: 'study-local',
      SeriesInstanceUID: 'series-local',
      SOPInstanceUID: 'sop-local',
    };

    metadataProvider.addImageIdToUIDs(baseImageId, uids);

    expect(metadataProvider.getUIDsFromImageID(`${baseImageId}&frame=3`)).toEqual({
      ...uids,
      frameNumber: '3',
    });
  });

  it('prefers the frame query parameter over stored frame metadata', () => {
    const baseImageId = 'blob:http://localhost/local-multiframe-with-frame-number';
    const uids = {
      StudyInstanceUID: 'study-local-with-frame-number',
      SeriesInstanceUID: 'series-local-with-frame-number',
      SOPInstanceUID: 'sop-local-with-frame-number',
      frameNumber: '1',
    };

    metadataProvider.addImageIdToUIDs(baseImageId, uids);

    expect(metadataProvider.getUIDsFromImageID(`${baseImageId}&frame=4`)).toEqual({
      ...uids,
      frameNumber: '4',
    });
  });

  it('prefers an exact frame imageId mapping before falling back to the base URL', () => {
    const baseImageId = 'blob:http://localhost/local-multiframe-exact-frame';
    metadataProvider.addImageIdToUIDs(baseImageId, {
      StudyInstanceUID: 'study-base',
      SeriesInstanceUID: 'series-base',
      SOPInstanceUID: 'sop-base',
      frameNumber: '1',
    });

    const frameImageId = `${baseImageId}&frame=3`;
    metadataProvider.addImageIdToUIDs(frameImageId, {
      StudyInstanceUID: 'study-frame',
      SeriesInstanceUID: 'series-frame',
      SOPInstanceUID: 'sop-frame',
      frameNumber: '3',
    });

    expect(metadataProvider.getUIDsFromImageID(frameImageId)).toEqual({
      StudyInstanceUID: 'study-frame',
      SeriesInstanceUID: 'series-frame',
      SOPInstanceUID: 'sop-frame',
      frameNumber: '3',
    });
  });

  describe('voiLutModule', () => {
    // Regression coverage for a production failure: cornerstone's createImage
    // reads `voiLUTFunction[0]`, so a bare string was indexed by character
    // ('SIGMOID' -> 'S'), which is not a VOILUTFunctionType and made
    // toLowHighRange throw 'Invalid VOI LUT function' instead of rendering.
    const voiLutModule = (instance: Record<string, unknown>) =>
      metadataProvider.getTagFromInstance('voiLutModule', instance as never);

    it('returns voiLUTFunction as an array, matching windowCenter/windowWidth', () => {
      const result = voiLutModule({
        WindowCenter: 40,
        WindowWidth: 400,
        VOILUTFunction: 'SIGMOID',
      });

      expect(result.voiLUTFunction).toEqual(['SIGMOID']);
      // The value cornerstone actually reads must be the whole function name.
      expect(result.voiLUTFunction[0]).toBe('SIGMOID');
    });

    it('trims the trailing space a conformant CS value carries', () => {
      // VOILUTFunction has VR CS, padded to an even length: 'SIGMOID' is 7.
      expect(
        voiLutModule({ WindowCenter: 40, WindowWidth: 400, VOILUTFunction: 'SIGMOID ' })
          .voiLUTFunction
      ).toEqual(['SIGMOID']);
    });

    it('upper-cases a lower-case value', () => {
      expect(
        voiLutModule({ WindowCenter: 40, WindowWidth: 400, VOILUTFunction: 'linear_exact' })
          .voiLUTFunction
      ).toEqual(['LINEAR_EXACT']);
    });

    it('passes an already-array value through', () => {
      expect(
        voiLutModule({ WindowCenter: 40, WindowWidth: 400, VOILUTFunction: ['LINEAR'] })
          .voiLUTFunction
      ).toEqual(['LINEAR']);
    });

    it.each([undefined, null, '', 'NOT_A_REAL_FUNCTION', 42, {}])(
      'drops the unusable value %p so cornerstone applies its LINEAR default',
      value => {
        expect(
          voiLutModule({ WindowCenter: 40, WindowWidth: 400, VOILUTFunction: value }).voiLUTFunction
        ).toBeUndefined();
      }
    );

    it.each(['LINEAR', 'LINEAR_EXACT', 'SIGMOID'])('accepts the valid function %s', value => {
      expect(
        voiLutModule({ WindowCenter: 40, WindowWidth: 400, VOILUTFunction: value }).voiLUTFunction
      ).toEqual([value]);
    });

    it('still returns undefined when the window values are missing', () => {
      expect(voiLutModule({ VOILUTFunction: 'LINEAR' })).toBeUndefined();
    });
  });
});
