import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Replicate from 'replicate';

// Pin to a specific model version for reproducibility
const MODEL_VERSION =
  'stability-ai/sdxl:39ed52f2319f9b1779e4d4b3f4c4c4c4c4c4c4c4' as const;

@Injectable()
export class ReplicateProvider {
  private readonly client: Replicate;
  private readonly logger = new Logger(ReplicateProvider.name);

  constructor(private readonly configService: ConfigService) {
    this.client = new Replicate({
      auth: configService.get<string>('REPLICATE_API_TOKEN', ''),
    });
  }

  async generateDesigns(params: {
    positivePrompt: string;
    negativePrompt: string;
    numOutputs?: number;
  }): Promise<string[]> {
    const output = await this.client.run(MODEL_VERSION, {
      input: {
        prompt: params.positivePrompt,
        negative_prompt: params.negativePrompt,
        num_outputs: params.numOutputs ?? 3,
        width: 1344,
        height: 768,
        num_inference_steps: 30,
        guidance_scale: 7.5,
        scheduler: 'K_EULER',
        refine: 'expert_ensemble_refiner',
        high_noise_frac: 0.8,
      },
    });

    this.logger.log({ message: 'Replicate generation complete', count: (output as string[]).length });
    return output as string[];
  }
}
