import * as net from 'net';

// Wire protocol:
// Request: [1 byte opcode][2 bytes slot][2 bytes subslot][2 bytes index][2 bytes length][...data for write]
// Response: [1 byte status][...data for read]
const OP_READ = 0x01;
const OP_WRITE = 0x02;

const PORT = parseInt(process.env.PROFINET_PORT || '34964', 10);
const DEVICE_NAME = process.env.DEVICE_NAME || 'profinet-mock';

// Parse TELEMETRY_DEVICES: "NAME:Slot:Subslot:Index:DataType:Min:Max,..."
interface TelemetryDef {
  name: string;
  slot: number;
  subslot: number;
  index: number;
  dataType: string;
  min: number;
  max: number;
  currentValue: number;
}

// Parse COMMAND_DEVICES: "NAME:Slot:Subslot:Index:DataType,..."
interface CommandDef {
  name: string;
  slot: number;
  subslot: number;
  index: number;
  dataType: string;
  value: Buffer;
}

const telemetryDevices: TelemetryDef[] = [];
const commandDevices: CommandDef[] = [];

// Parse environment
const telemetryEnv = process.env.TELEMETRY_DEVICES || '';
if (telemetryEnv) {
  for (const entry of telemetryEnv.split(',')) {
    const [name, slot, subslot, index, dataType, min, max] = entry.split(':');
    const minVal = parseFloat(min);
    const maxVal = parseFloat(max);
    telemetryDevices.push({
      name,
      slot: parseInt(slot, 10),
      subslot: parseInt(subslot, 10),
      index: parseInt(index, 10),
      dataType,
      min: minVal,
      max: maxVal,
      currentValue: minVal + (maxVal - minVal) / 2,
    });
  }
}

const commandEnv = process.env.COMMAND_DEVICES || '';
if (commandEnv) {
  for (const entry of commandEnv.split(',')) {
    const [name, slot, subslot, index, dataType] = entry.split(':');
    commandDevices.push({
      name,
      slot: parseInt(slot, 10),
      subslot: parseInt(subslot, 10),
      index: parseInt(index, 10),
      dataType,
      value: Buffer.alloc(4),
    });
  }
}

// Fluctuate telemetry values ±2%
setInterval(() => {
  for (const dev of telemetryDevices) {
    const range = dev.max - dev.min;
    const fluctuation = (Math.random() - 0.5) * 0.04 * range;
    dev.currentValue = Math.max(dev.min, Math.min(dev.max, dev.currentValue + fluctuation));
  }
}, 100);

function findTelemetryDevice(slot: number, subslot: number, index: number): TelemetryDef | undefined {
  return telemetryDevices.find(d => d.slot === slot && d.subslot === subslot && d.index === index);
}

function findCommandDevice(slot: number, subslot: number, index: number): CommandDef | undefined {
  return commandDevices.find(d => d.slot === slot && d.subslot === subslot && d.index === index);
}

function valueToBuffer(value: number, dataType: string): Buffer {
  switch (dataType) {
    case 'Float32': {
      const buf = Buffer.alloc(4);
      buf.writeFloatBE(value, 0);
      return buf;
    }
    case 'UInt16': {
      const buf = Buffer.alloc(2);
      buf.writeUInt16BE(Math.round(value), 0);
      return buf;
    }
    case 'UInt32': {
      const buf = Buffer.alloc(4);
      buf.writeUInt32BE(Math.round(value), 0);
      return buf;
    }
    case 'Int16': {
      const buf = Buffer.alloc(2);
      buf.writeInt16BE(Math.round(value), 0);
      return buf;
    }
    case 'Int32': {
      const buf = Buffer.alloc(4);
      buf.writeInt32BE(Math.round(value), 0);
      return buf;
    }
    case 'Boolean': {
      const buf = Buffer.alloc(1);
      buf.writeUInt8(value ? 1 : 0, 0);
      return buf;
    }
    default: {
      const buf = Buffer.alloc(4);
      buf.writeFloatBE(value, 0);
      return buf;
    }
  }
}

const server = net.createServer((socket) => {
  console.log(`[${DEVICE_NAME}] Client connected: ${socket.remoteAddress}:${socket.remotePort}`);

  socket.on('data', (data) => {
    if (data.length < 9) {
      const errResp = Buffer.from([0xff]);
      socket.write(errResp);
      return;
    }

    const opcode = data.readUInt8(0);
    const slot = data.readUInt16BE(1);
    const subslot = data.readUInt16BE(3);
    const index = data.readUInt16BE(5);
    const length = data.readUInt16BE(7);

    if (opcode === OP_READ) {
      const telDev = findTelemetryDevice(slot, subslot, index);
      if (telDev) {
        const valueBuffer = valueToBuffer(telDev.currentValue, telDev.dataType);
        const resp = Buffer.alloc(1 + length);
        resp.writeUInt8(0, 0); // status OK
        valueBuffer.copy(resp, 1, 0, Math.min(valueBuffer.length, length));
        socket.write(resp);
        console.log(`[${DEVICE_NAME}] READ ${telDev.name}: ${telDev.currentValue.toFixed(2)}`);
      } else {
        // Check command devices (read current state)
        const cmdDev = findCommandDevice(slot, subslot, index);
        if (cmdDev) {
          const resp = Buffer.alloc(1 + length);
          resp.writeUInt8(0, 0);
          cmdDev.value.copy(resp, 1, 0, Math.min(cmdDev.value.length, length));
          socket.write(resp);
        } else {
          const resp = Buffer.alloc(1 + length);
          resp.writeUInt8(0, 0); // Return zeros for unknown addresses
          socket.write(resp);
        }
      }
    } else if (opcode === OP_WRITE) {
      const writeData = data.subarray(9, 9 + length);
      const cmdDev = findCommandDevice(slot, subslot, index);
      if (cmdDev) {
        writeData.copy(cmdDev.value);
        console.log(`[${DEVICE_NAME}] WRITE ${cmdDev.name}: ${writeData.toString('hex')}`);
      } else {
        console.log(`[${DEVICE_NAME}] WRITE unknown slot=${slot} subslot=${subslot} index=${index}: ${writeData.toString('hex')}`);
      }
      const resp = Buffer.from([0x00]); // status OK
      socket.write(resp);
    } else {
      const resp = Buffer.from([0xff]); // unknown opcode
      socket.write(resp);
    }
  });

  socket.on('close', () => {
    console.log(`[${DEVICE_NAME}] Client disconnected`);
  });

  socket.on('error', (err) => {
    console.error(`[${DEVICE_NAME}] Socket error:`, err.message);
  });
});

server.listen(PORT, () => {
  console.log(`[${DEVICE_NAME}] Profinet IO Mock Server listening on port ${PORT}`);
  console.log(`[${DEVICE_NAME}] Telemetry devices: ${telemetryDevices.map(d => d.name).join(', ') || 'none'}`);
  console.log(`[${DEVICE_NAME}] Command devices: ${commandDevices.map(d => d.name).join(', ') || 'none'}`);
});
