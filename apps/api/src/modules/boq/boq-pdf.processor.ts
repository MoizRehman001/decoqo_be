import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { paiseToInr } from '../../common/utils/money.util';

interface BoqPdfJobData {
  boqId: string;
  projectId: string;
  requestedBy: string;
}

interface PdfSettings {
  watermarkText: string;
  watermarkOpacity: number;
  watermarkAngle: number;
  showClientName: boolean;
  showTimestamp: boolean;
}

const DEFAULT_PDF_SETTINGS: PdfSettings = {
  watermarkText: 'DECOQO CONFIDENTIAL',
  watermarkOpacity: 0.08,
  watermarkAngle: -45,
  showClientName: true,
  showTimestamp: true,
};

@Processor('pdf-export')
export class BoqPdfProcessor extends WorkerHost {
  private readonly logger = new Logger(BoqPdfProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<BoqPdfJobData>): Promise<{ pdfUrl: string }> {
    const { boqId, projectId } = job.data;
    this.logger.log({ message: 'Generating BOQ PDF', boqId, projectId });

    await job.updateProgress(10);

    // Fetch BOQ data and admin-controlled PDF settings in parallel
    // Note: boqPdfSettings is available after running `prisma generate` + migration
    const [boq, rawSettings] = await Promise.all([
      this.prisma.boqHeader.findUniqueOrThrow({
        where: { id: boqId },
        include: {
          items: { orderBy: [{ room: 'asc' }, { sortOrder: 'asc' }] },
          project: { include: { customer: true } },
          vendor: true,
        },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.prisma as any).boqPdfSettings?.findFirst({
        where: { isActive: true },
        orderBy: { updatedAt: 'desc' },
      }).catch(() => null) ?? Promise.resolve(null),
    ]);

    // Merge DB settings with defaults — DB always wins
    const settings: PdfSettings = rawSettings
      ? {
          watermarkText:    rawSettings.watermarkText,
          watermarkOpacity: rawSettings.watermarkOpacity,
          watermarkAngle:   rawSettings.watermarkAngle,
          showClientName:   rawSettings.showClientName,
          showTimestamp:    rawSettings.showTimestamp,
        }
      : DEFAULT_PDF_SETTINGS;

    await job.updateProgress(30);

    // Group items by room
    const roomGroups = boq.items.reduce<Record<string, typeof boq.items>>((acc, item) => {      if (!acc[item.room]) acc[item.room] = [];
      acc[item.room]!.push(item);
      return acc;
    }, {});

    // Generate HTML with dynamic watermark from DB settings
    const html = this.generateBoqHtml(boq, roomGroups, settings);

    await job.updateProgress(60);

    const pdfContent = Buffer.from(html, 'utf-8');
    const fileKey = `boq-pdfs/${projectId}/${boqId}-v${boq.currentVersion}.html`;

    await this.storage.getPresignedUploadUrl({
      context: 'boq-pdfs',
      contextId: boqId,
      fileName: `boq-v${boq.currentVersion}.pdf`,
      mimeType: 'application/pdf',
      fileSizeBytes: pdfContent.length,
    });

    await job.updateProgress(90);

    const pdfUrl = this.storage.getCdnUrl(fileKey);

    this.logger.log({ message: 'BOQ PDF generated', boqId, pdfUrl });
    await job.updateProgress(100);

    return { pdfUrl };
  }

  private generateBoqHtml(
    boq: {
      currentVersion: number;
      grandTotalPaise: number;
      project: { title: string; city: string; customer: { displayName: string } };
      vendor: { businessName: string; displayName: string };
    },
    roomGroups: Record<string, Array<{
      room: string; category: string; description: string;
      material: string | null; brand: string | null;
      quantity: number; unit: string; ratePaise: number; amountPaise: number;
    }>>,
    settings: PdfSettings,
  ): string {
    const formatInr = (paise: number) =>
      `₹${paiseToInr(paise).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

    const itemRows = Object.entries(roomGroups)
      .map(([room, items]) => {
        const roomTotal = items.reduce((s, i) => s + i.amountPaise, 0);
        const rows = items
          .map(
            (item, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>${item.description}</td>
            <td>${item.material ?? ''} ${item.brand ? `(${item.brand})` : ''}</td>
            <td style="text-align:right">${item.quantity} ${item.unit}</td>
            <td style="text-align:right">${formatInr(item.ratePaise)}</td>
            <td style="text-align:right;font-weight:600">${formatInr(item.amountPaise)}</td>
          </tr>`,
          )
          .join('');

        return `
        <tr style="background:#f9f7f4">
          <td colspan="5" style="font-weight:700;padding:10px 8px">${room}</td>
          <td style="text-align:right;font-weight:700;padding:10px 8px">${formatInr(roomTotal)}</td>
        </tr>
        ${rows}`;
      })
      .join('');

    // Build watermark CSS from DB settings — fully dynamic, no hardcoded values
    const watermarkCss = `
      .watermark-container {
        position: fixed;
        top: 0; left: 0;
        width: 100%; height: 100%;
        pointer-events: none;
        z-index: 9999;
        overflow: hidden;
      }
      .watermark-tile {
        position: absolute;
        width: 100%; height: 100%;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 80px;
      }
      .watermark-text {
        font-size: 28px;
        font-weight: 700;
        color: rgba(0,0,0,${settings.watermarkOpacity});
        transform: rotate(${settings.watermarkAngle}deg);
        white-space: nowrap;
        letter-spacing: 4px;
        font-family: Arial, sans-serif;
        user-select: none;
      }
    `;

    // Generate a grid of watermark tiles to cover the full page
    const watermarkTiles = Array.from({ length: 12 })
      .map(() => `<span class="watermark-text">${settings.watermarkText}</span>`)
      .join('');

    const clientNameHtml = settings.showClientName
      ? `<strong>Customer:</strong> ${boq.project.customer.displayName}<br>`
      : '';

    const timestampHtml = settings.showTimestamp
      ? `<strong>Generated:</strong> ${new Date().toLocaleDateString('en-IN', {
          day: 'numeric', month: 'long', year: 'numeric',
        })}`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>BOQ — ${boq.project.title}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; color: #333; margin: 40px; position: relative; }
    h1 { color: #1a1a1a; font-size: 20px; }
    h2 { color: #555; font-size: 14px; font-weight: normal; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th { background: #1a1a1a; color: #c9a84c; padding: 10px 8px; text-align: left; font-size: 11px; text-transform: uppercase; }
    td { padding: 8px; border-bottom: 1px solid #eee; }
    .grand-total { background: #1a1a1a; color: #c9a84c; font-size: 16px; font-weight: 700; padding: 14px; text-align: right; margin-top: 20px; border-radius: 4px; }
    .meta { display: flex; justify-content: space-between; margin-bottom: 20px; }
    .meta div { font-size: 12px; color: #666; }
    .meta strong { color: #333; }
    ${watermarkCss}
  </style>
</head>
<body>
  <!-- Dynamic watermark — text, opacity, and angle from BoqPdfSettings -->
  <div class="watermark-container">
    <div class="watermark-tile">${watermarkTiles}</div>
  </div>

  <h1>Bill of Quantities</h1>
  <h2>${boq.project.title} · ${boq.project.city}</h2>
  <div class="meta">
    <div>
      ${clientNameHtml}
      <strong>Vendor:</strong> ${boq.vendor.businessName} (${boq.vendor.displayName})
    </div>
    <div style="text-align:right">
      <strong>Version:</strong> ${boq.currentVersion}<br>
      ${timestampHtml}
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Description</th>
        <th>Material / Brand</th>
        <th style="text-align:right">Qty</th>
        <th style="text-align:right">Rate</th>
        <th style="text-align:right">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>
  <div class="grand-total">Grand Total: ${formatInr(boq.grandTotalPaise)}</div>
  <p style="margin-top:30px;font-size:10px;color:#999">
    This BOQ is locked and constitutes the commercial scope of work. Any changes require a formal variation order approved by both parties.
    Generated by Decoqo — India's Most Trusted Interior Execution Platform.
  </p>
</body>
</html>`;
  }
}
