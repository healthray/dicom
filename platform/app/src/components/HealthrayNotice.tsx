import React from 'react';

import { publicUrl } from '../utils/publicUrl';

type HealthrayNoticeProps = {
  /** Optional heading rendered above the "Please visit ..." line. */
  title?: string;
  /** Replaces the default message body entirely (e.g. the loading spinner). */
  children?: React.ReactNode;
};

/**
 * The Healthray-branded card used for every screen that is not the viewer:
 * the `/home` loader, the `/home` error state, and every route this deployment
 * does not allow (see `ALLOWED_MODE_ROUTES` in `routes/index.tsx`).
 *
 * Asset URLs are prefixed with `publicUrl` rather than written relatively —
 * a relative `./healthray-logo.png` resolves against the current path, so it
 * would 404 on two-segment routes such as `/viewer/dicomlocal`.
 */
function HealthrayNotice({ title, children }: HealthrayNoticeProps) {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div className="flex h-screen w-screen items-center justify-center">
        <div className="bg-secondary-dark mx-auto space-y-2 rounded-lg px-8 drop-shadow-md">
          <img
            className="mx-auto block h-40"
            src={`${publicUrl}healthray-logo.png`}
            alt="healthrayLogo"
          />
          <div className="flex flex-col items-center justify-center">
            {children ?? (
              <>
                {title && <p className="mb-1 text-xl font-semibold text-white">{title}</p>}
                <p className="text-xl font-semibold text-white">
                  Please visit{' '}
                  <a
                    className="text-primary-active"
                    href="https://www.lab.healthray.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    lab.healthray.com
                  </a>{' '}
                  Site.
                </p>
              </>
            )}
          </div>
          {/*
            TODO(legal): PLACEHOLDER wording, must be reviewed and approved
            before production release. Kept in step with the viewer-side notice
            in `extensions/default/src/ViewerLayout/ClinicalUseNotice.tsx` —
            change both together.
          */}
          <p className="text-center text-xs text-white/70">
            Not for diagnostic use. For informational purposes only.
          </p>
          <div className="flex items-center justify-end">
            <span className="text-white">Powered By</span>
            <img
              className="ml-2 h-14 w-20"
              src={`${publicUrl}ohif-logo.svg`}
              alt="OHIF"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default HealthrayNotice;
