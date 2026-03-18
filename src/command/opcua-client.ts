import { EventEmitter } from 'events';
import {
  OPCUAClient,
  ClientSession,
  ClientSubscription,
  ClientMonitoredItem,
  DataType,
  AttributeIds,
  StatusCodes,
  TimestampsToReturn,
} from 'node-opcua';
import logger from '../utils/logger.js';
import type { ReconnectConfig } from '../config/device-map.schema.js';

export class OpcuaClient extends EventEmitter {
  private client: OPCUAClient;
  private session: ClientSession | null = null;
  private subscription: ClientSubscription | null = null;
  private connectionId: string;
  private endpoint: string;
  private reconnectConfig: ReconnectConfig;
  private connected = false;
  private reconnecting = false;
  private shouldReconnect = true;
  private log;

  constructor(
    connectionId: string,
    endpoint: string,
    reconnectConfig: ReconnectConfig,
  ) {
    super();
    this.connectionId = connectionId;
    this.endpoint = endpoint;
    this.reconnectConfig = reconnectConfig;
    this.log = logger.child({ module: 'opcua-client', connectionId });
    this.client = OPCUAClient.create({
      applicationName: 'ProtocolTranslatorGateway',
      connectionStrategy: {
        initialDelay: this.reconnectConfig.baseMs,
        maxDelay: this.reconnectConfig.maxMs,
        maxRetry: 0, // Tắt SDK reconnection — dùng logic custom
      },
      endpointMustExist: false,
    });
  }

  getConnectionId(): string {
    return this.connectionId;
  }

  async connect(): Promise<void> {
    try {
      this.log.info({ endpoint: this.endpoint }, 'Đang kết nối OPC UA...');
      await this.client.connect(this.endpoint);
      this.session = await this.client.createSession();
      this.connected = true;
      this.reconnecting = false;
      this.log.info('Kết nối OPC UA thành công');
      this.attachConnectionLostHandler();
      this.emit('connected');
    } catch (err) {
      this.log.error({ err }, 'Lỗi kết nối OPC UA');
      this.connected = false;
      this.scheduleReconnect();
    }
  }

  private connectionLostHandler = (): void => {
    this.log.warn('Mất kết nối OPC UA');
    this.connected = false;
    this.session = null;
    this.subscription = null;
    this.emit('disconnected');
    this.scheduleReconnect();
  };

  private attachConnectionLostHandler(): void {
    // Xóa listener cũ trước khi gắn mới — tránh stack listeners khi reconnect
    this.client.removeListener('connection_lost', this.connectionLostHandler);
    this.client.on('connection_lost', this.connectionLostHandler);
  }

  async createSubscription(publishingInterval = 1000): Promise<ClientSubscription> {
    if (!this.session) {
      throw new Error('OPC UA session chưa sẵn sàng');
    }

    this.log.info({ publishingInterval }, 'Tạo OPC UA subscription...');

    const subscription = await this.session.createSubscription2({
      requestedPublishingInterval: publishingInterval,
      requestedLifetimeCount: 100,
      requestedMaxKeepAliveCount: 10,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 1,
    });

    subscription.on('terminated', () => {
      this.log.warn('OPC UA subscription bị terminate');
    });

    this.subscription = subscription;
    this.log.info('Tạo OPC UA subscription thành công');
    return subscription;
  }

  async monitorItem(
    subscription: ClientSubscription,
    nodeId: string,
    samplingInterval = 500,
  ): Promise<ClientMonitoredItem> {
    const monitoredItem = await subscription.monitor(
      { nodeId, attributeId: AttributeIds.Value },
      { samplingInterval, discardOldest: true, queueSize: 10 },
      TimestampsToReturn.Both,
    );

    this.log.debug({ nodeId, samplingInterval }, 'Đã tạo monitored item');
    return monitoredItem;
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
    this.log.info({ nodeId, value, dataType }, 'Ghi giá trị OPC UA...');

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

    this.log.info({ nodeId, value }, 'Ghi giá trị OPC UA thành công');
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.connected = false;
    try {
      if (this.subscription) {
        await this.subscription.terminate();
        this.subscription = null;
      }
      if (this.session) {
        await this.session.close();
        this.session = null;
      }
      await this.client.disconnect();
      this.log.info('Đã ngắt kết nối OPC UA');
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
    let delay = this.reconnectConfig.baseMs;

    const attempt = async () => {
      if (!this.shouldReconnect) return;
      this.log.info({ delay }, 'Thử kết nối lại OPC UA...');
      try {
        // Cleanup old client listeners trước khi tạo mới
        this.client.removeAllListeners('connection_lost');
        this.client = OPCUAClient.create({
          applicationName: 'ProtocolTranslatorGateway',
          connectionStrategy: {
            initialDelay: this.reconnectConfig.baseMs,
            maxDelay: this.reconnectConfig.maxMs,
            maxRetry: 0,
          },
          endpointMustExist: false,
        });
        await this.client.connect(this.endpoint);
        this.session = await this.client.createSession();
        this.connected = true;
        this.reconnecting = false;
        this.log.info('Kết nối lại OPC UA thành công');
        this.attachConnectionLostHandler();
        this.emit('connected');
      } catch {
        delay = Math.min(delay * 2, this.reconnectConfig.maxMs);
        setTimeout(attempt, delay);
      }
    };

    setTimeout(attempt, delay);
  }
}
