import { EventEmitter } from 'events';
import * as net from 'net';
import logger from '../utils/logger.js';
import type { ReconnectConfig } from '../config/device-map.schema.js';

// Simple wire protocol for mock Profinet IO:
// Request: [1 byte opcode][2 bytes slot][2 bytes subslot][2 bytes index][2 bytes length][...data for write]
// Response: [1 byte status][...data for read]
const OP_READ = 0x01;
const OP_WRITE = 0x02;

interface PendingRequest {
  expectedLength: number;
  resolve: (data: Buffer) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class ProfinetClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private connectionId: string;
  private host: string;
  private port: number;
  private deviceName?: string;
  private reconnectConfig: ReconnectConfig;
  private connected = false;
  private reconnecting = false;
  private shouldReconnect = true;
  private log;

  // F1: TCP stream buffering — accumulate partial data
  private recvBuffer = Buffer.alloc(0);
  // F2: Request serialization queue — one request at a time
  private pendingRequest: PendingRequest | null = null;
  private requestQueue: Array<() => void> = [];

  constructor(
    connectionId: string,
    host: string,
    port: number,
    deviceName: string | undefined,
    reconnectConfig: ReconnectConfig,
  ) {
    super();
    this.connectionId = connectionId;
    this.host = host;
    this.port = port;
    this.deviceName = deviceName;
    this.reconnectConfig = reconnectConfig;
    this.log = logger.child({ module: 'profinet-client', connectionId });
  }

  getConnectionId(): string {
    return this.connectionId;
  }

  async connect(): Promise<void> {
    this.log.info({ host: this.host, port: this.port, deviceName: this.deviceName }, 'Đang kết nối Profinet IO...');

    try {
      await this.createAndConnect();
      this.connected = true;
      this.reconnecting = false;
      this.log.info('Kết nối Profinet IO thành công');
      this.emit('connected');
    } catch (err) {
      // F3: connect() rejects on failure so callers' .catch() works
      this.log.error({ err }, 'Lỗi kết nối Profinet IO');
      this.connected = false;
      this.scheduleReconnect();
      throw err;
    }
  }

  async readData(slot: number, subslot: number, index: number, length: number): Promise<Buffer> {
    if (!this.connected || !this.socket) {
      throw new Error('Profinet chưa kết nối');
    }

    // F2: Serialize requests through queue
    return this.enqueueRequest(length, () => {
      const req = Buffer.alloc(9);
      req.writeUInt8(OP_READ, 0);
      req.writeUInt16BE(slot, 1);
      req.writeUInt16BE(subslot, 3);
      req.writeUInt16BE(index, 5);
      req.writeUInt16BE(length, 7);
      this.socket!.write(req);
    });
  }

  async writeData(slot: number, subslot: number, index: number, data: Buffer): Promise<void> {
    if (!this.connected || !this.socket) {
      throw new Error('Profinet chưa kết nối');
    }

    // F2: Serialize — write response is 1 byte status only
    const responseLength = 0;
    await this.enqueueRequest(responseLength, () => {
      const header = Buffer.alloc(9);
      header.writeUInt8(OP_WRITE, 0);
      header.writeUInt16BE(slot, 1);
      header.writeUInt16BE(subslot, 3);
      header.writeUInt16BE(index, 5);
      header.writeUInt16BE(data.length, 7);
      this.socket!.write(Buffer.concat([header, data]));
    });
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.connected = false;
    this.drainQueue(new Error('Profinet đang ngắt kết nối'));
    try {
      this.socket?.destroy();
      this.socket = null;
      this.log.info('Đã ngắt kết nối Profinet IO');
    } catch {
      // Bỏ qua lỗi khi đóng
    }
    this.emit('disconnected');
  }

  isConnected(): boolean {
    return this.connected;
  }

  // --- Private: TCP framing + request queue ---

  private enqueueRequest(expectedDataLength: number, sendFn: () => void): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const execute = () => {
        if (!this.connected || !this.socket) {
          reject(new Error('Profinet chưa kết nối'));
          this.processNextRequest();
          return;
        }

        const timeout = setTimeout(() => {
          this.pendingRequest = null;
          reject(new Error('Profinet request timeout'));
          this.processNextRequest();
        }, 5000);

        this.pendingRequest = {
          expectedLength: 1 + expectedDataLength, // 1 byte status + data
          resolve: (buf) => {
            clearTimeout(timeout);
            resolve(buf);
          },
          reject: (err) => {
            clearTimeout(timeout);
            reject(err);
          },
          timeout,
        };

        try {
          sendFn();
        } catch (err) {
          clearTimeout(timeout);
          this.pendingRequest = null;
          this.handleConnectionLoss();
          reject(err instanceof Error ? err : new Error(String(err)));
          this.processNextRequest();
        }
      };

      if (this.pendingRequest) {
        this.requestQueue.push(execute);
      } else {
        execute();
      }
    });
  }

  private processNextRequest(): void {
    const next = this.requestQueue.shift();
    if (next) next();
  }

  private drainQueue(err: Error): void {
    if (this.pendingRequest) {
      clearTimeout(this.pendingRequest.timeout);
      this.pendingRequest.reject(err);
      this.pendingRequest = null;
    }
    const queued = this.requestQueue.splice(0);
    // Queued items haven't started yet — they'll reject when execute() checks connected
    for (const fn of queued) fn();
  }

  // F1: Handle TCP stream data — buffer and parse complete responses
  private onSocketData = (data: Buffer): void => {
    this.recvBuffer = Buffer.concat([this.recvBuffer, data]);
    this.tryResolveResponse();
  };

  private tryResolveResponse(): void {
    if (!this.pendingRequest) return;

    const needed = this.pendingRequest.expectedLength;
    if (this.recvBuffer.length < needed) return; // Wait for more data

    const responseData = this.recvBuffer.subarray(0, needed);
    this.recvBuffer = this.recvBuffer.subarray(needed);

    const pending = this.pendingRequest;
    this.pendingRequest = null;

    const status = responseData.readUInt8(0);
    if (status !== 0) {
      pending.reject(new Error(`Profinet error: status=${status}`));
    } else {
      // F5: Return validated payload — exact expected length guaranteed by framing
      pending.resolve(responseData.subarray(1));
    }

    this.processNextRequest();
  }

  private handleConnectionLoss(): void {
    if (!this.connected) return;
    this.connected = false;
    this.recvBuffer = Buffer.alloc(0);
    this.drainQueue(new Error('Profinet mất kết nối'));
    this.log.warn('Mất kết nối Profinet IO');
    this.emit('disconnected');
    this.scheduleReconnect();
  }

  // --- Private: Socket lifecycle ---

  private createAndConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.socket?.destroy();
      this.recvBuffer = Buffer.alloc(0);

      const socket = new net.Socket();
      this.socket = socket;

      const onConnect = () => {
        cleanup();
        this.attachSocketHandlers(socket);
        resolve();
      };

      const onError = (err: Error) => {
        cleanup();
        socket.destroy();
        this.socket = null;
        reject(err);
      };

      const cleanup = () => {
        socket.removeListener('connect', onConnect);
        socket.removeListener('error', onError);
      };

      socket.on('connect', onConnect);
      socket.on('error', onError);
      socket.connect(this.port, this.host);
    });
  }

  // F4: Persistent handlers on connected socket — includes error handler
  private attachSocketHandlers(socket: net.Socket): void {
    socket.on('data', this.onSocketData);

    socket.on('error', (err) => {
      this.log.error({ err }, 'Lỗi socket Profinet IO');
      this.handleConnectionLoss();
    });

    socket.on('close', () => {
      this.handleConnectionLoss();
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnecting) return;
    this.reconnecting = true;
    let delay = this.reconnectConfig.baseMs;

    const attempt = async () => {
      if (!this.shouldReconnect) return;
      this.log.info({ delay }, 'Thử kết nối lại Profinet IO...');
      try {
        await this.createAndConnect();
        this.connected = true;
        this.reconnecting = false;
        this.log.info('Kết nối lại Profinet IO thành công');
        this.emit('connected');
      } catch {
        delay = Math.min(delay * 2, this.reconnectConfig.maxMs);
        setTimeout(attempt, delay);
      }
    };

    setTimeout(attempt, delay);
  }
}
