import logger from '../utils/logger.js';

const log = logger.child({ module: 'register-parser' });

export type WordOrder = 'AB_CD' | 'CD_AB' | 'BA_DC' | 'DC_BA';
export type DataType = 'Float32' | 'UInt16';

/**
 * Chuyển đổi mảng raw register values (UInt16[]) thành giá trị số
 * theo dataType và wordOrder được cấu hình.
 */
export function parseRegisters(
  registers: number[],
  dataType: DataType,
  wordOrder: WordOrder,
): number {
  if (!registers || registers.length === 0) {
    throw new Error('Mảng registers rỗng — không thể parse');
  }

  if (dataType === 'UInt16') {
    const value = registers[0];
    log.debug({ raw: registers, dataType, value }, 'Parse UInt16 thành công');
    return value;
  }

  if (dataType === 'Float32') {
    if (registers.length < 2) {
      throw new Error('Float32 yêu cầu ít nhất 2 registers');
    }

    const buf = Buffer.alloc(4);
    const [r0, r1] = registers;

    // Tách từng byte từ 2 registers: r0 = [A,B], r1 = [C,D]
    const A = (r0 >> 8) & 0xff;
    const B = r0 & 0xff;
    const C = (r1 >> 8) & 0xff;
    const D = r1 & 0xff;

    // Sắp xếp bytes theo word order → luôn ra dạng Big-Endian [A,B,C,D]
    switch (wordOrder) {
      case 'AB_CD':
        // Big-Endian chuẩn: [A,B,C,D]
        buf[0] = A; buf[1] = B; buf[2] = C; buf[3] = D;
        break;
      case 'CD_AB':
        // Word Swap: input [C,D,A,B] → cần hoán đổi word
        buf[0] = C; buf[1] = D; buf[2] = A; buf[3] = B;
        break;
      case 'BA_DC':
        // Byte Swap trong mỗi word: input [B,A,D,C]
        buf[0] = B; buf[1] = A; buf[2] = D; buf[3] = C;
        break;
      case 'DC_BA':
        // Little-Endian hoàn toàn: input [D,C,B,A]
        buf[0] = D; buf[1] = C; buf[2] = B; buf[3] = A;
        break;
      default:
        throw new Error(`Word order không hợp lệ: ${wordOrder}`);
    }

    const value = buf.readFloatBE(0);
    log.debug(
      { raw: registers, wordOrder, bytes: buf.toString('hex'), value },
      'Parse Float32 thành công',
    );
    return value;
  }

  throw new Error(`DataType không được hỗ trợ: ${dataType}`);
}
