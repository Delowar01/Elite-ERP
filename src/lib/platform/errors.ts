import "server-only";

// ---------------------------------------------------------------------------------------------
// Typed Platform Owner errors (PR #11 TRD §8 / §10 plus the authentication codes PO-01A needs).
//
// `message` is a generic, user-safe English default. Every code also carries a native Arabic
// message, so PO-01B can render either locale without inventing text. Internal context goes in
// `detail`, which must never be shown to the browser or contain secrets.
// ---------------------------------------------------------------------------------------------

export const PLATFORM_ERROR_MESSAGES = {
  INVALID_CREDENTIALS: { en: "The email or password is incorrect.", ar: "البريد الإلكتروني أو كلمة المرور غير صحيحة." },
  MFA_REQUIRED: { en: "Enter the verification code from your authenticator app.", ar: "أدخل رمز التحقق من تطبيق المصادقة." },
  MFA_INVALID: { en: "The verification code is incorrect or has already been used.", ar: "رمز التحقق غير صحيح أو سبق استخدامه." },
  RATE_LIMITED: { en: "Too many attempts. Please wait and try again later.", ar: "عدد المحاولات كبير. يُرجى الانتظار ثم المحاولة لاحقًا." },
  UNAUTHORIZED: { en: "Please sign in to continue.", ar: "يُرجى تسجيل الدخول للمتابعة." },
  SESSION_EXPIRED: { en: "Your session has expired. Please sign in again.", ar: "انتهت صلاحية الجلسة. يُرجى تسجيل الدخول مرة أخرى." },
  FORBIDDEN: { en: "You do not have permission to perform this action.", ar: "ليست لديك صلاحية لتنفيذ هذا الإجراء." },
  NOT_FOUND: { en: "The requested item was not found.", ar: "العنصر المطلوب غير موجود." },
  VALIDATION_FAILED: { en: "Some of the information entered is not valid.", ar: "بعض البيانات المُدخلة غير صحيحة." },
  CONFLICT: { en: "This change conflicts with the current state. Refresh and try again.", ar: "يتعارض هذا التغيير مع الحالة الحالية. حدّث الصفحة وحاول مرة أخرى." },
  CONSOLE_DISABLED: { en: "This page is not available.", ar: "هذه الصفحة غير متاحة." },
  CONFIG_ERROR: { en: "The platform console is temporarily unavailable.", ar: "لوحة إدارة المنصة غير متاحة مؤقتًا." },
  // PO-01B.1: a change whose audit record could not be written is rolled back, never applied silently.
  AUDIT_UNAVAILABLE: { en: "This change was not applied because it could not be recorded in the audit trail.", ar: "لم يُطبَّق هذا التغيير لتعذّر تسجيله في سجل التدقيق." },
  // PO-02C: a suspension is refused while customer enforcement is switched off (it would be recorded but not applied).
  ENFORCEMENT_DISABLED: { en: "Company access enforcement is switched off in this environment, so a company cannot be suspended here.", ar: "تطبيق إيقاف وصول الشركات غير مفعّل في هذه البيئة، لذا لا يمكن إيقاف أي شركة هنا." },
  // PO-02D2: invitation administration is refused while PLATFORM_INVITATIONS_ENABLED is not exactly "true".
  INVITATIONS_DISABLED: { en: "Company invitations are switched off in this environment.", ar: "دعوات الشركات غير مفعّلة في هذه البيئة." },
  // PO-02D3: public invitation acceptance is refused while CUSTOMER_INVITE_ACCEPTANCE_ENABLED is not exactly "true".
  ACCEPTANCE_DISABLED: { en: "Invitation acceptance is not available in this environment.", ar: "قبول الدعوات غير متاح في هذه البيئة." },
  // PO-03B: the Platform Owner user controls (src/lib/platform/customer-user-actions.ts).
  LAST_ACTIVE_OWNER: { en: "The company must keep at least one active owner, so this account can't be disabled.", ar: "يجب أن تحتفظ الشركة بمالك نشط واحد على الأقل، لذا لا يمكن تعطيل هذا الحساب." },
  OWNER_PROTECTION_UNAVAILABLE: { en: "Owner protection can't be checked right now, so nothing was changed. Try again later.", ar: "يتعذّر التحقق من حماية المالك حاليًا، لذا لم يُغيَّر أي شيء. حاول مرة أخرى لاحقًا." },
  CHANGE_IN_PROGRESS: { en: "Another change to this company's users is in progress. Nothing was changed. Try again in a moment.", ar: "يجري تغيير آخر على مستخدمي هذه الشركة. لم يُغيَّر أي شيء. حاول مرة أخرى بعد قليل." },
  // PO-03C: the primary-owner transfer (src/lib/platform/customer-user-actions.ts).
  OWNER_NOT_DESIGNATED: { en: "This company has no designated primary owner. A primary owner is designated only through a separately approved process.", ar: "لا يوجد مالك رئيسي محدد لهذه الشركة. لا يُحدَّد المالك الرئيسي إلا عبر إجراء معتمد مستقل." },
  TRANSFER_TARGET_INVALID: { en: "The new primary owner must be another active user of the same company.", ar: "يجب أن يكون المالك الرئيسي الجديد مستخدمًا نشطًا آخر في الشركة نفسها." },
  // PO-03C (sub-batch C): customer-user invitations — switched off by default, and a staged table.
  USER_INVITATIONS_DISABLED: { en: "User invitations are switched off in this environment.", ar: "دعوات المستخدمين متوقفة في هذه البيئة." },
  USER_INVITATIONS_NOT_INSTALLED: { en: "User invitations are not set up in this environment's database.", ar: "دعوات المستخدمين غير مُعدّة في قاعدة بيانات هذه البيئة." },
  // Reserved for later phases (TRD §8); defined now so the code set is stable.
  COMPANY_SUSPENDED: { en: "This company's access is suspended.", ar: "تم إيقاف وصول هذه الشركة." },
  INVITE_EXPIRED: { en: "This invitation has expired.", ar: "انتهت صلاحية هذه الدعوة." },
  INVITE_USED: { en: "This invitation has already been used.", ar: "سبق استخدام هذه الدعوة." },
  EMAIL_CONFLICT: { en: "This email address is already in use.", ar: "عنوان البريد الإلكتروني مستخدم مسبقًا." },
  SEAT_LIMIT: { en: "The user limit for this subscription has been reached.", ar: "تم الوصول إلى الحد الأقصى للمستخدمين في هذا الاشتراك." },
  LAST_PRIMARY_OWNER: { en: "The company must keep its primary owner.", ar: "يجب أن تحتفظ الشركة بمالكها الرئيسي." },
  SUBSCRIPTION_CONFLICT: { en: "This company already has a current subscription.", ar: "لدى هذه الشركة اشتراك حالي بالفعل." },
  DUPLICATE_PAYMENT: { en: "This payment has already been recorded.", ar: "تم تسجيل هذه الدفعة مسبقًا." },
  VERSION_CONFLICT: { en: "This record was changed by someone else. Refresh and try again.", ar: "عدّل شخص آخر هذا السجل. حدّث الصفحة وحاول مرة أخرى." },
} as const satisfies Record<string, { en: string; ar: string }>;

export type PlatformErrorCode = keyof typeof PLATFORM_ERROR_MESSAGES;
export const PLATFORM_ERROR_CODES = Object.keys(PLATFORM_ERROR_MESSAGES) as PlatformErrorCode[];

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  /** Internal diagnostic only — never rendered, never contains secrets. */
  readonly detail?: string;

  constructor(code: PlatformErrorCode, detail?: string) {
    super(PLATFORM_ERROR_MESSAGES[code].en);
    this.name = "PlatformError";
    this.code = code;
    this.detail = detail;
  }

  localizedMessage(locale: "en" | "ar"): string {
    return PLATFORM_ERROR_MESSAGES[this.code][locale];
  }
}

export function isPlatformError(value: unknown, code?: PlatformErrorCode): value is PlatformError {
  return value instanceof PlatformError && (code === undefined || value.code === code);
}
