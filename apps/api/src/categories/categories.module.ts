import { Module } from '@nestjs/common';
import { BudgetsModule } from '../budgets/budgets.module.js';
import { CategoriesController } from './categories.controller.js';
import { CategoriesService } from './categories.service.js';

@Module({
  imports: [BudgetsModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
})
export class CategoriesModule {}
