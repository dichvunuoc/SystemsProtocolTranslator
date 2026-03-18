import logger from '../utils/logger.js';
import { OpcuaClient } from './opcua-client.js';
import type { OpcuaCommandDevice, ProfinetCommandDevice, ProfinetDataType } from '../config/device-map.schema.js';
import { ProfinetClient } from '../telemetry/profinet-client.js';

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
  protocol: 'opcua' | 'modbus' | 'profinet';
  client: OpcuaClient | ProfinetClient;
  device: OpcuaCommandDevice | ProfinetCommandDevice;
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

    if (route.protocol === 'profinet') {
      const client = route.client as ProfinetClient;
      const device = route.device as ProfinetCommandDevice;
      const buffer = this.valueToBuffer(value, device.dataType);
      await client.writeData(device.slot, device.subslot, device.index, buffer);
    } else {
      const client = route.client as OpcuaClient;
      const device = route.device as OpcuaCommandDevice;
      await client.writeValue(device.nodeId, value, device.dataType);
    }

    const msg = `Command ${action} cho ${deviceId} thành công (connection: ${route.connectionId})`;
    log.info({ deviceId, action, connectionId: route.connectionId }, msg);
    return { success: true, message: msg };
  }

  private mapActionToValue(action: string, dataType: string): boolean | number {
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

  private valueToBuffer(value: boolean | number, dataType: ProfinetDataType): Buffer {
    switch (dataType) {
      case 'Boolean': {
        const buf = Buffer.alloc(1);
        buf.writeUInt8(value ? 1 : 0, 0);
        return buf;
      }
      case 'Float32': {
        if (typeof value !== 'number') throw new CommandValidationError(`Float32 cần giá trị number, nhận: ${typeof value}`);
        const buf = Buffer.alloc(4);
        buf.writeFloatBE(value, 0);
        return buf;
      }
      case 'UInt16': {
        if (typeof value !== 'number') throw new CommandValidationError(`UInt16 cần giá trị number, nhận: ${typeof value}`);
        const buf = Buffer.alloc(2);
        buf.writeUInt16BE(value, 0);
        return buf;
      }
      case 'UInt32': {
        if (typeof value !== 'number') throw new CommandValidationError(`UInt32 cần giá trị number, nhận: ${typeof value}`);
        const buf = Buffer.alloc(4);
        buf.writeUInt32BE(value, 0);
        return buf;
      }
      case 'Int16': {
        if (typeof value !== 'number') throw new CommandValidationError(`Int16 cần giá trị number, nhận: ${typeof value}`);
        const buf = Buffer.alloc(2);
        buf.writeInt16BE(value, 0);
        return buf;
      }
      case 'Int32': {
        if (typeof value !== 'number') throw new CommandValidationError(`Int32 cần giá trị number, nhận: ${typeof value}`);
        const buf = Buffer.alloc(4);
        buf.writeInt32BE(value, 0);
        return buf;
      }
      default:
        throw new CommandValidationError(`Profinet dataType không hỗ trợ: ${dataType}`);
    }
  }
}
