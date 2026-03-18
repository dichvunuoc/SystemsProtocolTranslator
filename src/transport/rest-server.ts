import express, { type Request, type Response } from 'express';
import logger from '../utils/logger.js';
import { CommandHandler, CommandValidationError } from '../command/command-handler.js';
import type { DeviceMap } from '../config/device-map.schema.js';

const log = logger.child({ module: 'rest-server' });

// Giới hạn độ dài input — ngăn chặn payload quá lớn hoặc injection
const MAX_DEVICE_ID_LENGTH = 64;
const MAX_ACTION_LENGTH = 32;

export interface ConnectionStatus {
  connectionId: string;
  protocol: 'opcua' | 'modbus';
  isConnected: () => boolean;
}

export interface RestServerDeps {
  commandHandler: CommandHandler;
  connections: ConnectionStatus[];
  deviceMap: DeviceMap;
  startTime?: number;
}

export function createRestServer(deps: RestServerDeps) {
  const app = express();
  const startTime = deps.startTime ?? Date.now();

  // Giới hạn body size 1KB — edge gateway chỉ nhận payload nhỏ
  app.use(express.json({ limit: '1kb' }));

  // POST /api/command — Gửi lệnh điều khiển thiết bị
  app.post('/api/command', async (req: Request, res: Response) => {
    const { deviceId, action } = req.body;

    if (!deviceId || !action) {
      log.warn('Thiếu deviceId hoặc action');
      res.status(400).json({
        success: false,
        message: 'Thiếu trường bắt buộc: deviceId và action',
      });
      return;
    }

    // Validate input — chỉ cho phép alphanumeric và underscore
    if (
      typeof deviceId !== 'string' ||
      typeof action !== 'string' ||
      deviceId.length > MAX_DEVICE_ID_LENGTH ||
      action.length > MAX_ACTION_LENGTH ||
      !/^[A-Za-z0-9_]+$/.test(deviceId) ||
      !/^[A-Za-z0-9_]+$/.test(action)
    ) {
      log.warn('Input không hợp lệ — chỉ cho phép ký tự alphanumeric và underscore');
      res.status(400).json({
        success: false,
        message: 'Input không hợp lệ: deviceId và action chỉ chấp nhận ký tự alphanumeric và underscore',
      });
      return;
    }

    try {
      const result = await deps.commandHandler.handleCommand({
        deviceId,
        action,
      });
      log.info({ deviceId, action }, 'Command xử lý thành công');
      res.json(result);
    } catch (err: any) {
      const message = err.message || 'Lỗi không xác định';
      if (err instanceof CommandValidationError) {
        log.warn({ deviceId, action, error: message }, 'Command không hợp lệ');
        res.status(400).json({ success: false, message });
      } else {
        log.error({ deviceId, action, error: message }, 'Lỗi xử lý command');
        res.status(500).json({ success: false, message });
      }
    }
  });

  // GET /api/health — Kiểm tra trạng thái gateway (multi-connection)
  // F7: Trả HTTP status phản ánh tình trạng thực tế
  app.get('/api/health', (_req: Request, res: Response) => {
    const connections: Record<string, { protocol: string; status: string }> = {};
    let connectedCount = 0;
    const totalCount = deps.connections.length;

    for (const conn of deps.connections) {
      const isConn = conn.isConnected();
      if (isConn) connectedCount++;
      connections[conn.connectionId] = {
        protocol: conn.protocol,
        status: isConn ? 'connected' : 'disconnected',
      };
    }

    const overallStatus = totalCount === 0 ? 'unknown'
      : connectedCount === totalCount ? 'healthy'
      : connectedCount > 0 ? 'degraded'
      : 'unhealthy';

    const status = {
      status: overallStatus,
      connections,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    };
    log.debug(status, 'Health check');

    const httpStatus = overallStatus === 'unhealthy' ? 503 : 200;
    res.status(httpStatus).json(status);
  });

  // GET /api/devices — Danh sách tất cả devices (F15: ẩn internal endpoints)
  app.get('/api/devices', (_req: Request, res: Response) => {
    const sanitized = {
      connections: deps.deviceMap.connections.map((conn) => ({
        connectionId: conn.connectionId,
        protocol: conn.protocol,
        description: conn.description,
        telemetry: conn.telemetry.map((d) => ({
          deviceId: d.deviceId,
          unit: 'unit' in d ? d.unit : undefined,
          description: d.description,
        })),
        commands: conn.commands.map((d) => ({
          deviceId: d.deviceId,
          description: d.description,
        })),
      })),
    };
    res.json(sanitized);
  });

  return app;
}
