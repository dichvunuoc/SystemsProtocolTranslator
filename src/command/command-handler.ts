import logger from '../utils/logger.js';
import { OpcuaClient } from './opcua-client.js';

const log = logger.child({ module: 'command-handler' });

export interface OpcuaDevice {
  deviceId: string;
  nodeId: string;
  dataType: string;
  description: string;
}

export interface CommandPayload {
  deviceId: string;
  action: string;
}

export interface CommandResult {
  success: boolean;
  message: string;
}

export class CommandHandler {
  private opcuaClient: OpcuaClient;
  private devices: OpcuaDevice[];

  constructor(opcuaClient: OpcuaClient, devices: OpcuaDevice[]) {
    this.opcuaClient = opcuaClient;
    this.devices = devices;
  }

  async handleCommand(payload: CommandPayload): Promise<CommandResult> {
    const { deviceId, action } = payload;
    log.info({ deviceId, action }, 'Nhận command');

    // Tìm device trong device map
    const device = this.devices.find((d) => d.deviceId === deviceId);
    if (!device) {
      const msg = `Device không tồn tại: ${deviceId}`;
      log.warn({ deviceId }, msg);
      throw new Error(msg);
    }

    // Map action → value theo dataType
    const value = this.mapActionToValue(action, device.dataType);

    // Ghi giá trị qua OPC UA
    await this.opcuaClient.writeValue(device.nodeId, value, device.dataType);

    const msg = `Command ${action} cho ${deviceId} thành công`;
    log.info({ deviceId, action, nodeId: device.nodeId }, msg);
    return { success: true, message: msg };
  }

  private mapActionToValue(action: string, dataType: string): any {
    if (dataType === 'Boolean') {
      switch (action.toUpperCase()) {
        case 'START':
          return true;
        case 'STOP':
          return false;
        default:
          throw new Error(
            `Action không hợp lệ cho Boolean: ${action}. Chỉ hỗ trợ START/STOP`,
          );
      }
    }
    throw new Error(`DataType chưa hỗ trợ mapping action: ${dataType}`);
  }
}
