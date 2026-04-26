import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('chat')
@ApiBearerAuth('access-token')
@Controller({ path: 'chat', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('projects/:id/threads')
  @ApiOperation({ summary: 'List chat threads for project' })
  getThreads(@Param('id') projectId: string) {
    return this.chatService.getThreadsForProject(projectId);
  }

  @Get('threads/:threadId/messages')
  @ApiOperation({ summary: 'Get messages in thread (paginated)' })
  getMessages(@Param('threadId') threadId: string, @Query() pagination: PaginationDto) {
    return this.chatService.getMessages(threadId, pagination);
  }

  @Post('threads/:threadId/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send message (contact info auto-masked)' })
  sendMessage(
    @Param('threadId') threadId: string,
    @Body('content') content: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.chatService.sendMessage(threadId, content, user.sub, user.role as UserRole);
  }
}
