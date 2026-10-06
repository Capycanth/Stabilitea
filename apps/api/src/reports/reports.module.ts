import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { YearReportBuilder } from './year-report.js';

@Module({
  controllers: [ReportsController],
  providers: [YearReportBuilder],
})
export class ReportsModule {}
