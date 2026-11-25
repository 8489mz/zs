import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { RequestWithAuth } from '../interfaces/request-with-auth.interface';

/**
 * دفاتر المنشأة المالية لا يفتحها إلا من يملك `accounting` صراحةً — أو المالك.
 *
 * ## الثغرة التي وُلد منها هذا الحارس (25 سبتمبر 2026)
 *
 * متحكّم المحاسبة كان محروساً بـ`@RequireAnyPermission('accounting', 'accounts')`، أي أن صلاحية
 * **`accounts` وحدها تكفي**. وقالب «كاشير» في شاشة المستخدمين يمنح `accounts` لكل كاشير — واسمها
 * المعروض «الحسابات»، فيفهمها المالك على أنها حسابات العملاء والموردين، وهي كذلك في المشتريات.
 *
 * ما منع الكارثة جزئياً أن `AccountingService.assertAccountingAccess` تفحص `accounting` تحديداً،
 * لكنها فحصٌ **داخل الخدمة**: تنفّذه 31 دالة من 42، و**الميزانية العمومية وقائمة التدفقات النقدية
 * تعيشان في خدمتين منفصلتين لا تفحصان شيئاً**. فثبت عملياً على الإنتاج أن حساب كاشير يقرأ:
 *
 *   GET /api/accounting/reports/balance-sheet   → HTTP 200، الأصول والخزينة والمركز المالي كاملاً
 *   GET /api/accounting/reports/cash-flow       → HTTP 200
 *
 * والدرس ليس «أضف الفحص الناقص في الخدمتين»: ذلك يترك الحماية معلَّقة على أن يتذكّرها كاتبُ كل
 * خدمة جديدة بين 82 مساراً. الحماية تُوضع **عند الباب مرة واحدة**، والفحوص داخل الخدمات تبقى
 * طبقةً ثانية.
 *
 * القاعدة هنا مطابقة تماماً لـ`assertAccountingAccess`، فلا يُمنع أحدٌ كان مسموحاً له.
 */
@Injectable()
export class AccountingAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const auth = request.authContext;

    if (!auth) {
      throw new ForbiddenException('Authentication required');
    }

    const allowed =
      auth.role === 'super_admin' || auth.role === 'admin' || (auth.permissions || []).includes('accounting');

    if (!allowed) {
      throw new ForbiddenException('Missing required permissions');
    }

    return true;
  }
}
