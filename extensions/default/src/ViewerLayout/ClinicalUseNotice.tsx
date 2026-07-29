import React from 'react';
import PropTypes from 'prop-types';

/**
 * TODO(legal): the default wording below is a PLACEHOLDER and must be reviewed
 * and approved before production release. It is written for an
 * informational-viewing-only deployment: the product is not cleared or
 * certified as a medical device (CDSCO / FDA / EU MDR) and must not be relied
 * on for diagnosis. If the intended use ever changes, this notice is not
 * sufficient on its own — the product would be reclassified.
 *
 * Override the text per deployment with `clinicalUseNotice` in the app config.
 *
 * Deliberately NOT dismissible, unlike `InvestigationalUseDialog`. A notice the
 * user can hide is not visible at the moment reliance actually happens — while
 * they are looking at the images. It is rendered as a small, non-interactive
 * strip so it states the limitation without obstructing the viewport.
 *
 * `pointer-events-none` matters: this sits above the viewport, and the viewport
 * is driven by mouse interaction (window/level, pan, zoom, measurements). The
 * notice must never swallow those events.
 */
function ClinicalUseNotice({ text }) {
  if (text === null || text === '') {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed bottom-0 left-0 z-40 w-full select-none text-center"
      data-cy="clinical-use-notice"
      role="note"
    >
      <span className="bg-popover/80 text-muted-foreground rounded-t px-3 py-0.5 text-xs tracking-wide">
        {text || 'Not for diagnostic use. For informational purposes only.'}
      </span>
    </div>
  );
}

ClinicalUseNotice.propTypes = {
  /** Overrides the default wording. Pass null or '' to suppress the notice. */
  text: PropTypes.string,
};

export default ClinicalUseNotice;
