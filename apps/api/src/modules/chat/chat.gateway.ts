import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../common/interceptors/idempotency.interceptor';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userRole?: string;
}

@WebSocketGateway({
  cors: {
    origin: (origin: string, callback: (err: Error | null, allow?: boolean) => void) => {
      callback(null, true); // Configured per environment
    },
    credentials: true,
  },
  namespace: '/',
  transports: ['websocket', 'polling'],
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Attach Redis adapter for multi-instance Socket.io state sharing.
   * Required for ECS Fargate deployments with multiple API containers.
   * Uses dynamic import to avoid compile-time resolution issues with the adapter package.
   */
  afterInit(server: Server): void {
    void (async () => {
      try {
        const { createAdapter } = await import('@socket.io/redis-adapter');
        const pubClient = this.redis.duplicate();
        const subClient = this.redis.duplicate();
        server.adapter(createAdapter(pubClient, subClient));
        this.logger.log({ message: 'Socket.io Redis adapter attached' });
      } catch (error) {
        this.logger.warn({
          message: 'Redis adapter not available — running in single-instance mode',
          error: (error as Error).message,
        });
      }
    })();
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      const token = client.handshake.auth['token'] as string | undefined;
      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify<{ sub: string; role: string }>(token, {
        secret: this.configService.getOrThrow<string>('app.jwtSecret'),
      });

      client.userId = payload.sub;
      client.userRole = payload.role;
      client.join(`user:${payload.sub}`);

      this.logger.debug({ message: 'WebSocket connected', userId: payload.sub });
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    this.logger.debug({ message: 'WebSocket disconnected', userId: client.userId });
  }

  @SubscribeMessage('join_project')
  handleJoinProject(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { projectId: string },
  ): void {
    client.join(`project:${data.projectId}`);
  }

  @SubscribeMessage('join_milestone')
  handleJoinMilestone(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { milestoneId: string },
  ): void {
    client.join(`milestone:${data.milestoneId}`);
  }

  @SubscribeMessage('leave_project')
  handleLeaveProject(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { projectId: string },
  ): void {
    client.leave(`project:${data.projectId}`);
  }

  // ── Broadcast helpers (called by services) ────────────────────────────────

  broadcastToProject(projectId: string, event: string, data: unknown): void {
    this.server.to(`project:${projectId}`).emit(event, data);
  }

  broadcastToUser(userId: string, event: string, data: unknown): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  broadcastToMilestone(milestoneId: string, event: string, data: unknown): void {
    this.server.to(`milestone:${milestoneId}`).emit(event, data);
  }

  emitDesignProgress(projectId: string, progress: number, status: string): void {
    this.broadcastToProject(projectId, 'design.generation.progress', { progress, status });
  }

  emitDesignComplete(projectId: string, designId: string, imageUrls: string[]): void {
    this.broadcastToProject(projectId, 'design.generation.complete', { designId, imageUrls });
  }

  emitMilestoneStatusChanged(projectId: string, milestoneId: string, newStatus: string): void {
    this.broadcastToProject(projectId, 'milestone.status_changed', { milestoneId, newStatus });
  }

  emitEscrowStatusChanged(projectId: string, milestoneId: string, escrowStatus: string): void {
    this.broadcastToProject(projectId, 'escrow.status_changed', { milestoneId, escrowStatus });
  }
}
