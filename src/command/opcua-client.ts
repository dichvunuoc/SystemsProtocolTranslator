import { EventEmitter } from 'events';
import {
  OPCUAClient,
  ClientSession,
  DataType,
  WriteValue,
  AttributeIds,
  StatusCodes,
  type ClientSubscription,
} from 'node-opcua';
import logger from '../utils/logger.js';
import { gatewayConfig } from '../config/gateway.config.js';

const log = logger.child({ module: 'opcua-client' });

export class OpcuaClient extends EventEmitter {
  private client: OPCUAClient;
  private session: ClientSession | null = null;
  private endpoint: string;
  private connected = false;
  private reconnecting = false;
  private shouldReconnect = true;

  constructor(endpoint: string) {
    super();
    this.endpoint = endpoint;
    this.client = OPCUAClient.create({
      applicationName: 'ProtocolTranslatorGateway',
      connectionStrategy: {
        initialDelay: gatewayConfig.reconnectBaseMs,
        maxDelay: gatewayConfig.reconnectMaxMs,
        maxRetry: 0, // Tự quản lý reconnection
      },
      endpointMustExist: false,
    });
  }

  async connect(): Promise<void> {
    try {
      log.info({ endpoint: this.endpoint }, 'Đang kết nối OPC UA...');
      await this.client.connect(this.endpoint);
      this.session = await this.client.createSession();
      this.connected = true;
      this.reconnecting = false;
      log.info('Kết nối OPC UA thành công');
      this.attachConnectionLostHandler();
      this.emit('connected');
    } catch (err) {
      log.error({ err }, 'Lỗi kết nối OPC UA');
      this.connected = false;
      this.scheduleReconnect();
    }
  }

  private attachConnectionLostHandler(): void {
    this.client.on('connection_lost', () => {
      log.warn('Mất kết nối OPC UA');
      this.connected = false;
      this.session = null;
      this.emit('disconnected');
      this.scheduleReconnect();
    });
  }

  async writeValue(
    nodeId: string,
    value: any,
    dataType: string,
  ): Promise<void> {
    if (!this.session) {
      throw new Error('OPC UA session chưa sẵn sàng');
    }

    const opcuaDataType = this.mapDataType(dataType);
    log.info({ nodeId, value, dataType }, 'Ghi giá trị OPC UA...');

    const statusCode = await this.session.write({
      nodeId,
      attributeId: AttributeIds.Value,
      value: {
        value: {
          dataType: opcuaDataType,
          value,
        },
      },
    });

    if (statusCode !== StatusCodes.Good) {
      throw new Error(`Ghi OPC UA thất bại: ${statusCode.toString()}`);
    }

    log.info({ nodeId, value }, 'Ghi giá trị OPC UA thành công');
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.connected = false;
    try {
      if (this.session) {
        await this.session.close();
        this.session = null;
      }
      await this.client.disconnect();
      log.info('Đã ngắt kết nối OPC UA');
    } catch {
      // Bỏ qua lỗi khi đóng
    }
    this.emit('disconnected');
  }

  isConnected(): boolean {
    return this.connected;
  }

  private mapDataType(dataType: string): DataType {
    switch (dataType) {
      case 'Boolean':
        return DataType.Boolean;
      case 'Float':
        return DataType.Float;
      case 'Double':
        return DataType.Double;
      case 'Int16':
        return DataType.Int16;
      case 'UInt16':
        return DataType.UInt16;
      case 'Int32':
        return DataType.Int32;
      case 'UInt32':
        return DataType.UInt32;
      default:
        throw new Error(`DataType OPC UA không được hỗ trợ: ${dataType}`);
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnecting) return;
    this.reconnecting = true;
    let delay = gatewayConfig.reconnectBaseMs;

    const attempt = async () => {
      if (!this.shouldReconnect) return;
      log.info({ delay }, 'Thử kết nối lại OPC UA...');
      try {
        this.client = OPCUAClient.create({
          applicationName: 'ProtocolTranslatorGateway',
          connectionStrategy: {
            initialDelay: gatewayConfig.reconnectBaseMs,
            maxDelay: gatewayConfig.reconnectMaxMs,
            maxRetry: 0,
          },
          endpointMustExist: false,
        });
        await this.client.connect(this.endpoint);
        this.session = await this.client.createSession();
        this.connected = true;
        this.reconnecting = false;
        log.info('Kết nối lại OPC UA thành công');
        this.attachConnectionLostHandler();
        this.emit('connected');
      } catch {
        delay = Math.min(delay * 2, gatewayConfig.reconnectMaxMs);
        setTimeout(attempt, delay);
      }
    };

    setTimeout(attempt, delay);
  }
}
