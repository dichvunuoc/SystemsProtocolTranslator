import net from 'net';
import { ModbusTCPServer } from 'jsmodbus';

const PORT = parseInt(process.env.MODBUS_PORT || '502', 10);
const UPDATE_INTERVAL_MS = 2000;
const STATION_PROFILE = process.env.STATION_PROFILE || 'full';

// --- Định nghĩa profile mô phỏng ---

interface Float32Simulation {
  offset: number;   // byte offset trong holding buffer
  type: 'float32';
  min: number;
  max: number;
  swapWords?: boolean; // true = ghi CD_AB (low word trước)
}

interface UInt16Simulation {
  offset: number;
  type: 'uint16';
  values: number[];
}

type RegisterSimulation = Float32Simulation | UInt16Simulation;

interface StationProfile {
  simulations: RegisterSimulation[];
}

// Tự động tính registerCount từ max offset trong simulations
function calcRegisterCount(simulations: RegisterSimulation[]): number {
  const maxByte = Math.max(...simulations.map(s => s.offset + (s.type === 'float32' ? 4 : 2)));
  return maxByte / 2;
}

const PROFILES: Record<string, StationProfile> = {
  full: {
    simulations: [
      { offset: 0, type: 'float32', min: 1.5, max: 3.5 },             // Áp suất đầu vào
      { offset: 4, type: 'float32', min: 1.0, max: 2.5, swapWords: true }, // Áp suất đầu ra (CD_AB)
      { offset: 8, type: 'float32', min: 10.0, max: 50.0 },           // Lưu lượng
      { offset: 12, type: 'float32', min: 0.5, max: 5.0 },            // Mực nước
      { offset: 16, type: 'uint16', values: [0, 1] },                  // Trạng thái bơm 1
      { offset: 18, type: 'uint16', values: [0, 1] },                  // Trạng thái bơm 2
    ],
  },
  minimal: {
    simulations: [
      { offset: 0, type: 'float32', min: 1.0, max: 4.0 },  // Áp suất Station B
      { offset: 4, type: 'uint16', values: [0, 1] },         // Trạng thái bơm 3
    ],
  },
};

const profile = PROFILES[STATION_PROFILE];
if (!profile) {
  console.error(`[Modbus Mock] Profile không hợp lệ: ${STATION_PROFILE}. Chỉ hỗ trợ: ${Object.keys(PROFILES).join(', ')}`);
  process.exit(1);
}

// Tạo TCP server cho Modbus
const netServer = new net.Server();
const registerCount = calcRegisterCount(profile.simulations);
const holdingSize = registerCount * 2; // mỗi register = 2 bytes
const modbusServer = new ModbusTCPServer(netServer, {
  holding: Buffer.alloc(holdingSize, 0),
});

/**
 * Chuyển Float32 thành 2 registers (AB_CD word order — Big-Endian)
 */
function floatToRegisters(value: number): [number, number] {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(value, 0);
  return [buf.readUInt16BE(0), buf.readUInt16BE(2)];
}

/**
 * Random số trong khoảng [min, max]
 */
function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Cập nhật register values dựa trên profile
 */
function updateRegisters() {
  const holding = modbusServer.holding;
  const values: string[] = [];

  for (const sim of profile.simulations) {
    if (sim.type === 'float32') {
      const val = randomRange(sim.min, sim.max);
      const [hi, lo] = floatToRegisters(val);
      if (sim.swapWords) {
        // CD_AB: low word trước, high word sau
        holding.writeUInt16BE(lo, sim.offset);
        holding.writeUInt16BE(hi, sim.offset + 2);
      } else {
        // AB_CD: high word trước, low word sau
        holding.writeUInt16BE(hi, sim.offset);
        holding.writeUInt16BE(lo, sim.offset + 2);
      }
      values.push(`${val.toFixed(2)}`);
    } else if (sim.type === 'uint16') {
      const val = sim.values[Math.floor(Math.random() * sim.values.length)];
      holding.writeUInt16BE(val, sim.offset);
      values.push(`${val}`);
    }
  }

  console.log(`[Modbus Mock] [${STATION_PROFILE}] Cập nhật registers — ${values.join(', ')}`);
}

// Cập nhật dữ liệu mô phỏng
setInterval(updateRegisters, UPDATE_INTERVAL_MS);
updateRegisters(); // Cập nhật ngay lần đầu

netServer.listen(PORT, () => {
  console.log(`[Modbus Mock] Server đã khởi động tại 0.0.0.0:${PORT} (profile: ${STATION_PROFILE}, registers: ${registerCount})`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[Modbus Mock] Đang tắt server...');
  netServer.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  netServer.close();
  process.exit(0);
});
