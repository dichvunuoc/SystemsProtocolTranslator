import { EventEmitter } from 'events';
import ModbusRTU from 'modbus-serial';
import logger from '../utils/logger.js';
import type { ReconnectConfig } from '../config/device-map.schema.js';

export class ModbusClient extends EventEmitter {
  private client: ModbusRTU;
  private connectionId: string;
  private host: string;
  private port: number;
  private unitId: number;
  private reconnectConfig: ReconnectConfig;
  private connected = false;
  private reconnecting = false;
  private shouldReconnect = true;
  private log;

  constructor(
    connectionId: string,
    host: string,
    port: number,
    unitId: number,
    reconnectConfig: ReconnectConfig,
  ) {
    super();
    this.client = new ModbusRTU();
    this.connectionId = connectionId;
    this.host = host;
    this.port = port;
    this.unitId = unitId;
    this.reconnectConfig = reconnectConfig;
    this.log = logger.child({ module: 'modbus-client', connectionId });
  }

  getConnectionId(): string {
    return this.connectionId;
  }

  async connect(): Promise<void> {
    try {
      this.log.info(
        { host: this.host, port: this.port },
        'Đang kết nối Modbus TCP...',
      );
      await this.client.connectTCP(this.host, { port: this.port });
      this.client.setID(this.unitId);
      this.client.setTimeout(5000);
      this.connected = true;
      this.reconnecting = false;
      this.log.info('Kết nối Modbus TCP thành công');
      this.emit('connected');
    } catch (err) {
      this.log.error({ err }, 'Lỗi kết nối Modbus TCP');
      this.connected = false;
      this.scheduleReconnect();
    }
  }

  async readHoldingRegisters(
    addr: number,
    length: number,
  ): Promise<number[]> {
    if (!this.connected) {
      throw new Error('Modbus chưa kết nối');
    }
    try {
      const result = await this.client.readHoldingRegisters(addr, length);
      this.log.debug(
        { addr, length, data: result.data },
        'Đọc holding registers thành công',
      );
      return result.data;
    } catch (err) {
      this.log.error({ err, addr, length }, 'Lỗi đọc holding registers — đánh dấu mất kết nối');
      this.connected = false;
      this.emit('disconnected');
      this.scheduleReconnect();
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.connected = false;
    try {
      this.client.close(() => {});
      this.log.info('Đã ngắt kết nối Modbus TCP');
    } catch {
      // Bỏ qua lỗi khi đóng
    }
    this.emit('disconnected');
  }

  isConnected(): boolean {
    return this.connected;
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnecting) return;
    this.reconnecting = true;
    let delay = this.reconnectConfig.baseMs;

    const attempt = async () => {
      if (!this.shouldReconnect) return;
      this.log.info({ delay }, 'Thử kết nối lại Modbus TCP...');
      try {
        this.client = new ModbusRTU();
        await this.client.connectTCP(this.host, { port: this.port });
        this.client.setID(this.unitId);
        this.client.setTimeout(5000);
        this.connected = true;
        this.reconnecting = false;
        this.log.info('Kết nối lại Modbus TCP thành công');
        this.emit('connected');
      } catch {
        delay = Math.min(delay * 2, this.reconnectConfig.maxMs);
        setTimeout(attempt, delay);
      }
    };

    setTimeout(attempt, delay);
  }
}
