import { EventEmitter } from 'events';
import logger from '../utils/logger.js';
import { ProfinetClient } from './profinet-client.js';
import type { ProfinetTelemetryDevice, ProfinetDataType } from '../config/device-map.schema.js';

export class ProfinetTelemetryPoller extends EventEmitter {
  private connectionId: string;
  private client: ProfinetClient;
  private devices: ProfinetTelemetryDevice[];
  private pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private log;

  constructor(
    connectionId: string,
    client: ProfinetClient,
    devices: ProfinetTelemetryDevice[],
    pollIntervalMs: number,
  ) {
    super();
    this.connectionId = connectionId;
    this.client = client;
    this.devices = devices;
    this.pollIntervalMs = pollIntervalMs;
    this.log = logger.child({ module: 'profinet-telemetry-poller', connectionId });
  }

  start(): void {
    if (this.timer) return;
    this.log.info(
      { intervalMs: this.pollIntervalMs, deviceCount: this.devices.length },
      'Bắt đầu polling Profinet telemetry',
    );
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.log.info('Dừng polling Profinet telemetry');
    }
  }

  private async poll(): Promise<void> {
    if (!this.client.isConnected()) {
      this.log.warn('Bỏ qua poll cycle — Profinet chưa kết nối');
      return;
    }

    const timestamp = new Date().toISOString();

    for (const device of this.devices) {
      try {
        const buffer = await this.client.readData(device.slot, device.subslot, device.index, device.length);

        // F5: Validate response buffer length before parsing
        const minBytes = this.minBytesForType(device.dataType);
        if (buffer.length < minBytes) {
          this.log.warn(
            { deviceId: device.deviceId, expected: minBytes, received: buffer.length },
            'Response buffer quá ngắn — bỏ qua',
          );
          continue;
        }

        const value = this.parseBuffer(buffer, device.dataType);

        // F5: NaN guard — skip emit nếu value là NaN
        if (typeof value === 'number' && isNaN(value)) {
          this.log.warn({ deviceId: device.deviceId }, 'Giá trị NaN — bỏ qua');
          continue;
        }

        const telemetry = {
          connectionId: this.connectionId,
          deviceId: device.deviceId,
          value,
          unit: device.unit,
          description: device.description,
          timestamp,
        };

        this.log.debug(telemetry, 'Dữ liệu Profinet telemetry');
        this.emit('telemetry', telemetry);
      } catch (err) {
        this.log.error({ err, deviceId: device.deviceId }, 'Lỗi đọc Profinet device — bỏ qua, tiếp tục');
      }
    }
  }

  private parseBuffer(buffer: Buffer, dataType: ProfinetDataType): number | boolean {
    switch (dataType) {
      case 'Float32':
        return buffer.readFloatBE(0);
      case 'UInt16':
        return buffer.readUInt16BE(0);
      case 'UInt32':
        return buffer.readUInt32BE(0);
      case 'Int16':
        return buffer.readInt16BE(0);
      case 'Int32':
        return buffer.readInt32BE(0);
      case 'Boolean':
        return buffer.readUInt8(0) !== 0;
      default:
        throw new Error(`Profinet dataType không hỗ trợ: ${dataType}`);
    }
  }

  private minBytesForType(dataType: ProfinetDataType): number {
    switch (dataType) {
      case 'Boolean': return 1;
      case 'UInt16':
      case 'Int16': return 2;
      case 'Float32':
      case 'UInt32':
      case 'Int32': return 4;
      default: return 1;
    }
  }
}
