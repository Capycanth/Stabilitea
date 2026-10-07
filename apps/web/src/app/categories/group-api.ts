import { HttpClient, httpResource } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import type {
  GroupDto,
  CreateGroupRequest,
  CreateCategoryRequest,
  CategoryDto,
  UpdateGroupRequest,
  UpdateCategoryRequest,
} from '@stabilitea/shared';
import { firstValueFrom } from 'rxjs';

@Service()
export class GroupApi {
  private readonly http = inject(HttpClient);

  /** Groups with nested categories. Call from an injection context. */
  groupsResource(includeArchived: () => boolean = () => false) {
    return httpResource<GroupDto[]>(() =>
      includeArchived() ? { url: '/api/groups', params: { includeArchived: true } } : { url: '/api/groups' },
    );
  }

  create(body: CreateGroupRequest): Promise<GroupDto> {
    return firstValueFrom(this.http.post<GroupDto>('/api/groups', body));
  }

  update(id: number, body: UpdateGroupRequest): Promise<GroupDto> {
    return firstValueFrom(this.http.patch<GroupDto>(`/api/groups/${id}`, body));
  }

  /** Permanently delete an archived group whose categories were never used. */
  delete(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/groups/${id}`));
  }

  createCategory(groupId: number, body: CreateCategoryRequest): Promise<CategoryDto> {
    return firstValueFrom(this.http.post<CategoryDto>(`/api/groups/${groupId}/categories`, body));
  }

  updateCategory(id: number, body: UpdateCategoryRequest): Promise<CategoryDto> {
    return firstValueFrom(this.http.patch<CategoryDto>(`/api/categories/${id}`, body));
  }

  /** Permanently delete an archived category that was never used. */
  deleteCategory(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/categories/${id}`));
  }
}
