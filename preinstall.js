console.log('preinstall.js');

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const log = (err, stdout, stderr) => console.log(stdout);

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (GITHUB_TOKEN) {
  const command = `git config --global url."https://${GITHUB_TOKEN}:x-oauth-basic@github.com/".insteadOf ssh://git@github.com/`;
  console.log(command);
  exec(command, log);
} else {
  console.log('No GITHUB_TOKEN found, skipping private repo customization');
}

// Everything below regenerates the agent-tooling artifacts that .gitignore
// deliberately excludes: `CLAUDE.md` and `.claude/`. The committed sources are
// `AGENTS.md` and `.agents/`, so these outputs are always safe to replace.
//
// Symlinks are preferred (edits to the generated copy land on the source), but
// `fs.symlinkSync` throws EPERM on Windows unless Developer Mode is on or the
// shell is elevated. Each helper therefore walks a ladder — symlink, then a
// Windows-friendly fallback — and reports which rung it landed on. A silent
// no-op here is worse than a noisy fallback: it leaves agents with no project
// context at all, which is exactly what used to happen on Windows.

/** Rungs that were used, for the one-line summary at the end. */
const outcomes = [];

const isPermissionError = err => err.code === 'EPERM' || err.code === 'EACCES';

/**
 * Replace `linkPath` with a link to `target`, falling back to a real copy when
 * the platform refuses to create links.
 *
 * @param {string} linkPath     absolute path to create
 * @param {string} linkTarget   path stored *inside* the symlink (relative to linkPath's dir)
 * @param {string} copySource   absolute path to copy from when linking fails
 * @param {'file'|'junction'} type  'junction' is the Windows dir link that needs no elevation
 * @param {string} label        human-readable name for logging
 */
function linkOrCopy(linkPath, linkTarget, copySource, type, label) {
  try {
    fs.rmSync(linkPath, { recursive: true, force: true });
  } catch (err) {
    console.warn(`Skipped ${label}: could not clear ${linkPath} (${err.message})`);
    outcomes.push(`${label}=failed`);
    return;
  }

  try {
    fs.symlinkSync(linkTarget, linkPath, type);
    console.log(`Linked ${label} -> ${linkTarget}`);
    outcomes.push(`${label}=symlink`);
    return;
  } catch (err) {
    if (!isPermissionError(err)) {
      console.warn(`Skipped ${label}: ${err.message}`);
      outcomes.push(`${label}=failed`);
      return;
    }
    // Fall through to the fallbacks below.
  }

  // A hard link needs no elevation on NTFS and, unlike a copy, keeps the
  // generated file in step with edits to the source. Files only — directories
  // cannot be hard-linked, and they already succeeded above via a junction.
  if (type === 'file') {
    try {
      fs.linkSync(copySource, linkPath);
      console.warn(`Hard-linked ${label} (symlinks unavailable — enable Windows Developer Mode)`);
      outcomes.push(`${label}=hardlink`);
      return;
    } catch {
      // Different volume or a filesystem without hard links — copy instead.
    }
  }

  try {
    if (type === 'junction') {
      fs.cpSync(copySource, linkPath, { recursive: true });
    } else {
      fs.copyFileSync(copySource, linkPath);
    }
    // Not an error — the artifact is gitignored and regenerated every install,
    // so a copy is functionally equivalent. Warn so the weaker mode is visible.
    console.warn(
      `Copied ${label} (symlinks unavailable — enable Windows Developer Mode for a real link)`
    );
    outcomes.push(`${label}=copy`);
  } catch (err) {
    console.warn(`Skipped ${label}: ${err.message}`);
    outcomes.push(`${label}=failed`);
  }
}

// CLAUDE.md -> AGENTS.md
const agentsPath = path.join(__dirname, 'AGENTS.md');
const claudePath = path.join(__dirname, 'CLAUDE.md');

if (fs.existsSync(agentsPath)) {
  linkOrCopy(claudePath, 'AGENTS.md', agentsPath, 'file', 'CLAUDE.md');
} else {
  console.warn('No AGENTS.md found, skipping CLAUDE.md generation');
}

/**
 * Mirror every directory in `.agents/<kind>/` into `.claude/<kind>/`.
 * Used for skills today; agents/commands can be added by calling this again.
 */
function mirrorAgentsDir(kind) {
  const sourceDir = path.join(__dirname, '.agents', kind);
  const targetDir = path.join(__dirname, '.claude', kind);

  if (!fs.existsSync(sourceDir)) {
    console.log(`No .agents/${kind} directory found, skipping ${kind} mirroring`);
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const linkPath = path.join(targetDir, entry.name);
    const expectedTarget = path.join('..', '..', '.agents', kind, entry.name);
    const label = `.claude/${kind}/${entry.name}`;

    const existing = fs.lstatSync(linkPath, { throwIfNoEntry: false });
    if (existing && existing.isSymbolicLink()) {
      // Compare resolved paths, not the raw link text: Windows junctions always
      // store an absolute path even when created from a relative one, so a
      // string compare would never match and would re-fire the guard below on
      // this script's own link every install.
      const currentTarget = fs.readlinkSync(linkPath);
      const resolvedCurrent = path.resolve(path.dirname(linkPath), currentTarget);
      const resolvedExpected = path.resolve(sourceDir, entry.name);
      if (resolvedCurrent === resolvedExpected) {
        continue;
      }
      // A link pointing somewhere else is a developer override (.claude/ is
      // gitignored local config). Leave it alone.
      console.log(`Skipped ${label}: points to ${currentTarget}, not ${expectedTarget}`);
      continue;
    }

    // A real directory here is this script's own copy fallback from a previous
    // run on a machine without symlink permission. Refresh it so the mirror
    // does not go stale; `linkOrCopy` clears it first.
    if (existing && existing.isDirectory()) {
      console.log(`Refreshing ${label} (existing copy, not a symlink)`);
    }

    linkOrCopy(linkPath, expectedTarget, path.join(sourceDir, entry.name), 'junction', label);
  }
}

mirrorAgentsDir('skills');

if (outcomes.length) {
  const failed = outcomes.filter(entry => entry.endsWith('=failed'));
  console.log(`Agent artifacts: ${outcomes.join(', ')}`);
  if (failed.length) {
    console.warn(
      `${failed.length} agent artifact(s) could not be generated — AI tools will be missing project context.`
    );
  }
}
