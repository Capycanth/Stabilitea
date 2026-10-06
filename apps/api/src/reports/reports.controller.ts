import { Controller, Get, Param, ParseIntPipe, StreamableFile } from '@nestjs/common';
import type { ReportYearsDto } from '@stabilitea/shared';
import { fieldError } from '../common/errors.js';
import { YearReportBuilder } from './year-report.js';
import { renderYearWorkbook } from './year-workbook.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('reports')
export class ReportsController {
  constructor(private readonly builder: YearReportBuilder) {}

  @Get('years')
  async years(): Promise<ReportYearsDto> {
    return { years: await this.builder.years() };
  }

  /** Yearly Excel report: Summary, Monthly, and Budget vs actual sheets. */
  @Get(':year')
  async year(@Param('year', ParseIntPipe) year: number): Promise<StreamableFile> {
    if (year < 1900 || year > 9999) throw fieldError('year', 'Year must be between 1900 and 9999');
    const buffer = await renderYearWorkbook(await this.builder.build(year));
    return new StreamableFile(buffer, {
      type: XLSX,
      disposition: `attachment; filename="stabilitea-${year}-report.xlsx"`,
      length: buffer.length,
    });
  }
}
