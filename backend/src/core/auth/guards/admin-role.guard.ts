import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { RequestWithAuth } from '../interfaces/request-with-auth.interface';

@Injectable()
export class AdminRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const auth = request.authContext;

    if (!auth) {
      throw new ForbiddenException('Authentication required');
    }

    const canManage =
      auth.role === 'super_admin' ||
      auth.permissions.includes('settings') ||
      auth.permissions.includes('canManageSettings');

    if (!canManage) {
      throw new ForbiddenException('Missing required permissions');
    }

    return true;
  }
}
