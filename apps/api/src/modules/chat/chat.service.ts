import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ModerationService } from './moderation.service';
import { ChatGateway } from './chat.gateway';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly gateway: ChatGateway,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getThreadsForProject(projectId: string) {
    return this.prisma.chatThread.findMany({
      where: { projectId },
      include: {
        _count: { select: { messages: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getMessages(threadId: string, pagination: PaginationDto) {
    const [items, total] = await Promise.all([
      this.prisma.chatMessage.findMany({
        where: { threadId },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.prisma.chatMessage.count({ where: { threadId } }),
    ]);

    return paginate(items, total, pagination);
  }

  async sendMessage(
    threadId: string,
    content: string,
    senderId: string,
    senderRole: UserRole,
  ) {
    const thread = await this.prisma.chatThread.findUniqueOrThrow({ where: { id: threadId } });

    // Moderate message — mask contact info
    const { flagged, masked } = await this.moderation.moderateMessage(content, senderId);

    const message = await this.prisma.chatMessage.create({
      data: {
        threadId,
        senderId,
        senderRole,
        content: masked, // Store masked content — original never stored
        flagged,
        type: 'TEXT',
      },
    });

    // Broadcast via WebSocket
    this.gateway.broadcastToProject(thread.projectId, 'chat.new_message', {
      threadId,
      message: {
        id: message.id,
        content: message.content,
        senderId: message.senderId,
        senderRole: message.senderRole,
        flagged: message.flagged,
        createdAt: message.createdAt,
      },
    });

    this.eventEmitter.emit('chat.message_sent', { threadId, messageId: message.id });

    if (flagged) {
      this.logger.warn({
        message: 'Contact info detected and masked in chat',
        threadId,
        senderId,
        messageId: message.id,
      });
    }

    return message;
  }

  async createMilestoneThread(projectId: string, milestoneId: string, title?: string) {
    return this.prisma.chatThread.create({
      data: { projectId, milestoneId, title },
    });
  }
}
