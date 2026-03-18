import logger from '../utils/logger.js';
import { OpcuaClient } from './opcua-client.js';
import type { OpcuaCommandDevice } from '../config/device-map.schema.js';

const log = logger.child({ module: 'command-handler' });

// Typed errors cho REST error handler phân biệt HTTP status codes
export class CommandValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandValidationError';
  }
}

export interface CommandPayload {
  deviceId: string;
  action: string;
}

export interface CommandResult {
  success: boolean;
  message: string;
}

export interface CommandRouteEntry {
  connectionId: string;
  protocol: 'opcua' | 'modbus';
  client: OpcuaClient;
  device: OpcuaCommandDevice;
}

export class CommandHandler {
  private routeMap: Map<string, CommandRouteEntry>;
  private allDeviceIndex: Map<string, { connectionId: string; protocol: string; role: string }>;

  constructor(
    routeMap: Map<string, CommandRouteEntry>,
    allDeviceIndex: Map<string, { connectionId: string; protocol: string; role: string }>,
  ) {
    this.routeMap = routeMap;
    this.allDeviceIndex = allDeviceIndex;
  }

  async handleCommand(payload: CommandPayload): Promise<CommandResult> {
    const { deviceId, action } = payload;
    log.info({ deviceId, action }, 'Nhận command');

    // Tìm route cho device này
    const route = this.routeMap.get(deviceId);

    if (!route) {
      // Kiểm tra device có tồn tại nhưng là telemetry-only
      const deviceInfo = this.allDeviceIndex.get(deviceId);
      if (deviceInfo && deviceInfo.role === 'telemetry') {
        const msg = `Device "${deviceId}" là telemetry-only (connection: ${deviceInfo.connectionId}, protocol: ${deviceInfo.protocol}), không hỗ trợ command.`;
        log.warn({ deviceId, connectionId: deviceInfo.connectionId }, msg);
        throw new CommandValidationError(msg);
      }

      const msg = `Device không tồn tại: ${deviceId}`;
      log.warn({ deviceId }, msg);
      throw new CommandValidationError(msg);
    }

    // Map action → value theo dataType
    const value = this.mapActionToValue(action, route.device.dataType);

    // Ghi giá trị qua OPC UA
    await route.client.writeValue(route.device.nodeId, value, route.device.dataType);

    const msg = `Command ${action} cho ${deviceId} thành công (connection: ${route.connectionId})`;
    log.info({ deviceId, action, connectionId: route.connectionId, nodeId: route.device.nodeId }, msg);
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
          throw new CommandValidationError(
            `Action không hợp lệ cho Boolean: ${action}. Chỉ hỗ trợ START/STOP`,
          );
      }
    }
    throw new CommandValidationError(`DataType chưa hỗ trợ mapping action: ${dataType}`);
  }
}
