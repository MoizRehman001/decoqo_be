import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ChatGateway } from '../chat/chat.gateway';
import { ReplicateProvider } from './providers/replicate.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { PromptBuilderService, DesignPromptParams } from './prompt-builder.service';
import { TimelineEventType } from '@prisma/client';
import axios from 'axios';
import { randomUUID } from 'crypto';

export interface AiGenerationJobData {
  projectId: string;
  designId: string;
  promptParams: DesignPromptParams;
}

@Processor('ai-generation', {
  concurrency: 5,
  limiter: { max: 10, duration: 60_000 }, // 10 jobs/min — Replicate rate limit
})
export class AiDesignProcessor extends WorkerHost {
  private readonly logger = new Logger(AiDesignProcessor.name);

  constructor(
    private readonly replicate: ReplicateProvider,
    private readonly openai: OpenAiProvider,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: ChatGateway,
    private readonly promptBuilder: PromptBuilderService,
  ) {
    super();
  }

  async process(job: Job<AiGenerationJobData>): Promise<void> {
    const { projectId, designId, promptParams } = job.data;

    await job.updateProgress(5);

    const positivePrompt = this.promptBuilder.buildPositivePrompt(promptParams);
    const negativePrompt = this.promptBuilder.buildNegativePrompt();

    let imageUrls: string[];

    try {
      await job.updateProgress(10);
      imageUrls = await this.replicate.generateDesigns({ positivePrompt, negativePrompt });
      await job.updateProgress(70);
    } catch (replicateError) {
      this.logger.warn({
        message: 'Replicate failed — falling back to OpenAI',
        error: (replicateError as Error).message,
        designId,
      });

      // Fallback: generate 2 images via DALL-E 3
      const [img1, img2] = await Promise.all([
        this.openai.generateDesignFallback(positivePrompt),
        this.openai.generateDesignFallback(positivePrompt),
      ]);
      imageUrls = [...img1, ...img2];
      await job.updateProgress(70);
    }

    // Download and store images in S3
    const s3Keys = await Promise.all(
      imageUrls.map((url) => this.downloadAndStore(url, projectId)),
    );
    await job.updateProgress(90);

    // Update DB
    await this.prisma.$transaction(async (tx) => {
      await tx.aiDesign.update({
        where: { id: designId },
        data: {
          generatedImages: s3Keys,
          status: 'GENERATED',
          promptVersion: 'v1.0.0',
        },
      });

      await tx.trustTimelineEvent.create({
        data: {
          projectId,
          eventType: TimelineEventType.DESIGN_GENERATED,
          metadata: { designId, imageCount: s3Keys.length },
        },
      });
    });

    await job.updateProgress(100);

    // Notify customer via WebSocket
    const cdnUrls = s3Keys.map((key) => this.storage.getCdnUrl(key));
    this.gateway.emitDesignComplete(projectId, designId, cdnUrls);

    this.logger.log({ message: 'AI design generation complete', designId, projectId });
  }

  private async downloadAndStore(url: string, projectId: string): Promise<string> {
    const response = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    const key = `designs/${projectId}/${randomUUID()}.jpg`;

    // Use S3 SDK directly for server-side upload
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({ region: process.env['AWS_REGION'] ?? 'ap-south-1' });

    await client.send(
      new PutObjectCommand({
        Bucket: process.env['AWS_S3_BUCKET'] ?? '',
        Key: key,
        Body: buffer,
        ContentType: 'image/jpeg',
      }),
    );

    return key;
  }
}
