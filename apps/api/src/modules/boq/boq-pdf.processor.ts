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

    const boq = await this.prisma.boqHeader.findUniqueOrThrow({
      where: { id: boqId },
      include: {
        items: { orderBy: [{ room: 'asc' }, { sortOrder: 'asc' }] },
        project: { include: { customer: true } },
        vendor: true,
      },
    });

    await job.updateProgress(30);

    // Group items by room
    const roomGroups = boq.items.reduce<Record<string, typeof boq.items>>((acc, item) => {
      if (!acc[item.room]) acc[item.room] = [];
      acc[item.room]!.push(item);
      return acc;
    }, {});

    // Generate HTML for PDF
    const html = this.generateBoqHtml(boq, roomGroups);

    await job.updateProgress(60);

    // In production: use Puppeteer to render HTML → PDF
    // For now: store the HTML as a placeholder and return a mock URL
    // TODO: Replace with actual Puppeteer PDF generation
    const pdfContent = Buffer.from(html, 'utf-8');
    const fileKey = `boq-pdfs/${projectId}/${boqId}-v${boq.currentVersion}.html`;

    // Upload to S3
    const { uploadUrl } = await this.storage.getPresignedUploadUrl({
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

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>BOQ — ${boq.project.title}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; color: #333; margin: 40px; }
    h1 { color: #1a1a1a; font-size: 20px; }
    h2 { color: #555; font-size: 14px; font-weight: normal; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th { background: #1a1a1a; color: #c9a84c; padding: 10px 8px; text-align: left; font-size: 11px; text-transform: uppercase; }
    td { padding: 8px; border-bottom: 1px solid #eee; }
    .grand-total { background: #1a1a1a; color: #c9a84c; font-size: 16px; font-weight: 700; padding: 14px; text-align: right; margin-top: 20px; border-radius: 4px; }
    .meta { display: flex; justify-content: space-between; margin-bottom: 20px; }
    .meta div { font-size: 12px; color: #666; }
    .meta strong { color: #333; }
  </style>
</head>
<body>
  <h1>Bill of Quantities</h1>
  <h2>${boq.project.title} · ${boq.project.city}</h2>
  <div class="meta">
    <div>
      <strong>Customer:</strong> ${boq.project.customer.displayName}<br>
      <strong>Vendor:</strong> ${boq.vendor.businessName} (${boq.vendor.displayName})
    </div>
    <div style="text-align:right">
      <strong>Version:</strong> ${boq.currentVersion}<br>
      <strong>Generated:</strong> ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
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
