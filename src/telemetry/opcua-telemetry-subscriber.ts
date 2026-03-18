import { EventEmitter } from 'events';
import type { ClientSubscription, ClientMonitoredItem } from 'node-opcua';
import logger from '../utils/logger.js';
import { OpcuaClient } from '../command/opcua-client.js';
import type { OpcuaTelemetryDevice } from '../config/device-map.schema.js';
import type { TelemetryData } from './telemetry-poller.js';

export class OpcuaTelemetrySubscriber extends EventEmitter {
  private connectionId: string;
  private opcuaClient: OpcuaClient;
  private devices: OpcuaTelemetryDevice[];
  private subscription: ClientSubscription | null = null;
  private monitoredItems: ClientMonitoredItem[] = [];
  private log;

  constructor(
    connectionId: string,
    opcuaClient: OpcuaClient,
    devices: OpcuaTelemetryDevice[],
  ) {
    super();
    this.connectionId = connectionId;
    this.opcuaClient = opcuaClient;
    this.devices = devices;
    this.log = logger.child({ module: 'opcua-telemetry-subscriber', connectionId });
  }

  async start(): Promise<void> {
    // Cleanup cũ trước khi tạo mới — tránh stack listeners khi reconnect (F2)
    await this.stop();

    this.log.info({ deviceCount: this.devices.length }, 'Bắt đầu OPC UA telemetry subscription');

    try {
      this.subscription = await this.opcuaClient.createSubscription();

      for (const device of this.devices) {
        const monitoredItem = await this.opcuaClient.monitorItem(
          this.subscription,
          device.nodeId,
        );

        monitoredItem.on('changed', (dataValue: any) => {
          const value = dataValue.value?.value;
          if (value === undefined || value === null) return;

          // F5: Guard NaN
          const numValue = typeof value === 'number' ? value : Number(value);
          if (Number.isNaN(numValue)) {
            this.log.warn({ deviceId: device.deviceId, rawValue: value }, 'Giá trị không hợp lệ — bỏ qua');
            return;
          }

          const telemetry: TelemetryData = {
            connectionId: this.connectionId,
            deviceId: device.deviceId,
            value: numValue,
            unit: device.unit,
            description: device.description,
            timestamp: new Date().toISOString(),
          };

          this.log.debug(telemetry, 'Dữ liệu telemetry OPC UA');
          this.emit('telemetry', telemetry);
        });

        this.monitoredItems.push(monitoredItem);
        this.log.info({ deviceId: device.deviceId, nodeId: device.nodeId }, 'Đã subscribe node');
      }

      this.log.info('OPC UA telemetry subscription đã sẵn sàng');
    } catch (err) {
      this.log.error({ err }, 'Lỗi tạo OPC UA subscription');
      throw err;
    }
  }

  async stop(): Promise<void> {
    // F2: Cleanup monitored items listeners
    for (const item of this.monitoredItems) {
      item.removeAllListeners('changed');
    }
    this.monitoredItems = [];

    if (this.subscription) {
      try {
        await this.subscription.terminate();
        this.log.info('Đã dừng OPC UA telemetry subscription');
      } catch (err) {
        // F10: Log lỗi thay vì nuốt
        this.log.debug({ err }, 'Lỗi khi terminate subscription — bỏ qua');
      }
      this.subscription = null;
    }
  }
}
