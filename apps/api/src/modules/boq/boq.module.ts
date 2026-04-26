import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BoqController } from './boq.controller';
import { BoqService } from './boq.service';
import { BoqPdfProcessor } from './boq-pdf.processor';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'pdf-export' }),
    StorageModule,
  ],
  controllers: [BoqController],
  providers: [BoqService, BoqPdfProcessor],
  exports: [BoqService],
})
export class BoqModule {}
