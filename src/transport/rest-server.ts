import express, { type Request, type Response } from 'express';
import logger from '../utils/logger.js';
import { CommandHandler } from '../command/command-handler.js';
import type { OpcuaClient } from '../command/opcua-client.js';
import type { ModbusClient } from '../telemetry/modbus-client.js';

const log = logger.child({ module: 'rest-server' });

// Giới hạn độ dài input — ngăn chặn payload quá lớn hoặc injection
const MAX_DEVICE_ID_LENGTH = 64;
const MAX_ACTION_LENGTH = 32;

export interface RestServerDeps {
  commandHandler: CommandHandler;
  opcuaClient: OpcuaClient;
  modbusClient: ModbusClient;
  deviceMap: any;
  startTime?: number;
}

export function createRestServer(deps: RestServerDeps) {
  const app = express();
  const startTime = deps.startTime ?? Date.now();

  // F5: Giới hạn body size 1KB — edge gateway chỉ nhận payload nhỏ
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

    // F4: Validate input — chỉ cho phép alphanumeric và underscore
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
      if (message.includes('không tồn tại') || message.includes('không hợp lệ')) {
        log.warn({ deviceId, action, error: message }, 'Command không hợp lệ');
        res.status(400).json({ success: false, message });
      } else {
        log.error({ deviceId, action, error: message }, 'Lỗi xử lý command');
        res.status(500).json({ success: false, message });
      }
    }
  });

  // GET /api/health — Kiểm tra trạng thái gateway
  app.get('/api/health', (_req: Request, res: Response) => {
    const status = {
      opcua: deps.opcuaClient.isConnected() ? 'connected' : 'disconnected',
      modbus: deps.modbusClient.isConnected() ? 'connected' : 'disconnected',
      uptime: Math.floor((Date.now() - startTime) / 1000),
    };
    log.debug(status, 'Health check');
    res.json(status);
  });

  // GET /api/devices — Danh sách tất cả devices
  app.get('/api/devices', (_req: Request, res: Response) => {
    res.json(deps.deviceMap);
  });

  return app;
}
