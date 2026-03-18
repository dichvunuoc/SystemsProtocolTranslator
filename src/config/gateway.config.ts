export const gatewayConfig = {
  restPort: parseInt(process.env.REST_PORT || '3000', 10),
  wsPort: parseInt(process.env.WS_PORT || '3001', 10),
  reconnectBaseMs: parseInt(process.env.RECONNECT_BASE_MS || '1000', 10),
  reconnectMaxMs: parseInt(process.env.RECONNECT_MAX_MS || '30000', 10),
} as const;

export type GatewayConfig = typeof gatewayConfig;
