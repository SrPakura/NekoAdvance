/**
 * NekoAdvance - Version Management based on Commit Count
 * Logic:
 * - Commit 39 -> 1.3.9
 * - Commit 66 -> 1.6.6
 * - Commit 100 -> 2.0.0 (beta)
 * - Commit 101 -> 2.0.1
 */

export const CURRENT_COMMITS = 39;

export function calculateVersion(commits) {
  const major = Math.floor(commits / 100) + 1;
  const remainder = commits % 100;
  const minor = Math.floor(remainder / 10);
  const patch = remainder % 10;
  
  if (remainder === 0) {
    return `${major}.0.0 (beta)`;
  }
  return `${major}.${minor}.${patch}`;
}

export const APP_VERSION = calculateVersion(CURRENT_COMMITS);
