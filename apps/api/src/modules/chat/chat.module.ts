import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { ModerationService } from './moderation.service';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../../redis/redis.module';

@Module({
  imports: [AuthModule, RedisModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, ModerationService],
  exports: [ChatService, ChatGateway, ModerationService],
})
export class ChatModule {}
