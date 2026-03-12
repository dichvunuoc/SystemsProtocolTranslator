import { readFileSync } from 'fs';
import { resolve } from 'path';
import logger from './utils/logger.js';
import { gatewayConfig } from './config/gateway.config.js';
import { ModbusClient } from './telemetry/modbus-client.js';
import { TelemetryPoller } from './telemetry/telemetry-poller.js';
import { OpcuaClient } from './command/opcua-client.js';
import { CommandHandler } from './command/command-handler.js';
import { WsServer } from './transport/ws-server.js';
import { createRestServer } from './transport/rest-server.js';

const log = logger.child({ module: 'main' });

async function main() {
  log.info('=== Protocol Translator Edge Gateway ===');
  log.info(gatewayConfig, 'Cấu hình gateway');

  // 1. Load device map
  const deviceMapPath = resolve(import.meta.dirname, 'config/device-map.json');
  const deviceMap = JSON.parse(readFileSync(deviceMapPath, 'utf-8'));
  log.info(
    {
      opcuaDevices: deviceMap.opcua.devices.length,
      modbusDevices: deviceMap.modbus.devices.length,
    },
    'Đã load device map',
  );

  // 2. Khởi tạo Modbus Client
  const modbusClient = new ModbusClient(
    gatewayConfig.modbusHost,
    gatewayConfig.modbusPort,
    deviceMap.modbus.unitId,
  );

  // 3. Khởi tạo OPC UA Client
  const opcuaClient = new OpcuaClient(gatewayConfig.opcuaEndpoint);

  // 4. Khởi tạo Telemetry Poller — chỉ start khi Modbus connected
  const telemetryPoller = new TelemetryPoller(
    modbusClient,
    deviceMap.modbus.devices,
    gatewayConfig.pollIntervalMs,
  );

  // Bắt đầu polling khi Modbus kết nối, dừng khi mất kết nối
  modbusClient.on('connected', () => {
    log.info('Modbus đã kết nối — bắt đầu polling telemetry');
    telemetryPoller.start();
  });
  modbusClient.on('disconnected', () => {
    telemetryPoller.stop();
  });

  // Kết nối không blocking — nếu chưa ready sẽ tự reconnect
  modbusClient.connect().catch(() => {});
  opcuaClient.connect().catch(() => {});

  // 5. Khởi tạo Command Handler
  const commandHandler = new CommandHandler(
    opcuaClient,
    deviceMap.opcua.devices,
  );

  // 6. Khởi tạo WebSocket Server
  const wsServer = new WsServer(gatewayConfig.wsPort, telemetryPoller);

  // 7. Khởi tạo REST Server
  const restApp = createRestServer({
    commandHandler,
    opcuaClient,
    modbusClient,
    deviceMap,
  });
  const restServer = restApp.listen(gatewayConfig.restPort, () => {
    log.info({ port: gatewayConfig.restPort }, 'REST server đã khởi động');
  });

  log.info('Gateway đã khởi động — đang chờ kết nối tới thiết bị...');

  // 8. Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Nhận tín hiệu tắt — đang dọn dẹp...');

    try {
      telemetryPoller.stop();
      wsServer.close();
      await new Promise<void>((resolve) => restServer.close(() => resolve()));
      await modbusClient.disconnect();
      await opcuaClient.disconnect();
      log.info('Gateway đã tắt sạch');
    } catch (err) {
      log.error({ err }, 'Lỗi khi tắt gateway — buộc thoát');
    }

    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.fatal({ err }, 'Lỗi nghiêm trọng khi khởi động gateway');
  process.exit(1);
});
