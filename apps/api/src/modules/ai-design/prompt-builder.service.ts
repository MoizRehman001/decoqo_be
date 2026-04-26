import { Injectable } from '@nestjs/common';

export interface DesignPromptParams {
  themeText: string;
  style: string;
  colorPalette: string[];
  material: string[];
  lighting: string;
  usage: string;
  roomDimensions: string;
  city: string;
}

const STYLE_MODIFIERS: Record<string, string> = {
  MODERN_MINIMALIST: 'modern minimalist, clean lines, uncluttered spaces',
  CONTEMPORARY_INDIAN: 'contemporary Indian, fusion of traditional and modern elements',
  TRADITIONAL_INDIAN: 'traditional Indian, rich textures, warm colors, ethnic motifs',
  SCANDINAVIAN: 'Scandinavian, light wood, neutral tones, functional design',
  INDUSTRIAL: 'industrial style, exposed brick, metal accents, raw materials',
  LUXURY_MODERN: 'luxury modern, premium materials, statement pieces, sophisticated',
  VASTU_COMPLIANT: 'Vastu-compliant layout, natural materials, earthy tones',
};

const USAGE_CONTEXT: Record<string, string> = {
  FAMILY_LIVING: 'family living room, comfortable seating, entertainment area',
  MASTER_BEDROOM: 'master bedroom, relaxing atmosphere, ample storage',
  MODULAR_KITCHEN: 'modular kitchen, efficient workflow, modern appliances',
  HOME_OFFICE: 'home office, productive environment, ergonomic setup',
  KIDS_ROOM: "children's room, playful, safe, colorful, functional",
  DINING_ROOM: 'dining room, elegant, comfortable seating for family',
};

@Injectable()
export class PromptBuilderService {
  buildPositivePrompt(params: DesignPromptParams): string {
    const styleModifier = STYLE_MODIFIERS[params.style] ?? params.style;
    const usageContext = USAGE_CONTEXT[params.usage] ?? params.usage;

    return [
      `Indian interior design, ${styleModifier}`,
      usageContext,
      params.themeText,
      `Room: ${params.roomDimensions}`,
      `Color palette: ${params.colorPalette.join(', ')}`,
      `Materials: ${params.material.join(', ')}`,
      `Lighting: ${params.lighting}`,
      `City: ${params.city}`,
      'photorealistic, professional interior photography',
      'high quality, 8k resolution, natural lighting',
      'Indian home, realistic furniture, proper proportions',
    ].join(', ');
  }

  buildNegativePrompt(): string {
    return [
      'ugly, blurry, low quality, distorted',
      'unrealistic proportions, floating objects',
      'cartoon, anime, illustration, sketch',
      'watermark, text, signature',
      'empty room, no furniture',
      'dark, poorly lit',
      'western-only style without Indian context',
    ].join(', ');
  }
}
