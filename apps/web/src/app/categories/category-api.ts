import { HttpClient, httpResource } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import type {
  CategoryDto,
  CreateCategoryRequest,
  CreateSubcategoryRequest,
  SubcategoryDto,
  UpdateCategoryRequest,
  UpdateSubcategoryRequest,
} from '@stabilitea/shared';
import { firstValueFrom } from 'rxjs';

@Service()
export class CategoryApi {
  private readonly http = inject(HttpClient);

  /** Categories with nested subcategories. Call from an injection context. */
  categoriesResource(includeArchived: () => boolean = () => false) {
    return httpResource<CategoryDto[]>(() =>
      includeArchived() ? { url: '/api/categories', params: { includeArchived: true } } : { url: '/api/categories' },
    );
  }

  create(body: CreateCategoryRequest): Promise<CategoryDto> {
    return firstValueFrom(this.http.post<CategoryDto>('/api/categories', body));
  }

  update(id: number, body: UpdateCategoryRequest): Promise<CategoryDto> {
    return firstValueFrom(this.http.patch<CategoryDto>(`/api/categories/${id}`, body));
  }

  createSubcategory(categoryId: number, body: CreateSubcategoryRequest): Promise<SubcategoryDto> {
    return firstValueFrom(this.http.post<SubcategoryDto>(`/api/categories/${categoryId}/subcategories`, body));
  }

  updateSubcategory(id: number, body: UpdateSubcategoryRequest): Promise<SubcategoryDto> {
    return firstValueFrom(this.http.patch<SubcategoryDto>(`/api/subcategories/${id}`, body));
  }
}
