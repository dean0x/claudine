/**
 * Tests for available-memory utility
 *
 * Tests both the pure parseVmStat parser and the platform-dispatching
 * getAvailableMemory() function.
 */

import { execFileSync } from 'child_process';
import * as os from 'os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAvailableMemory, parseVmStat } from '../../../src/utils/available-memory.js';

// ---------------------------------------------------------------------------
// parseVmStat tests (pure parser — no mocks needed)
// ---------------------------------------------------------------------------

describe('parseVmStat', () => {
  // Real macOS vm_stat output — 16384 byte page size
  const VALID_VMSTAT_16K = `
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                           32768.
Pages active:                        524288.
Pages inactive:                      131072.
Pages speculative:                    16384.
Pages throttled:                         0.
Pages wired down:                     65536.
Pages purgeable:                      32768.
"Translation faults":             12345678.
Pages copy-on-write:               9876543.
Pages zero filled:               123456789.
Pages reactivated:                   12345.
Pages purged:                         5678.
File-backed pages:                   32768.
Anonymous pages:                     49152.
Pages stored in compressor:          32768.
Pages occupied by compressor:         8192.
Decompressions:                      45678.
Compressions:                        78901.
Pageins:                             23456.
Pageouts:                             1234.
Swapins:                                 0.
Swapouts:                                0.
`.trim();

  it('returns correct byte sum for valid macOS output with 16384 page size', () => {
    // free=32768, inactive=131072, speculative=16384, purgeable=32768 pages
    // total pages = 32768 + 131072 + 16384 + 32768 = 212,992 pages
    // bytes = 212,992 * 16,384 = 3,489,660,928
    const result = parseVmStat(VALID_VMSTAT_16K);

    expect(result).toBeDefined();
    expect(typeof result).toBe('number');
    // 212,992 pages * 16,384 bytes/page
    expect(result).toBe(212_992 * 16_384);
  });

  it('returns correct byte sum for 4096 page size', () => {
    const output = `
Mach Virtual Memory Statistics: (page size of 4096 bytes)
Pages free:                           10000.
Pages inactive:                       20000.
Pages speculative:                     5000.
Pages purgeable:                       3000.
`.trim();

    // total pages = 10000 + 20000 + 5000 + 3000 = 38000
    // bytes = 38000 * 4096 = 155,648,000
    const result = parseVmStat(output);
    expect(result).toBe(38_000 * 4_096);
  });

  it('handles missing "Pages purgeable" — sums remaining 3 categories', () => {
    const output = `
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                           10000.
Pages inactive:                       20000.
Pages speculative:                     5000.
`.trim();

    // free + inactive + speculative = 35000 pages
    const result = parseVmStat(output);
    expect(result).toBe(35_000 * 16_384);
  });

  it('handles missing "Pages speculative" and "Pages purgeable" — sums 2 categories', () => {
    const output = `
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                           10000.
Pages inactive:                       20000.
`.trim();

    // free + inactive = 30000 pages
    const result = parseVmStat(output);
    expect(result).toBe(30_000 * 16_384);
  });

  it('returns undefined when all categories report 0 pages', () => {
    const output = `
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               0.
Pages inactive:                           0.
Pages speculative:                        0.
Pages purgeable:                          0.
`.trim();

    const result = parseVmStat(output);
    expect(result).toBeUndefined();
  });

  it('returns undefined when page size header is missing', () => {
    const output = `
Pages free:                           10000.
Pages inactive:                       20000.
Pages speculative:                     5000.
Pages purgeable:                       3000.
`.trim();

    const result = parseVmStat(output);
    expect(result).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    const result = parseVmStat('');
    expect(result).toBeUndefined();
  });

  it('returns undefined for completely malformed output', () => {
    const result = parseVmStat('not vm_stat output at all\njust random garbage\n12345');
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getAvailableMemory tests (mocked platform + execFileSync)
// ---------------------------------------------------------------------------

vi.mock('os', () => ({
  default: {
    freemem: vi.fn(() => 1_600_000_000),
    platform: vi.fn(() => 'linux'),
  },
  freemem: vi.fn(() => 1_600_000_000),
  platform: vi.fn(() => 'linux'),
}));

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

describe('getAvailableMemory', () => {
  const mockFreemem = os.freemem as ReturnType<typeof vi.fn>;
  const mockPlatform = os.platform as ReturnType<typeof vi.fn>;
  const mockExecFileSync = execFileSync as ReturnType<typeof vi.fn>;

  const FREEMEM_BYTES = 1_600_000_000;

  const VALID_VMSTAT = `
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                           50000.
Pages inactive:                      100000.
Pages speculative:                    20000.
Pages purgeable:                      10000.
`.trim();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFreemem.mockReturnValue(FREEMEM_BYTES);
    mockPlatform.mockReturnValue('linux');
  });

  it('returns os.freemem() directly on non-darwin platforms', () => {
    mockPlatform.mockReturnValue('linux');

    const result = getAvailableMemory();

    expect(result).toBe(FREEMEM_BYTES);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('returns parsed vm_stat value on darwin when vm_stat succeeds', () => {
    mockPlatform.mockReturnValue('darwin');
    mockExecFileSync.mockReturnValue(VALID_VMSTAT);

    const result = getAvailableMemory();

    // 180000 pages * 16384 bytes/page = 2,949,120,000
    expect(result).toBe(180_000 * 16_384);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      '/usr/bin/vm_stat',
      [],
      expect.objectContaining({ encoding: 'utf8' }),
    );
  });

  it('falls back to os.freemem() on darwin when vm_stat throws', () => {
    mockPlatform.mockReturnValue('darwin');
    mockExecFileSync.mockImplementation(() => {
      throw new Error('vm_stat: command not found');
    });

    const result = getAvailableMemory();

    expect(result).toBe(FREEMEM_BYTES);
  });

  it('falls back to os.freemem() on darwin when vm_stat output is unparseable', () => {
    mockPlatform.mockReturnValue('darwin');
    mockExecFileSync.mockReturnValue('garbled output with no useful data');

    const result = getAvailableMemory();

    expect(result).toBe(FREEMEM_BYTES);
  });

  it('falls back to os.freemem() on darwin when vm_stat reports zero available pages', () => {
    mockPlatform.mockReturnValue('darwin');
    mockExecFileSync.mockReturnValue(
      `
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               0.
Pages inactive:                           0.
Pages speculative:                        0.
Pages purgeable:                          0.
`.trim(),
    );

    const result = getAvailableMemory();

    expect(result).toBe(FREEMEM_BYTES);
  });
});
