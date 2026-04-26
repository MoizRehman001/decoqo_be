import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class OpenAiProvider {
  private readonly client: OpenAI;
  private readonly logger = new Logger(OpenAiProvider.name);

  constructor(private readonly configService: ConfigService) {
    this.client = new OpenAI({
      apiKey: configService.get<string>('OPENAI_API_KEY', ''),
    });
  }

  /** Fallback image generation — DALL-E 3 only supports n=1 */
  async generateDesignFallback(prompt: string): Promise<string[]> {
    this.logger.warn({ message: 'Using OpenAI fallback for design generation' });

    const response = await this.client.images.generate({
      model: 'dall-e-3',
      prompt: `Indian interior design: ${prompt}. Photorealistic, high quality, professional photography.`,
      n: 1,
      size: '1792x1024',
      quality: 'hd',
    });

    return (response.data ?? []).map((img) => img.url ?? '').filter(Boolean);
  }
}
