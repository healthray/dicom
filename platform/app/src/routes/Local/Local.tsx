import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import JSZip from 'jszip';
import { DicomMetadataStore } from '@ohif/core';
import filesToStudies from './filesToStudies';
import { extensionManager } from '../../App.tsx';

type LocalProps = {
  modePath: string;
};

function Local({ modePath }: LocalProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [loadingFile, setLoadingFile] = useState(true)
  const [isError, setIsError] = useState(false)

  const microscopyExtensionLoaded = extensionManager.registeredExtensionIds.includes(
    '@ohif/extension-dicom-microscopy'
  );

  const getBlobByURL = fileUrl =>
    new Promise(async (resolve, reject) => {
      try {
        const response = await fetch(fileUrl);
        const blob = await response.blob();
        resolve(blob);
      } catch (error) {
        reject(error)
      }
    });


  const unZip = async (unzipData) => {
    const zip = new JSZip();
    const isZip = Object.keys(unzipData.files).filter(fileName => fileName.toLowerCase().endsWith(".zip"))
    if (isZip.length) {
      const a = await unzipData.file(isZip[0]).async("blob")
      return unZip(await zip.loadAsync(a));
    }
    return unzipData;
  }

  const onLoad = async () => {
    try {
      console.log("location.search", location.search)
      const blob = await getBlobByURL(location.search.replace('?url=', ''));

      const zip = new JSZip();
      let unzipData = await zip.loadAsync(blob);
      unzipData = await unZip(unzipData);
      const files = await Promise.all(
        Object.entries(unzipData.files)
          .filter(([_, val]) => !val.dir)
          .map(
            ([fileName]) =>
              new Promise(async resolve => {
                const fileData = await unzipData.files[fileName].async(
                  'arraybuffer'
                );
                const file = new File([fileData], fileName, {
                  type: 'application/dicom',
                });
                resolve(file);
              })
          )
      );

      const studies = await filesToStudies(files);

      const query = new URLSearchParams();


      if (microscopyExtensionLoaded) {
        // TODO: for microscopy, we are forcing microscopy mode, which is not ideal.
        //     we should make the local drag and drop navigate to the worklist and
        //     there user can select microscopy mode
        const smStudies = studies.filter(id => {
          const study = DicomMetadataStore.getStudy(id);
          return (
            study.series.findIndex(
              s => s.Modality === 'SM' || s.instances[0].Modality === 'SM'
            ) >= 0
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

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div className="h-screen w-screen flex justify-center items-center ">
        <div className="px-8 mx-auto bg-secondary-dark drop-shadow-md space-y-2 rounded-lg">
          <img
            className="block mx-auto h-40"
            src="./healthray-logo.png"
            alt="healthrayLogo"
          />
          <div className="flex flex-col justify-center items-center">
            {loadingFile && <img
              className="block mx-auto h-14"
              src="./loading-gif.gif"
              alt="loadingGif"
            />}
            {isError && <>
              <p className='text-xl text-white font-semibold mb-1'>Something went wrong...</p>
              <p className="text-xl text-white font-semibold">
                Please visit <a className='text-primary-active' href="https://www.lab.healthray.com/" target='_blank'>lab.healthray.com</a> Site.
              </p>
            </>}
          </div>
          <div className='flex justify-end items-center'>
            <span className='text-white'>
              Powered By
            </span>
            <img
              className="w-20 h-14 ml-2"
              src="./ohif-logo.svg"
              alt="OHIF"
            />
          </div>
        </div>
      </div>
    </div >
  );
}

export default Local;
