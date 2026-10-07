import { Module } from '@nestjs/common';
import { BudgetsModule } from '../budgets/budgets.module.js';
import { GroupsController } from './groups.controller.js';
import { GroupsService } from './groups.service.js';

@Module({
  imports: [BudgetsModule],
  controllers: [GroupsController],
  providers: [GroupsService],
})
export class GroupsModule {}
