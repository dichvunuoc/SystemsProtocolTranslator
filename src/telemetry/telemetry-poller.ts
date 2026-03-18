import { EventEmitter } from 'events';
import logger from '../utils/logger.js';
import { ModbusClient } from './modbus-client.js';
import { parseRegisters, type DataType, type WordOrder } from './register-parser.js';

export interface ModbusDevice {
  deviceId: string;
  register: number;
  length: number;
  dataType: DataType;
  wordOrder: WordOrder;
  unit: string;
  description: string;
}

export interface TelemetryData {
  connectionId: string;
  deviceId: string;
  value: number;
  unit: string;
  description: string;
  timestamp: string;
}

export class TelemetryPoller extends EventEmitter {
  private connectionId: string;
  private modbusClient: ModbusClient;
  private devices: ModbusDevice[];
  private pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private log;

  constructor(
    connectionId: string,
    modbusClient: ModbusClient,
    devices: ModbusDevice[],
    pollIntervalMs: number,
  ) {
    super();
    this.connectionId = connectionId;
    this.modbusClient = modbusClient;
    this.devices = devices;
    this.pollIntervalMs = pollIntervalMs;
    this.log = logger.child({ module: 'telemetry-poller', connectionId });
  }

  start(): void {
    if (this.timer) return;
    this.log.info(
      { intervalMs: this.pollIntervalMs, deviceCount: this.devices.length },
      'Bắt đầu polling telemetry',
    );
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.log.info('Dừng polling telemetry');
    }
  }

  private async poll(): Promise<void> {
    if (!this.modbusClient.isConnected()) {
      this.log.warn('Bỏ qua poll cycle — Modbus chưa kết nối');
      return;
    }

    try {
      // Tính batch read range: từ register nhỏ nhất đến lớn nhất
      const minAddr = Math.min(...this.devices.map((d) => d.register));
      const maxEnd = Math.max(
        ...this.devices.map((d) => d.register + d.length),
      );
      const totalLength = maxEnd - minAddr;

      // Đọc tất cả registers trong 1 batch
      const allRegisters = await this.modbusClient.readHoldingRegisters(
        minAddr,
        totalLength,
      );

      const timestamp = new Date().toISOString();

      // Parse từng device từ batch data
      for (const device of this.devices) {
        const offset = device.register - minAddr;
        const deviceRegisters = allRegisters.slice(
          offset,
          offset + device.length,
        );

        const value = parseRegisters(
          deviceRegisters,
          device.dataType,
          device.wordOrder,
        );

        const telemetry: TelemetryData = {
          connectionId: this.connectionId,
          deviceId: device.deviceId,
          value,
          unit: device.unit,
          description: device.description,
          timestamp,
        };

        this.log.debug(telemetry, 'Dữ liệu telemetry');
        this.emit('telemetry', telemetry);
      }
    } catch (err) {
      this.log.error({ err }, 'Lỗi trong poll cycle — bỏ qua, tiếp tục');
    }
  }
}
