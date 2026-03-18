import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from './utils/logger.js';
import { gatewayConfig } from './config/gateway.config.js';
import { validateDeviceMap, buildDeviceIndex, type ModbusConnection, type OpcuaConnection } from './config/device-map.schema.js';
import { ModbusClient } from './telemetry/modbus-client.js';
import { TelemetryPoller } from './telemetry/telemetry-poller.js';
import { OpcuaClient } from './command/opcua-client.js';
import { OpcuaTelemetrySubscriber } from './telemetry/opcua-telemetry-subscriber.js';
import { CommandHandler, type CommandRouteEntry } from './command/command-handler.js';
import type { OpcuaCommandDevice } from './config/device-map.schema.js';  // F9: single source of truth
import { WsServer } from './transport/ws-server.js';
import { createRestServer, type ConnectionStatus } from './transport/rest-server.js';

const log = logger.child({ module: 'main' });

async function main() {
  log.info('=== Protocol Translator Edge Gateway — Multi-PLC ===');
  log.info(gatewayConfig, 'Cấu hình gateway');

  // 1. Load và validate device map
  const __dirname = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
  const deviceMapPath = process.env.DEVICE_MAP_PATH
    ? resolve(process.env.DEVICE_MAP_PATH)
    : resolve(__dirname, 'config/device-map.json');
  const rawDeviceMap = JSON.parse(readFileSync(deviceMapPath, 'utf-8'));
  const deviceMap = validateDeviceMap(rawDeviceMap);
  const allDeviceIndex = buildDeviceIndex(deviceMap);

  log.info(
    { connectionCount: deviceMap.connections.length, deviceCount: allDeviceIndex.size },
    'Đã load và validate device map',
  );

  // 2. Khởi tạo collections
  const modbusClients = new Map<string, ModbusClient>();
  const opcuaClients = new Map<string, OpcuaClient>();
  const telemetrySources: EventEmitter[] = [];
  const telemetryPollers: TelemetryPoller[] = [];
  const opcuaSubscribers: OpcuaTelemetrySubscriber[] = [];
  const connectionStatuses: ConnectionStatus[] = [];
  // F13: Tạo copy riêng cho mỗi client thay vì shared reference
  const makeReconnectConfig = () => ({
    baseMs: gatewayConfig.reconnectBaseMs,
    maxMs: gatewayConfig.reconnectMaxMs,
  });

  // 3. Loop qua connections — tạo clients
  for (const conn of deviceMap.connections) {
    if (conn.protocol === 'modbus') {
      // F3: Hỗ trợ Modbus connections
      const mc = conn as ModbusConnection;
      const client = new ModbusClient(mc.connectionId, mc.host, mc.port, mc.unitId, makeReconnectConfig());

      modbusClients.set(mc.connectionId, client);
      connectionStatuses.push({
        connectionId: mc.connectionId,
        protocol: 'modbus',
        isConnected: () => client.isConnected(),
      });

      // Tạo Modbus telemetry poller nếu có telemetry devices
      if (mc.telemetry.length > 0) {
        const poller = new TelemetryPoller(mc.connectionId, client, mc.telemetry, mc.pollIntervalMs);
        telemetryPollers.push(poller);
        telemetrySources.push(poller);

        client.on('connected', () => {
          log.info({ connectionId: mc.connectionId }, 'Modbus đã kết nối — bắt đầu polling telemetry');
          poller.start();
        });
        client.on('disconnected', () => {
          poller.stop();
        });
      }

      log.info({ connectionId: mc.connectionId, host: mc.host, port: mc.port }, 'Đã khởi tạo Modbus connection');
    } else if (conn.protocol === 'opcua') {
      const oc = conn as OpcuaConnection;
      const client = new OpcuaClient(oc.connectionId, oc.endpoint, makeReconnectConfig(), oc.security);

      opcuaClients.set(oc.connectionId, client);
      connectionStatuses.push({
        connectionId: oc.connectionId,
        protocol: 'opcua',
        isConnected: () => client.isConnected(),
      });

      // Tạo OPC UA telemetry subscriber nếu có telemetry devices
      if (oc.telemetry.length > 0) {
        const subscriber = new OpcuaTelemetrySubscriber(oc.connectionId, client, oc.telemetry);
        opcuaSubscribers.push(subscriber);
        telemetrySources.push(subscriber);

        client.on('connected', () => {
          log.info({ connectionId: oc.connectionId }, 'OPC UA đã kết nối — bắt đầu telemetry subscription');
          subscriber.start().catch((err) => {
            log.error({ connectionId: oc.connectionId, err }, 'Lỗi bắt đầu OPC UA subscription');
          });
        });
        client.on('disconnected', () => {
          subscriber.stop().catch(() => {});
        });
      }

      log.info({ connectionId: oc.connectionId, endpoint: oc.endpoint }, 'Đã khởi tạo OPC UA connection');
    }
  }

  // 4. Build command route map từ tất cả connections có commands
  const commandRouteMap = new Map<string, CommandRouteEntry>();
  for (const conn of deviceMap.connections) {
    if (conn.protocol === 'opcua' && conn.commands.length > 0) {
      const oc = conn as OpcuaConnection;
      const client = opcuaClients.get(oc.connectionId)!;
      for (const device of oc.commands) {
        commandRouteMap.set(device.deviceId, {
          connectionId: oc.connectionId,
          protocol: 'opcua',
          client,
          device: device as OpcuaCommandDevice,
        });
      }
    }
  }

  // 5. Kết nối tất cả clients (non-blocking — reconnect tự động trong background)
  for (const [connId, client] of modbusClients) {
    client.connect().catch((err) => {
      log.warn({ connectionId: connId, err }, 'Kết nối Modbus ban đầu thất bại — sẽ tự reconnect');
    });
  }
  for (const [connId, client] of opcuaClients) {
    client.connect().catch((err) => {
      log.warn({ connectionId: connId, err }, 'Kết nối OPC UA ban đầu thất bại — sẽ tự reconnect');
    });
  }

  // 6. Khởi tạo Command Handler
  const commandHandler = new CommandHandler(commandRouteMap, allDeviceIndex);

  // 7. Khởi tạo WebSocket Server — subscribe tất cả telemetry sources
  const wsServer = new WsServer(gatewayConfig.wsPort, telemetrySources);

  // 8. Khởi tạo REST Server
  const startTime = Date.now();
  const restApp = createRestServer({
    commandHandler,
    connections: connectionStatuses,
    deviceMap,
    startTime,
  });
  const restServer = restApp.listen(gatewayConfig.restPort, () => {
    log.info({ port: gatewayConfig.restPort }, 'REST server đã khởi động');
  });

  log.info(
    {
      modbusConnections: modbusClients.size,
      opcuaConnections: opcuaClients.size,
      totalDevices: allDeviceIndex.size,
      telemetrySources: telemetrySources.length,
    },
    'Gateway đã khởi động — đang chờ kết nối tới thiết bị...',
  );

  // 9. Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Nhận tín hiệu tắt — đang dọn dẹp...');

    // F6: Timeout an toàn — buộc thoát sau 10s, unref để không block event loop
    const forceExitTimer = setTimeout(() => {
      log.error('Shutdown timeout 10s — buộc thoát');
      process.exit(1);
    }, 10_000);
    forceExitTimer.unref();

    try {
      // Dừng tất cả pollers + subscribers
      for (const poller of telemetryPollers) {
        poller.stop();
      }
      for (const subscriber of opcuaSubscribers) {
        await subscriber.stop().catch(() => {});
      }
      // Đóng transport
      wsServer.close();
      await new Promise<void>((resolve) => restServer.close(() => resolve()));
      // Đóng tất cả connections song song
      const disconnectResults = await Promise.allSettled([
        ...Array.from(modbusClients.values()).map((c) => c.disconnect()),
        ...Array.from(opcuaClients.values()).map((c) => c.disconnect()),
      ]);
      const failures = disconnectResults.filter((r) => r.status === 'rejected');
      if (failures.length > 0) {
        log.warn({ failureCount: failures.length }, 'Một số connections đóng thất bại');
      }
      log.info('Gateway đã tắt sạch');
    } catch (err) {
      log.error({ err }, 'Lỗi khi tắt gateway — buộc thoát');
    }

    clearTimeout(forceExitTimer);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.fatal({ err }, 'Lỗi nghiêm trọng khi khởi động gateway');
  process.exit(1);
});
