import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface ModerationResult {
  flagged: boolean;
  masked: string;
}

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);
  private readonly moderationUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.moderationUrl = configService.get<string>('app.moderationServiceUrl', 'http://localhost:8000');
  }

  async moderateMessage(content: string, senderId: string): Promise<ModerationResult> {
    try {
      const response = await axios.post<ModerationResult>(
        `${this.moderationUrl}/moderate/message`,
        { content, context: 'CHAT', senderId },
        { timeout: 2000 },
      );

      return { flagged: response.data.flagged, masked: response.data.masked };
    } catch (error) {
      // Fail open — log but don't block message delivery
      this.logger.error({
        message: 'Moderation service unavailable',
        error: (error as Error).message,
      });
      return { flagged: false, masked: content };
    }
  }
}
