// Bilingual dictionary for the whole app. Every user-facing string added going forward must have
// an entry here (see project convention in CLAUDE.md) — English is the dictionary key, so a call
// site that forgets to register a translation still renders correct English instead of breaking.
// Arabic entries use native Saudi business/ERP phrasing, not literal/mechanical translation.
export type Locale = "en" | "ar";
export const LOCALE_COOKIE = "locale";
export const DEFAULT_LOCALE: Locale = "en";

const DICT: Record<string, string> = {
  // ---- nav groups ----
  Projects: "المشاريع",
  Sales: "المبيعات",
  Purchasing: "المشتريات",
  Inventory: "المخزون",
  Clients: "العملاء",
  Finance: "المالية",
  People: "الموارد البشرية",
  Administration: "الإدارة",
  Configuration: "الإعدادات",

  // ---- nav items ----
  Dashboard: "لوحة التحكم",
  Quotations: "عروض الأسعار",
  "Sales Orders": "أوامر البيع",
  "Proforma Invoices": "الفواتير المبدئية",
  Invoices: "الفواتير",
  "Delivery Challans": "أذون التسليم",
  "Credit Notes": "إشعارات الدائن",
  "Purchase Orders": "أوامر الشراء",
  "Debit Notes": "إشعارات المدين",
  Vendors: "الموردون",
  Products: "المنتجات",
  "Bank Accounts": "الحسابات البنكية",
  "Journal Entry": "قيد اليومية",
  "Chart of Accounts": "دليل الحسابات",
  "Account Ledger": "دفتر الأستاذ",
  "Account Reporting": "التقارير المحاسبية",
  "Payment Records": "سجلات الدفع",
  Expenses: "المصروفات",
  Employees: "الموظفون",
  Departments: "الأقسام",
  Payroll: "الرواتب",
  Attendance: "الحضور والانصراف",
  Leave: "الإجازات",
  Presets: "الإعدادات المسبقة",
  Organization: "إعدادات الشركة",
  Team: "الفريق",

  // ---- shared chrome ----
  "Log out": "تسجيل الخروج",
  Language: "اللغة",
  English: "الإنجليزية",
  Arabic: "العربية",
  "Search anything…": "ابحث عن أي شيء…",
  Favorites: "المفضلة",
  Notifications: "الإشعارات",

  // ---- shared form/table actions ----
  Saved: "تم الحفظ",
  Deleted: "تم الحذف",
  Name: "الاسم",
  Edit: "تعديل",
  Delete: "حذف",
  "Saving…": "جارٍ الحفظ…",
  Save: "حفظ",
  Cancel: "إلغاء",

  // ---- Preset Management ----
  "Preset Management": "إدارة الإعدادات المسبقة",
  "Reusable reference data used across documents and modules.": "بيانات مرجعية قابلة لإعادة الاستخدام عبر المستندات والوحدات.",
  "Tax Rates": "نسب الضريبة",
  "Payment Terms": "شروط الدفع",
  Units: "الوحدات",
  "Note Templates": "قوالب الملاحظات",
  Bundles: "الحزم",
  Numbering: "الترقيم",
  "Product Categories": "فئات المنتجات",
  "Leave Types": "أنواع الإجازات",
  "Expense Categories": "فئات المصروفات",

  "Rate %": "نسبة الضريبة %",
  "Add Tax Preset": "إضافة نسبة ضريبة",
  "No tax presets yet.": "لا توجد نسب ضريبة بعد.",
  "Net Days": "أيام السداد",
  "Add Payment Term": "إضافة شرط دفع",
  "No payment terms yet.": "لا توجد شروط دفع بعد.",
  Abbreviation: "الاختصار",
  "Add Unit": "إضافة وحدة",
  "No units yet.": "لا توجد وحدات بعد.",
  "Add Department": "إضافة قسم",
  "No departments yet.": "لا توجد أقسام بعد.",
  "Add Product Category": "إضافة فئة منتج",
  "No product categories yet.": "لا توجد فئات منتجات بعد.",
  "Days / Year": "أيام / سنة",
  "Add Leave Type": "إضافة نوع إجازة",
  "No leave types yet.": "لا توجد أنواع إجازات بعد.",
  "Add Expense Category": "إضافة فئة مصروف",
  "No expense categories yet.": "لا توجد فئات مصروفات بعد.",

  "No note templates yet.": "لا توجد قوالب ملاحظات بعد.",
  "Document Type": "نوع المستند",
  Preview: "معاينة",
  Any: "أي نوع",
  Default: "افتراضي",
  "Add Note Template": "إضافة قالب ملاحظة",
  "Any document type": "أي نوع مستند",
  Content: "المحتوى",
  "Pre-fill by default on this document type": "تعبئة تلقائية افتراضية لهذا النوع من المستندات",

  "No bundles yet.": "لا توجد حزم بعد.",
  "Bundle Name": "اسم الحزمة",
  Items: "العناصر",
  Manage: "إدارة",
  "Add Bundle": "إضافة حزمة",
  "Select a product.": "اختر منتجًا.",
  Item: "الصنف",
  Qty: "الكمية",
  "Select a product": "اختر منتجًا",

  Prefix: "البادئة",
  "Next Number": "الرقم التالي",
  Padding: "عدد الخانات",

  // ---- document type labels (singular, used in Presets/Numbering) ----
  Quotation: "عرض سعر",
  "Sales Order": "أمر بيع",
  "Proforma Invoice": "فاتورة مبدئية",
  Invoice: "فاتورة",
  "Delivery Challan": "إذن تسليم",
  "Credit Note": "إشعار دائن",
  "Purchase Order": "أمر شراء",
  "Debit Note": "إشعار مدين",

  // ---- Business Settings ----
  "Business Settings": "إعدادات الشركة",
  "Company profile, branding, document defaults, and financial configuration.": "الملف التعريفي للشركة والهوية البصرية وإعدادات المستندات والتهيئة المالية.",
  "Business Details": "بيانات الشركة",
  Logo: "الشعار",
  "Color Theme": "نمط الألوان",
  "Default Terms & Conditions": "الشروط والأحكام الافتراضية",
  "Seal & Signature": "الختم والتوقيع",
  "Print Layout": "تنسيق الطباعة",
  "Roles & Permissions": "الأدوار والصلاحيات",
  "ZATCA E-Invoicing": "الفوترة الإلكترونية زاتكا",

  "Business Name": "اسم الشركة",
  Industry: "القطاع",
  Country: "الدولة",
  Address: "العنوان",
  Phone: "الهاتف",
  Currency: "العملة",
  "Tax ID": "الرقم الضريبي",
  "VAT Number": "الرقم الضريبي (VAT)",
  "Default Language": "اللغة الافتراضية",
  "Save changes": "حفظ التغييرات",

  "Current logo": "الشعار الحالي",
  "Drop a new logo, or click to browse": "أفلت شعارًا جديدًا هنا أو انقر للاستعراض",
  "PNG, JPG, or SVG · square aspect ratio recommended · up to 2 MB": "PNG أو JPG أو SVG · يُفضّل نسبة عرض إلى ارتفاع مربعة · حتى 2 ميجابايت",
  "Upload Logo": "تحميل الشعار",

  "Primary color": "اللون الأساسي",
  "Accent color": "لون التمييز",
  "Save theme": "حفظ النمط",

  "Company Seal": "ختم الشركة",
  "Authorized Signature": "التوقيع المعتمد",
  "PNG or JPG · transparent background recommended": "PNG أو JPG · يُفضّل خلفية شفافة",

  Classic: "كلاسيكي",
  Modern: "عصري",
  Minimal: "بسيط",
  "Bordered table, tinted party boxes": "جدول محدد الحدود، مربعات أطراف ملونة",
  "Minimal rules, accent-only color": "خطوط بسيطة، لون التمييز فقط",
  "Letterhead style, no fills": "أسلوب ترويسة رسمية، بلا تعبئة لونية",
  "Paper Size": "حجم الورق",
  "Margins (mm)": "الهوامش (مم)",
  "Save layout": "حفظ التنسيق",

  "Which note template is pre-filled on each document type. Manage templates under Preset Management → Note Templates.":
    "قالب الملاحظة الذي يُعبَّأ تلقائيًا في كل نوع مستند. أدر القوالب من إدارة الإعدادات المسبقة ← قوالب الملاحظات.",
  "No default templates set yet.": "لم تُحدَّد قوالب افتراضية بعد.",
  "Manage in Preset Management": "الإدارة من إدارة الإعدادات المسبقة",

  "Default Bank Account": "الحساب البنكي الافتراضي",
  "Pre-selected automatically on every new Payment Record and Purchase Order.": "يُحدَّد تلقائيًا في كل سجل دفع وأمر شراء جديد.",
  None: "بلا",
  "Fiscal Year Start": "بداية السنة المالية",
  "Registration Status": "حالة التسجيل",
  Registered: "مسجَّل",
  "Not Registered": "غير مسجَّل",
  "Default Tax Treatment": "المعاملة الضريبية الافتراضية",
  "Exclusive of VAT": "غير شامل ضريبة القيمة المضافة",
  "Inclusive of VAT": "شامل ضريبة القيمة المضافة",
  "Rounding Rule": "قاعدة التقريب",
  "Round to nearest 0.01 (Halala)": "التقريب لأقرب 0.01 (هللة)",
  "Round to nearest 1": "التقريب لأقرب 1",

  January: "يناير", February: "فبراير", March: "مارس", April: "أبريل", May: "مايو", June: "يونيو",
  July: "يوليو", August: "أغسطس", September: "سبتمبر", October: "أكتوبر", November: "نوفمبر", December: "ديسمبر",

  "Module access per role, as currently enforced in the app. Assign a member's role from Team. Owner and Admin currently have identical access — role-level differentiation between them isn't built yet.":
    "صلاحيات الوصول لكل دور، وفق ما هو مطبَّق حاليًا في النظام. عيّن دور العضو من الفريق. المالك والمشرف لديهما حاليًا نفس الصلاحيات — التمييز بينهما على مستوى الدور لم يُبنَ بعد.",
  Role: "الدور",
  Owner: "المالك",
  Admin: "مشرف",
  Staff: "موظف",
  "Full Access": "وصول كامل",
  "View Only": "عرض فقط",
  "No Access": "بلا وصول",
  "Permanently deleting a record from any Recycle Bin additionally requires Owner or Admin, regardless of module.":
    "الحذف النهائي لأي سجل من سلة المحذوفات يتطلب أيضًا صلاحية المالك أو المشرف، بغض النظر عن الوحدة.",

  "The connection this organization uses to comply with ZATCA Phase 1/2 e-invoicing. The QR code and hash shown on every Tax Invoice come from this integration.":
    "الاتصال الذي تستخدمه هذه المؤسسة للامتثال للفوترة الإلكترونية زاتكا المرحلة 1/2. رمز QR والبصمة الظاهران في كل فاتورة ضريبية مصدرهما هذا التكامل.",
  "Integration Status": "حالة التكامل",
  Connected: "متصل",
  "Not Connected": "غير متصل",
  Environment: "البيئة",
  Production: "بيئة الإنتاج",
  Sandbox: "بيئة تجريبية",
  "Certificate expires": "تاريخ انتهاء الشهادة",
  "Not connected yet — ZATCA onboarding is built alongside the Invoice module.": "لم يتم الاتصال بعد — سيُبنى إعداد زاتكا مع وحدة الفواتير.",

  // ---- Team ----
  "Members of your organization and their access level.": "أعضاء مؤسستك ومستوى صلاحياتهم.",
  Status: "الحالة",
  Active: "نشط",
  Inactive: "غير نشط",
  "Member actions": "إجراءات العضو",
  Make: "تعيين كـ",
  Deactivate: "إلغاء التفعيل",
  Activate: "تفعيل",
  "Add Team Member": "إضافة عضو للفريق",
  "Temporary Password": "كلمة مرور مؤقتة",
  "No email invites are sent yet — share this password with the new member directly.": "لا تُرسل دعوات بريد إلكتروني حاليًا — شارك كلمة المرور هذه مع العضو الجديد مباشرة.",
};

export function t(locale: Locale, en: string): string {
  if (locale === "en") return en;
  return DICT[en] ?? en;
}
