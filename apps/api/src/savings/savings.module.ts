import { Module } from '@nestjs/common';
import { ExportController } from './export.controller.js';
import { SavingsController } from './savings.controller.js';

@Module({
  controllers: [SavingsController, ExportController],
})
export class SavingsModule {}
