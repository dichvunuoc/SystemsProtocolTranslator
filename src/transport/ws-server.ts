import { WebSocketServer, WebSocket } from 'ws';
import logger from '../utils/logger.js';
import type { TelemetryPoller, TelemetryData } from '../telemetry/telemetry-poller.js';

const log = logger.child({ module: 'ws-server' });

const HEARTBEAT_INTERVAL_MS = 30_000;

export class WsServer {
  private wss: WebSocketServer;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(port: number, telemetryPoller: TelemetryPoller) {
    this.wss = new WebSocketServer({ port });

    // Lắng nghe kết nối mới
    this.wss.on('connection', (ws) => {
      log.info(
        { clientCount: this.wss.clients.size },
        'Client WebSocket mới kết nối',
      );

      (ws as any).isAlive = true;
      ws.on('pong', () => {
        (ws as any).isAlive = true;
      });

      ws.on('close', () => {
        log.info(
          { clientCount: this.wss.clients.size - 1 },
          'Client WebSocket ngắt kết nối',
        );
      });
    });

    // Subscribe vào telemetry events — broadcast tới tất cả clients
    telemetryPoller.on('telemetry', (data: TelemetryData) => {
      const message = JSON.stringify(data);
      this.wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    });

    // Heartbeat ping/pong mỗi 30s
    this.heartbeatTimer = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if ((ws as any).isAlive === false) {
          log.debug('Đóng kết nối dead client');
          ws.terminate();
          return;
        }
        (ws as any).isAlive = false;
        ws.ping();
      });
    }, HEARTBEAT_INTERVAL_MS);

    log.info({ port }, 'WebSocket server đã khởi động');
  }

  close(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.wss.close();
    log.info('WebSocket server đã đóng');
  }
}
