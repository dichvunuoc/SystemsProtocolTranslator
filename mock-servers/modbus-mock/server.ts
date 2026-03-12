import net from 'net';
import modbus from 'jsmodbus';

const PORT = 502;
const UPDATE_INTERVAL_MS = 2000;

// Tạo TCP server cho Modbus
const netServer = new net.Server();
const modbusServer = new modbus.server.TCP(netServer, {
  holding: Buffer.alloc(20, 0), // 10 registers x 2 bytes = 20 bytes
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
 * Cập nhật register values với dữ liệu mô phỏng
 */
function updateRegisters() {
  const holding = modbusServer.holding;

  // Registers 0-1: Áp suất đầu vào (1.5–3.5 bar)
  const pressure1 = randomRange(1.5, 3.5);
  const [p1Hi, p1Lo] = floatToRegisters(pressure1);
  holding.writeUInt16BE(p1Hi, 0);
  holding.writeUInt16BE(p1Lo, 2);

  // Registers 2-3: Áp suất đầu ra (1.0–2.5 bar) — CD_AB word order
  // Mock server lưu theo AB_CD, gateway sẽ parse theo CD_AB config
  const pressure2 = randomRange(1.0, 2.5);
  const [p2Hi, p2Lo] = floatToRegisters(pressure2);
  // Đảo word order: low word ở register 2, high word ở register 3
  holding.writeUInt16BE(p2Lo, 4);
  holding.writeUInt16BE(p2Hi, 6);

  // Registers 4-5: Lưu lượng (10.0–50.0 m3/h)
  const flowRate = randomRange(10.0, 50.0);
  const [fHi, fLo] = floatToRegisters(flowRate);
  holding.writeUInt16BE(fHi, 8);
  holding.writeUInt16BE(fLo, 10);

  // Registers 6-7: Mực nước (0.5–5.0 m)
  const waterLevel = randomRange(0.5, 5.0);
  const [wHi, wLo] = floatToRegisters(waterLevel);
  holding.writeUInt16BE(wHi, 12);
  holding.writeUInt16BE(wLo, 14);

  // Register 8: Trạng thái bơm 1 (0 hoặc 1)
  const pump1Status = Math.random() > 0.5 ? 1 : 0;
  holding.writeUInt16BE(pump1Status, 16);

  // Register 9: Trạng thái bơm 2 (0 hoặc 1)
  const pump2Status = Math.random() > 0.5 ? 1 : 0;
  holding.writeUInt16BE(pump2Status, 18);

  console.log(
    `[Modbus Mock] Cập nhật registers — P1: ${pressure1.toFixed(2)} bar, P2: ${pressure2.toFixed(2)} bar, Flow: ${flowRate.toFixed(1)} m3/h, Level: ${waterLevel.toFixed(2)} m, Pump1: ${pump1Status}, Pump2: ${pump2Status}`,
  );
}

// Cập nhật dữ liệu mô phỏng mỗi 2 giây
setInterval(updateRegisters, UPDATE_INTERVAL_MS);
updateRegisters(); // Cập nhật ngay lần đầu

netServer.listen(PORT, () => {
  console.log(`[Modbus Mock] Server đã khởi động tại 0.0.0.0:${PORT}`);
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
