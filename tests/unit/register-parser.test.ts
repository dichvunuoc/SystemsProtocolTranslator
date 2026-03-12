import { describe, it, expect } from 'vitest';
import { parseRegisters } from '../../src/telemetry/register-parser.js';

// IEEE 754 Float32: 5.0 = 0x40A00000 (high=0x40A0, low=0x0000)
// IEEE 754 Float32: 1.25 = 0x3FA00000 (high=0x3FA0, low=0x0000)
// IEEE 754 Float32: 123.456 ≈ 0x42F6E979 (high=0x42F6, low=0xE979) — giá trị không đối xứng

describe('parseRegisters', () => {
  describe('Float32 — giá trị đối xứng (low word = 0x0000)', () => {
    it('AB_CD (Big-Endian): [0x40A0, 0x0000] → 5.0', () => {
      const result = parseRegisters([0x40a0, 0x0000], 'Float32', 'AB_CD');
      expect(result).toBeCloseTo(5.0);
    });

    it('CD_AB (Word Swap): [0x0000, 0x40A0] → 5.0', () => {
      const result = parseRegisters([0x0000, 0x40a0], 'Float32', 'CD_AB');
      expect(result).toBeCloseTo(5.0);
    });

    it('BA_DC (Byte Swap): [0xA040, 0x0000] → 5.0', () => {
      const result = parseRegisters([0xa040, 0x0000], 'Float32', 'BA_DC');
      expect(result).toBeCloseTo(5.0);
    });

    it('DC_BA (Little-Endian): [0x0000, 0xA040] → 5.0', () => {
      const result = parseRegisters([0x0000, 0xa040], 'Float32', 'DC_BA');
      expect(result).toBeCloseTo(5.0);
    });
  });

  describe('Float32 — giá trị không đối xứng (123.456 = 0x42F6E979)', () => {
    // 123.456 ≈ 0x42F6E979: A=0x42, B=0xF6, C=0xE9, D=0x79
    it('AB_CD: [0x42F6, 0xE979] → 123.456', () => {
      const result = parseRegisters([0x42f6, 0xe979], 'Float32', 'AB_CD');
      expect(result).toBeCloseTo(123.456, 2);
    });

    it('CD_AB: [0xE979, 0x42F6] → 123.456', () => {
      const result = parseRegisters([0xe979, 0x42f6], 'Float32', 'CD_AB');
      expect(result).toBeCloseTo(123.456, 2);
    });

    it('BA_DC: [0xF642, 0x79E9] → 123.456', () => {
      const result = parseRegisters([0xf642, 0x79e9], 'Float32', 'BA_DC');
      expect(result).toBeCloseTo(123.456, 2);
    });

    it('DC_BA: [0x79E9, 0xF642] → 123.456', () => {
      const result = parseRegisters([0x79e9, 0xf642], 'Float32', 'DC_BA');
      expect(result).toBeCloseTo(123.456, 2);
    });
  });

  describe('Float32 — edge cases', () => {
    it('Float32 cần ít nhất 2 registers', () => {
      expect(() => parseRegisters([0x40a0], 'Float32', 'AB_CD')).toThrow(
        'Float32 yêu cầu ít nhất 2 registers',
      );
    });
  });

  describe('UInt16', () => {
    it('UInt16: [1] → 1', () => {
      expect(parseRegisters([1], 'UInt16', 'AB_CD')).toBe(1);
    });

    it('UInt16: [0] → 0', () => {
      expect(parseRegisters([0], 'UInt16', 'AB_CD')).toBe(0);
    });
  });

  describe('Edge cases', () => {
    it('Mảng registers rỗng → throw error', () => {
      expect(() => parseRegisters([], 'Float32', 'AB_CD')).toThrow(
        'Mảng registers rỗng',
      );
    });
  });
});
