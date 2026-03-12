export const gatewayConfig = {
  opcuaEndpoint: process.env.OPCUA_ENDPOINT || 'opc.tcp://localhost:4840',
  modbusHost: process.env.MODBUS_HOST || 'localhost',
  modbusPort: parseInt(process.env.MODBUS_PORT || '502', 10),
  restPort: parseInt(process.env.REST_PORT || '3000', 10),
  wsPort: parseInt(process.env.WS_PORT || '3001', 10),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '1000', 10),
  reconnectBaseMs: parseInt(process.env.RECONNECT_BASE_MS || '1000', 10),
  reconnectMaxMs: parseInt(process.env.RECONNECT_MAX_MS || '30000', 10),
} as const;

export type GatewayConfig = typeof gatewayConfig;
