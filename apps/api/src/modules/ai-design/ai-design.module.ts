import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiDesignController } from './ai-design.controller';
import { AiDesignService } from './ai-design.service';
import { AiDesignProcessor } from './ai-design.processor';
import { ReplicateProvider } from './providers/replicate.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { PromptBuilderService } from './prompt-builder.service';
import { StorageModule } from '../storage/storage.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'ai-generation' }),
    StorageModule,
    ChatModule,
  ],
  controllers: [AiDesignController],
  providers: [
    AiDesignService,
    AiDesignProcessor,
    ReplicateProvider,
    OpenAiProvider,
    PromptBuilderService,
  ],
  exports: [AiDesignService],
})
export class AiDesignModule {}
