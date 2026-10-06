import { Body, Controller, Get, Param, ParseBoolPipe, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import type { CategoryDto, SubcategoryDto } from '@stabilitea/shared';
import { CreateCategoryDto, CreateSubcategoryDto, UpdateCategoryDto, UpdateSubcategoryDto } from './categories.dto.js';
import { CategoriesService } from './categories.service.js';

@Controller()
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get('categories')
  list(@Query('includeArchived', new ParseBoolPipe({ optional: true })) includeArchived?: boolean): Promise<CategoryDto[]> {
    return this.categories.list(includeArchived ?? false);
  }

  @Post('categories')
  create(@Body() body: CreateCategoryDto): Promise<CategoryDto> {
    return this.categories.create(body);
  }

  @Patch('categories/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateCategoryDto): Promise<CategoryDto> {
    return this.categories.update(id, body);
  }

  @Post('categories/:id/subcategories')
  createSubcategory(@Param('id', ParseIntPipe) id: number, @Body() body: CreateSubcategoryDto): Promise<SubcategoryDto> {
    return this.categories.createSubcategory(id, body);
  }

  @Patch('subcategories/:id')
  updateSubcategory(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateSubcategoryDto): Promise<SubcategoryDto> {
    return this.categories.updateSubcategory(id, body);
  }
}
