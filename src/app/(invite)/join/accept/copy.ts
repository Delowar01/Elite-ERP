import type { Locale } from "@/lib/i18n/dict";

// PO-03D — every string of the public user-invitation acceptance page, in English and native Saudi business Arabic (a
// local dictionary is the accepted pattern for a self-contained screen, as /register/accept's). English is the key, so a
// missing entry still renders correct English; verify:platform-user-acceptance checks that none is missing.
// Placeholders {name} are filled by `fill`; numbers, dates, e-mails and references stay left-to-right in the UI.

const AR: Record<string, string> = {
  "Join your team": "انضم إلى فريقك",
  "You've been invited to join {company} on Elite ERP.": "تمت دعوتك للانضمام إلى {company} على نظام Elite ERP.",
  "Checking your invitation…": "جارٍ التحقق من دعوتك…",
  "Your invitation": "دعوتك",
  "Company": "الشركة",
  "Your e-mail": "بريدك الإلكتروني",
  "Your role": "دورك",
  "Invitation reference": "مرجع الدعوة",
  "Valid until": "صالحة حتى",
  "The company, your e-mail and your role come from your invitation and can't be changed here. If anything is wrong, contact your Elite ERP contact before you accept.":
    "الشركة وبريدك الإلكتروني ودورك مأخوذة من دعوتك ولا يمكن تغييرها هنا. إذا كان فيها أي خطأ، فتواصل مع جهة الاتصال لديك في Elite ERP قبل القبول.",
  "Company plan": "باقة الشركة",
  "Plan": "الباقة",
  "Version {n}": "الإصدار {n}",
  "Trial": "تجربة",
  "User seats": "مقاعد المستخدمين",
  "{occupied} of {seats} in use, including the seat reserved for you": "{occupied} من {seats} مستخدَمة، بما فيها المقعد المحجوز لك",
  "The company's user limit applies to this invitation.": "ينطبق حد المستخدمين في باقة الشركة على هذه الدعوة.",
  "Shown for information; user limits aren't enforced yet.": "للعلم فقط؛ لا تُطبَّق حدود المستخدمين بعد.",
  "Your account": "حسابك",
  "Your name": "اسمك",
  "Password": "كلمة المرور",
  "Confirm password": "تأكيد كلمة المرور",
  "At least 8 characters, with an uppercase letter, a lowercase letter, a number and a symbol.": "8 أحرف على الأقل، وتتضمن حرفًا كبيرًا وحرفًا صغيرًا ورقمًا ورمزًا.",
  "Accept and join": "قبول الدعوة والانضمام",
  "Joining…": "جارٍ الانضمام…",
  "You've joined {company}": "انضممت إلى {company}",
  "Sign in with this e-mail and the password you just chose:": "سجّل الدخول بهذا البريد الإلكتروني وكلمة المرور التي اخترتها للتو:",
  "Your role: {role}": "دورك: {role}",
  "Sign in": "تسجيل الدخول",
  "This invitation link can't be used": "لا يمكن استخدام رابط الدعوة هذا",
  "The link is incomplete, has been withdrawn or isn't valid. Ask your Elite ERP contact for a new invitation.": "الرابط غير مكتمل أو تم سحبه أو غير صالح. اطلب دعوة جديدة من جهة الاتصال لديك في Elite ERP.",
  "This invitation has expired": "انتهت صلاحية هذه الدعوة",
  "Invitations are valid for 72 hours. Ask your Elite ERP contact to send you a new one.": "الدعوات صالحة لمدة 72 ساعة. اطلب من جهة الاتصال لديك في Elite ERP إرسال دعوة جديدة إليك.",
  "This invitation has already been used": "سبق استخدام هذه الدعوة",
  "If you accepted it, sign in with your e-mail and password.": "إذا كنت قد قبلتها، فسجّل الدخول ببريدك الإلكتروني وكلمة المرور.",
  "Too many attempts": "محاولات كثيرة",
  "For your security, wait a few minutes and try again.": "حفاظًا على أمانك، انتظر بضع دقائق ثم حاول مرة أخرى.",
  "We couldn't complete this invitation": "تعذّر إكمال هذه الدعوة",
  "Nothing was created. Try again later, or contact your Elite ERP contact.": "لم يُنشأ أي شيء. حاول مرة أخرى لاحقًا، أو تواصل مع جهة الاتصال لديك في Elite ERP.",
  "This company has no free user seat": "لا يوجد مقعد مستخدم متاح في هذه الشركة",
  "Nothing was created. The company's plan has no free seat for you right now. Contact your Elite ERP contact, then try again.":
    "لم يُنشأ أي شيء. لا يوجد في باقة الشركة مقعد متاح لك حاليًا. تواصل مع جهة الاتصال لديك في Elite ERP، ثم حاول مرة أخرى.",
  "This company can't add members right now": "لا يمكن لهذه الشركة إضافة أعضاء حاليًا",
  "Nothing was created. Contact your Elite ERP contact.": "لم يُنشأ أي شيء. تواصل مع جهة الاتصال لديك في Elite ERP.",
  "Try again": "حاول مرة أخرى",
  "Invitation acceptance isn't available": "قبول الدعوات غير متاح",
  "This service isn't switched on yet. Contact your Elite ERP contact.": "هذه الخدمة غير مفعّلة حاليًا. تواصل مع جهة الاتصال لديك في Elite ERP.",
  "No invitation found in this link": "لا توجد دعوة في هذا الرابط",
  "Open the complete link you received, exactly as it was sent to you.": "افتح الرابط الكامل الذي وصلك كما أُرسل إليك تمامًا.",
  "You're signed in to Elite ERP": "أنت مسجّل الدخول في Elite ERP",
  "To accept an invitation, sign out first, then open your invitation link again.": "لقبول دعوة، سجّل الخروج أولًا ثم افتح رابط الدعوة مرة أخرى.",
  "Sign out": "تسجيل الخروج",
  "Enter your name (up to 200 characters).": "أدخل اسمك (200 حرف كحد أقصى).",
  "Enter a password.": "أدخل كلمة المرور.",
  "Use at most 200 characters.": "استخدم 200 حرف كحد أقصى.",
  "The passwords do not match.": "كلمتا المرور غير متطابقتين.",
  "Must be at least 8 characters.": "يجب ألا تقل عن 8 أحرف.",
  "Must include an uppercase letter.": "يجب أن تتضمن حرفًا كبيرًا.",
  "Must include a lowercase letter.": "يجب أن تتضمن حرفًا صغيرًا.",
  "Must include a number.": "يجب أن تتضمن رقمًا.",
  "Must include a special character.": "يجب أن تتضمن رمزًا خاصًا.",
  "This password is too common. Choose something less guessable.": "كلمة المرور هذه شائعة جدًا. اختر كلمة يصعب تخمينها.",
  "Language": "اللغة",
};

export const JOIN_COPY_KEYS: readonly string[] = Object.keys(AR);

export function copy(locale: Locale, en: string): string {
  return locale === "ar" ? (AR[en] ?? en) : en;
}

/** `copy` with {placeholders} filled (values are inserted as given — the UI keeps them left-to-right). */
export function fill(locale: Locale, en: string, values: Record<string, string | number>): string {
  return copy(locale, en).replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}
