// --- Shared Types ---

export interface ReconnectConfig {
  baseMs: number;
  maxMs: number;
}

// --- OPC UA Security ---

export type OpcuaSecurityMode = 'None' | 'Sign' | 'SignAndEncrypt';
export type OpcuaSecurityPolicy =
  | 'None'
  | 'Basic128Rsa15'
  | 'Basic256'
  | 'Basic256Sha256'
  | 'Aes128_Sha256_RsaOaep'
  | 'Aes256_Sha256_RsaPss';

export type OpcuaAuth =
  | { type: 'anonymous' }
  | { type: 'username'; username: string; password: string };

export interface OpcuaSecurityConfig {
  /**
   * Message security mode cho kênh OPC UA.
   * - None: không ký/không mã hoá
   * - Sign: ký (integrity)
   * - SignAndEncrypt: ký + mã hoá (integrity + confidentiality)
   */
  mode?: OpcuaSecurityMode;
  /**
   * Security policy.
   * Lưu ý: policy phải khớp với server endpoint bạn chọn.
   */
  policy?: OpcuaSecurityPolicy;
  /**
   * Đường dẫn file certificate PEM/DER của client (tuỳ server yêu cầu).
   */
  certificateFile?: string;
  /**
   * Đường dẫn file private key PEM của client (tuỳ server yêu cầu).
   */
  privateKeyFile?: string;
  /**
   * Xác thực user (nếu server bật).
   */
  auth?: OpcuaAuth;
}

// --- Telemetry Device Interfaces ---

export interface ModbusTelemetryDevice {
  deviceId: string;
  register: number;
  length: number;
  dataType: 'Float32' | 'UInt16';
  wordOrder: 'AB_CD' | 'CD_AB' | 'BA_DC' | 'DC_BA';
  unit: string;
  description: string;
}

export interface OpcuaTelemetryDevice {
  deviceId: string;
  nodeId: string;
  dataType: string;
  unit: string;
  description: string;
}

// --- Command Device Interfaces ---

export interface ModbusCommandDevice {
  deviceId: string;
  register: number;
  length: number;
  dataType: 'Float32' | 'UInt16';
  wordOrder: 'AB_CD' | 'CD_AB' | 'BA_DC' | 'DC_BA';
  description: string;
}

export interface OpcuaCommandDevice {
  deviceId: string;
  nodeId: string;
  dataType: string;
  description: string;
}

// --- Connection Interfaces ---

export interface ModbusConnection {
  connectionId: string;
  protocol: 'modbus';
  description: string;
  host: string;
  port: number;
  unitId: number;
  pollIntervalMs: number;
  telemetry: ModbusTelemetryDevice[];
  commands: ModbusCommandDevice[];
}

export interface OpcuaConnection {
  connectionId: string;
  protocol: 'opcua';
  description: string;
  endpoint: string;
  security?: OpcuaSecurityConfig;
  telemetry: OpcuaTelemetryDevice[];
  commands: OpcuaCommandDevice[];
}

export type ConnectionConfig = ModbusConnection | OpcuaConnection;

export interface DeviceMap {
  connections: ConnectionConfig[];
}

// --- Validation helpers ---

const VALID_MODBUS_DATA_TYPES = ['Float32', 'UInt16'];
const VALID_WORD_ORDERS = ['AB_CD', 'CD_AB', 'BA_DC', 'DC_BA'];

function validateModbusTelemetryDevice(device: Record<string, unknown>, connectionId: string): ModbusTelemetryDevice {
  if (typeof device.deviceId !== 'string' || device.deviceId.length === 0) {
    throw new Error(`Telemetry device trong Modbus connection "${connectionId}" có deviceId không hợp lệ`);
  }
  if (typeof device.register !== 'number') {
    throw new Error(`Telemetry device "${device.deviceId}" trong "${connectionId}" thiếu hoặc sai kiểu register`);
  }
  if (typeof device.length !== 'number') {
    throw new Error(`Telemetry device "${device.deviceId}" trong "${connectionId}" thiếu hoặc sai kiểu length`);
  }
  if (typeof device.dataType !== 'string' || !VALID_MODBUS_DATA_TYPES.includes(device.dataType)) {
    throw new Error(`Telemetry device "${device.deviceId}" trong "${connectionId}" có dataType không hợp lệ: ${device.dataType}`);
  }
  if (typeof device.wordOrder !== 'string' || !VALID_WORD_ORDERS.includes(device.wordOrder)) {
    throw new Error(`Telemetry device "${device.deviceId}" trong "${connectionId}" có wordOrder không hợp lệ: ${device.wordOrder}`);
  }
  if (typeof device.unit !== 'string') {
    throw new Error(`Telemetry device "${device.deviceId}" trong "${connectionId}" thiếu unit`);
  }
  if (typeof device.description !== 'string') {
    throw new Error(`Telemetry device "${device.deviceId}" trong "${connectionId}" thiếu description`);
  }
  return {
    deviceId: device.deviceId,
    register: device.register,
    length: device.length,
    dataType: device.dataType as ModbusTelemetryDevice['dataType'],
    wordOrder: device.wordOrder as ModbusTelemetryDevice['wordOrder'],
    unit: device.unit,
    description: device.description,
  };
}

function validateModbusCommandDevice(device: Record<string, unknown>, connectionId: string): ModbusCommandDevice {
  if (typeof device.deviceId !== 'string' || device.deviceId.length === 0) {
    throw new Error(`Command device trong Modbus connection "${connectionId}" có deviceId không hợp lệ`);
  }
  if (typeof device.register !== 'number') {
    throw new Error(`Command device "${device.deviceId}" trong "${connectionId}" thiếu hoặc sai kiểu register`);
  }
  if (typeof device.length !== 'number') {
    throw new Error(`Command device "${device.deviceId}" trong "${connectionId}" thiếu hoặc sai kiểu length`);
  }
  if (typeof device.dataType !== 'string' || !VALID_MODBUS_DATA_TYPES.includes(device.dataType)) {
    throw new Error(`Command device "${device.deviceId}" trong "${connectionId}" có dataType không hợp lệ: ${device.dataType}`);
  }
  if (typeof device.wordOrder !== 'string' || !VALID_WORD_ORDERS.includes(device.wordOrder)) {
    throw new Error(`Command device "${device.deviceId}" trong "${connectionId}" có wordOrder không hợp lệ: ${device.wordOrder}`);
  }
  if (typeof device.description !== 'string') {
    throw new Error(`Command device "${device.deviceId}" trong "${connectionId}" thiếu description`);
  }
  return {
    deviceId: device.deviceId,
    register: device.register,
    length: device.length,
    dataType: device.dataType as ModbusCommandDevice['dataType'],
    wordOrder: device.wordOrder as ModbusCommandDevice['wordOrder'],
    description: device.description,
  };
}

function validateOpcuaTelemetryDevice(device: Record<string, unknown>, connectionId: string): OpcuaTelemetryDevice {
  if (typeof device.deviceId !== 'string' || device.deviceId.length === 0) {
    throw new Error(`Telemetry device trong OPC UA connection "${connectionId}" có deviceId không hợp lệ`);
  }
  if (typeof device.nodeId !== 'string' || device.nodeId.length === 0) {
    throw new Error(`Telemetry device "${device.deviceId}" trong "${connectionId}" thiếu nodeId`);
  }
  if (typeof device.dataType !== 'string') {
    throw new Error(`Telemetry device "${device.deviceId}" trong "${connectionId}" thiếu dataType`);
  }
  if (typeof device.unit !== 'string') {
    throw new Error(`Telemetry device "${device.deviceId}" trong "${connectionId}" thiếu unit`);
  }
  if (typeof device.description !== 'string') {
    throw new Error(`Telemetry device "${device.deviceId}" trong "${connectionId}" thiếu description`);
  }
  return {
    deviceId: device.deviceId,
    nodeId: device.nodeId,
    dataType: device.dataType,
    unit: device.unit,
    description: device.description,
  };
}

function validateOpcuaCommandDevice(device: Record<string, unknown>, connectionId: string): OpcuaCommandDevice {
  if (typeof device.deviceId !== 'string' || device.deviceId.length === 0) {
    throw new Error(`Command device trong OPC UA connection "${connectionId}" có deviceId không hợp lệ`);
  }
  if (typeof device.nodeId !== 'string' || device.nodeId.length === 0) {
    throw new Error(`Command device "${device.deviceId}" trong "${connectionId}" thiếu nodeId`);
  }
  if (typeof device.dataType !== 'string') {
    throw new Error(`Command device "${device.deviceId}" trong "${connectionId}" thiếu dataType`);
  }
  if (typeof device.description !== 'string') {
    throw new Error(`Command device "${device.deviceId}" trong "${connectionId}" thiếu description`);
  }
  return {
    deviceId: device.deviceId,
    nodeId: device.nodeId,
    dataType: device.dataType,
    description: device.description,
  };
}

function validateOpcuaSecurityConfig(raw: unknown, connectionId: string): OpcuaSecurityConfig {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object') {
    throw new Error(`OPC UA connection "${connectionId}" có security không hợp lệ: phải là object`);
  }
  const s = raw as Record<string, unknown>;

  const out: OpcuaSecurityConfig = {};

  if (s.mode !== undefined) {
    if (typeof s.mode !== 'string' || !['None', 'Sign', 'SignAndEncrypt'].includes(s.mode)) {
      throw new Error(`OPC UA connection "${connectionId}" có security.mode không hợp lệ: ${String(s.mode)}`);
    }
    out.mode = s.mode as OpcuaSecurityMode;
  }

  if (s.policy !== undefined) {
    const allowedPolicies: OpcuaSecurityPolicy[] = [
      'None',
      'Basic128Rsa15',
      'Basic256',
      'Basic256Sha256',
      'Aes128_Sha256_RsaOaep',
      'Aes256_Sha256_RsaPss',
    ];
    if (typeof s.policy !== 'string' || !allowedPolicies.includes(s.policy as OpcuaSecurityPolicy)) {
      throw new Error(`OPC UA connection "${connectionId}" có security.policy không hợp lệ: ${String(s.policy)}`);
    }
    out.policy = s.policy as OpcuaSecurityPolicy;
  }

  if (s.certificateFile !== undefined) {
    if (typeof s.certificateFile !== 'string' || s.certificateFile.length === 0) {
      throw new Error(`OPC UA connection "${connectionId}" có security.certificateFile không hợp lệ`);
    }
    out.certificateFile = s.certificateFile;
  }

  if (s.privateKeyFile !== undefined) {
    if (typeof s.privateKeyFile !== 'string' || s.privateKeyFile.length === 0) {
      throw new Error(`OPC UA connection "${connectionId}" có security.privateKeyFile không hợp lệ`);
    }
    out.privateKeyFile = s.privateKeyFile;
  }

  if (s.auth !== undefined) {
    if (!s.auth || typeof s.auth !== 'object') {
      throw new Error(`OPC UA connection "${connectionId}" có security.auth không hợp lệ: phải là object`);
    }
    const a = s.auth as Record<string, unknown>;
    if (typeof a.type !== 'string' || !['anonymous', 'username'].includes(a.type)) {
      throw new Error(`OPC UA connection "${connectionId}" có security.auth.type không hợp lệ: ${String(a.type)}`);
    }
    if (a.type === 'anonymous') {
      out.auth = { type: 'anonymous' };
    } else {
      if (typeof a.username !== 'string' || a.username.length === 0) {
        throw new Error(`OPC UA connection "${connectionId}" có security.auth.username không hợp lệ`);
      }
      if (typeof a.password !== 'string') {
        throw new Error(`OPC UA connection "${connectionId}" có security.auth.password không hợp lệ`);
      }
      out.auth = { type: 'username', username: a.username, password: a.password };
    }
  }

  return out;
}

// --- Main Validation ---

/**
 * Validate và parse device-map JSON thành DeviceMap typed object.
 * Throw error nếu schema không hợp lệ, connectionId trùng, hoặc deviceId trùng.
 * Trả về object mới (không phải type assertion trên raw input).
 */
export function validateDeviceMap(raw: unknown): DeviceMap {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Device map không hợp lệ: phải là object');
  }

  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.connections) || obj.connections.length === 0) {
    throw new Error('Device map không hợp lệ: connections phải là array không rỗng');
  }

  const connectionIds = new Set<string>();
  const deviceIdMap = new Map<string, string>(); // deviceId → connectionId
  const validatedConnections: ConnectionConfig[] = [];

  for (const conn of obj.connections) {
    if (!conn || typeof conn !== 'object') {
      throw new Error('Connection entry không hợp lệ: phải là object');
    }

    const c = conn as Record<string, unknown>;

    if (typeof c.connectionId !== 'string' || c.connectionId.length === 0) {
      throw new Error('Connection thiếu connectionId');
    }

    if (connectionIds.has(c.connectionId)) {
      throw new Error(`connectionId trùng: "${c.connectionId}"`);
    }
    connectionIds.add(c.connectionId);

    if (typeof c.protocol !== 'string') {
      throw new Error(`Connection "${c.connectionId}" thiếu protocol`);
    }

    // Validate telemetry + commands arrays
    const telemetryArr = Array.isArray(c.telemetry) ? c.telemetry : [];
    const commandsArr = Array.isArray(c.commands) ? c.commands : [];

    if (telemetryArr.length === 0 && commandsArr.length === 0) {
      throw new Error(`Connection "${c.connectionId}" phải có ít nhất 1 telemetry hoặc command device`);
    }

    // Validate + construct theo protocol
    if (c.protocol === 'modbus') {
      if (typeof c.host !== 'string' || c.host.length === 0) {
        throw new Error(`Modbus connection "${c.connectionId}" thiếu host`);
      }
      if (typeof c.port !== 'number') {
        throw new Error(`Modbus connection "${c.connectionId}" thiếu port`);
      }
      if (typeof c.unitId !== 'number') {
        throw new Error(`Modbus connection "${c.connectionId}" thiếu unitId`);
      }
      if (telemetryArr.length > 0 && typeof c.pollIntervalMs !== 'number') {
        throw new Error(`Modbus connection "${c.connectionId}" có telemetry devices nhưng thiếu pollIntervalMs`);
      }

      const telemetry: ModbusTelemetryDevice[] = [];
      for (const d of telemetryArr as unknown[]) {
        telemetry.push(validateModbusTelemetryDevice(d as Record<string, unknown>, c.connectionId));
      }

      const commands: ModbusCommandDevice[] = [];
      for (const d of commandsArr as unknown[]) {
        commands.push(validateModbusCommandDevice(d as Record<string, unknown>, c.connectionId));
      }

      validatedConnections.push({
        connectionId: c.connectionId,
        protocol: 'modbus',
        description: (c.description as string) || '',
        host: c.host,
        port: c.port,
        unitId: c.unitId,
        pollIntervalMs: (c.pollIntervalMs as number) || 0,
        telemetry,
        commands,
      });
    } else if (c.protocol === 'opcua') {
      if (typeof c.endpoint !== 'string' || c.endpoint.length === 0) {
        throw new Error(`OPC UA connection "${c.connectionId}" thiếu endpoint`);
      }

      const security = validateOpcuaSecurityConfig(c.security, c.connectionId);

      const telemetry: OpcuaTelemetryDevice[] = [];
      for (const d of telemetryArr as unknown[]) {
        telemetry.push(validateOpcuaTelemetryDevice(d as Record<string, unknown>, c.connectionId));
      }

      const commands: OpcuaCommandDevice[] = [];
      for (const d of commandsArr as unknown[]) {
        commands.push(validateOpcuaCommandDevice(d as Record<string, unknown>, c.connectionId));
      }

      validatedConnections.push({
        connectionId: c.connectionId,
        protocol: 'opcua',
        description: (c.description as string) || '',
        endpoint: c.endpoint,
        security,
        telemetry,
        commands,
      });
    } else {
      throw new Error(
        `Protocol không hợp lệ: "${c.protocol}" trong connection "${c.connectionId}". Chỉ hỗ trợ "modbus" và "opcua"`,
      );
    }

    // Kiểm tra deviceId unique across ALL connections và ALL roles
    const allDevices = [...telemetryArr, ...commandsArr] as Array<Record<string, unknown>>;
    for (const d of allDevices) {
      const deviceId = typeof d.deviceId === 'string' ? d.deviceId : '';
      if (!deviceId) continue;

      const existingConn = deviceIdMap.get(deviceId);
      if (existingConn) {
        throw new Error(
          `deviceId trùng: "${deviceId}" xuất hiện trong cả connection "${existingConn}" và "${c.connectionId}"`,
        );
      }
      deviceIdMap.set(deviceId, c.connectionId);
    }
  }

  return { connections: validatedConnections };
}

/**
 * Build index tra cứu nhanh deviceId → { connectionId, protocol, role }
 */
export function buildDeviceIndex(
  deviceMap: DeviceMap,
): Map<string, { connectionId: string; protocol: string; role: 'telemetry' | 'command' }> {
  const index = new Map<string, { connectionId: string; protocol: string; role: 'telemetry' | 'command' }>();

  for (const conn of deviceMap.connections) {
    for (const device of conn.telemetry) {
      index.set(device.deviceId, {
        connectionId: conn.connectionId,
        protocol: conn.protocol,
        role: 'telemetry',
      });
    }
    for (const device of conn.commands) {
      index.set(device.deviceId, {
        connectionId: conn.connectionId,
        protocol: conn.protocol,
        role: 'command',
      });
    }
  }

  return index;
}
