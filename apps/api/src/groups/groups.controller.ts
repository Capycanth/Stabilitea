import { Body, Controller, Get, Param, ParseBoolPipe, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import type { GroupDto, CategoryDto } from '@stabilitea/shared';
import { CreateGroupDto, CreateCategoryDto, UpdateGroupDto, UpdateCategoryDto } from './groups.dto.js';
import { GroupsService } from './groups.service.js';

@Controller()
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get('groups')
  list(@Query('includeArchived', new ParseBoolPipe({ optional: true })) includeArchived?: boolean): Promise<GroupDto[]> {
    return this.groups.list(includeArchived ?? false);
  }

  @Post('groups')
  create(@Body() body: CreateGroupDto): Promise<GroupDto> {
    return this.groups.create(body);
  }

  @Patch('groups/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateGroupDto): Promise<GroupDto> {
    return this.groups.update(id, body);
  }

  @Post('groups/:id/categories')
  createCategory(@Param('id', ParseIntPipe) id: number, @Body() body: CreateCategoryDto): Promise<CategoryDto> {
    return this.groups.createCategory(id, body);
  }

  @Patch('categories/:id')
  updateCategory(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateCategoryDto): Promise<CategoryDto> {
    return this.groups.updateCategory(id, body);
  }
}
