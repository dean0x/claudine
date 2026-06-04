/**
 * Available memory detection utility.
 *
 * DESIGN DECISION: On macOS, os.freemem() reports only "truly free" pages —
 * pages the OS has never handed out. On a 64 GB machine this can be ~1.6 GB
 * even when 50+ GB is available for apps (held as inactive/speculative/purgeable
 * pages that the VM reclaims on demand). This makes canSpawnWorker() permanently
 * return false because the ~3 GB requirement is never met.
 *
 * Fix: on darwin, run `vm_stat` (no shell, 3 ms synchronous) and compute
 * available = free + inactive + speculative + purgeable pages. These four
 * categories map to Apple's "green zone" in memory pressure reporting.
 * Any failure falls back to os.freemem() so non-darwin behavior is unchanged.
 *
 * References:
 * - https://developer.apple.com/library/archive/documentation/Performance/Conceptual/ManagingMemory
 * - vm_stat(1) man page
 */

import { execFileSync } from 'child_process';
import * as os from 'os';

/** vm_stat page-size header pattern — e.g. "(page size of 16384 bytes)" */
const PAGE_SIZE_RE = /\(page size of (\d+) bytes\)/;

/** Individual page count lines — e.g. "Pages free:                           32768." */
const PAGE_COUNT_RE = /^Pages (\w[\w ]+?):\s+([\d]+)\./m;

/**
 * Parse the textual output of `vm_stat` into an available-memory byte count.
 *
 * Available = (free + inactive + speculative + purgeable) * pageSize.
 * Returns `undefined` if the output is malformed, the page size header is absent,
 * or the computed byte count is zero (all categories reported 0 pages).
 *
 * This function is pure — no side effects, no I/O, easy to unit-test.
 *
 * @param output - Raw string output from `vm_stat`
 * @returns Available memory in bytes, or `undefined` if parsing fails
 */
export function parseVmStat(output: string): number | undefined {
  if (!output) return undefined;

  // Extract page size from the header line
  const pageSizeMatch = PAGE_SIZE_RE.exec(output);
  if (!pageSizeMatch) return undefined;

  const pageSize = parseInt(pageSizeMatch[1], 10);
  if (!Number.isFinite(pageSize) || pageSize <= 0) return undefined;

  // Helper: extract a named page count from the output
  function extractPages(label: string): number {
    const re = new RegExp(`^Pages ${label}:\\s+(\\d+)\\.`, 'm');
    const match = re.exec(output);
    if (!match) return 0;
    const count = parseInt(match[1], 10);
    return Number.isFinite(count) ? count : 0;
  }

  // These four categories form Apple's "available" memory (green zone)
  const freePages = extractPages('free');
  const inactivePages = extractPages('inactive');
  const speculativePages = extractPages('speculative');
  const purgeablePages = extractPages('purgeable');

  const totalPages = freePages + inactivePages + speculativePages + purgeablePages;
  if (totalPages === 0) return undefined;

  return totalPages * pageSize;
}

/**
 * Get available system memory in bytes.
 *
 * - On **darwin**: runs `vm_stat` synchronously (no shell, 3 ms) to obtain
 *   a realistic "available" figure that includes inactive and purgeable pages.
 *   Falls back to `os.freemem()` if `vm_stat` fails or produces unparseable output.
 * - On **all other platforms**: returns `os.freemem()` directly, unchanged.
 *
 * Always returns a positive number, never throws.
 */
export function getAvailableMemory(): number {
  if (os.platform() !== 'darwin') {
    return os.freemem();
  }

  try {
    const output = execFileSync('vm_stat', [], { encoding: 'utf8', timeout: 5_000 });
    const parsed = parseVmStat(output);
    if (parsed !== undefined) {
      return parsed;
    }
    // Unparseable output — fall back to os.freemem()
    return os.freemem();
  } catch {
    // vm_stat unavailable or timed out — fall back to os.freemem()
    return os.freemem();
  }
}
