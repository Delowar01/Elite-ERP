# DEV-UI-01.2 — status / domain matrix

Generated from `src/lib/status-registry.ts` (the single source). Every row is pinned by
`verify/verify-status-registry.mts`.

## quotation

Source: stored `status` column

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `draft` | neutral |  | Draft | `draft` | مسودة |
| `sent` | info |  | Sent | `sent` | مُرسل |
| `accepted` | success |  | Accepted | `accepted` | مقبول |
| `rejected` | danger |  | Rejected | `rejected` | مرفوض |
| `expired` | warning |  | Expired | `expired` | منتهي الصلاحية |

## sales_order

Source: stored `status` column

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `draft` | neutral |  | Draft | `draft` | مسودة |
| `confirmed` | info |  | Confirmed | `confirmed` | مؤكد |
| `fulfilled` | success |  | Fulfilled | `fulfilled` | منفّذ |
| `cancelled` | danger |  | Cancelled | `cancelled` | ملغى |

## proforma_invoice

Source: stored `status` column

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `draft` | neutral |  | Draft | `draft` | مسودة |
| `sent` | info |  | Sent | `sent` | مُرسل |

## sales_invoice

Source: stored `status` column

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `draft` | neutral |  | Draft | `draft` | مسودة |
| `sent` | info |  | Sent | `sent` | مُرسل |
| `partially_paid` | warning |  | Partially paid | `partially_paid` | مدفوع جزئيًا |
| `paid` | success |  | Paid | `paid` | مدفوع |
| `void` | danger |  | Void | `void` | ملغاة |

## delivery_challan

Source: stored `status` column

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `draft` | neutral |  | Draft | `draft` | مسودة |
| `dispatched` | info |  | Dispatched | `dispatched` | تم الشحن |
| `delivered` | success |  | Delivered | `delivered` | تم التسليم |

## credit_note

Source: stored `status` column

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `draft` | neutral |  | Draft | `draft` | مسودة |
| `issued` | corrective |  | Issued | `issued` | صادر |
| `reversed` | neutral |  | Reversed | `reversed` | معكوس |

## debit_note

Source: stored `status` column

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `draft` | neutral |  | Draft | `draft` | مسودة |
| `issued` | corrective |  | Issued | `issued` | صادر |
| `reversed` | neutral |  | Reversed | `reversed` | معكوس |

## purchase_order

Source: stored `status` column

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `draft` | neutral |  | Draft | `draft` | مسودة |
| `ordered` | info |  | Ordered | `ordered` | تم الطلب |
| `received` | success |  | Received | `received` | تم الاستلام |
| `cancelled` | danger |  | Cancelled | `cancelled` | ملغى |

## invoice_settlement

Source: derived (dashboard: from partially_paid / sent + due date)

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `paid` | success |  | Paid | `paid` | مدفوع |
| `partial` | warning |  | Partial | `status.partial` | مدفوع جزئيًا |
| `pending` | info |  | Pending | `status.invoice_pending` | بانتظار السداد |
| `overdue` | danger |  | Overdue | `status.overdue` | متأخر السداد |

## project

Source: stored `status` column

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `planned` | neutral |  | Planned | `planned` | مخطط |
| `active` | info |  | Active | `active` | نشط |
| `on_hold` | warning |  | On hold | `on_hold` | معلَّق |
| `completed` | success |  | Completed | `completed` | مكتمل |
| `cancelled` | danger |  | Cancelled | `cancelled` | ملغى |

## project_health

Source: derived (project-costing health)

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `profitable` | success |  | Profitable | `Profitable` | رابح |
| `loss` | danger |  | Loss | `Loss` | خسارة |
| `no_revenue` | neutral |  | No Revenue Yet | `No Revenue Yet` | لا توجد إيرادات بعد |

## task

Source: stored `status` column

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `todo` | neutral |  | To do | `status.todo` | للتنفيذ |
| `in_progress` | info |  | In progress | `status.in_progress` | قيد التنفيذ |
| `blocked` | danger |  | Blocked | `status.blocked` | معطَّل |
| `done` | success |  | Done | `status.done` | تم |

## leave

Source: stored `status` column

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `pending` | warning | yes | Pending | `pending` | قيد الانتظار |
| `approved` | success |  | Approved | `approved` | معتمد |
| `rejected` | danger |  | Rejected | `rejected` | مرفوض |

## attendance

Source: stored `status` column

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `present` | success |  | Present | `status.present` | حاضر |
| `late` | warning |  | Late | `status.late` | متأخر |
| `on_leave` | info |  | On leave | `status.on_leave` | في إجازة |
| `absent` | neutral |  | Absent | `status.absent` | غائب |

## employee

Source: stored `status` column

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `active` | success |  | Active | `active` | نشط |
| `inactive` | neutral |  | Inactive | `inactive` | غير نشط |

## payroll_period

Source: derived (does a run exist for the month)

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `draft` | warning | yes | Draft | `draft` | مسودة |
| `processed` | success |  | Processed | `processed` | تمت المعالجة |

## payroll_run

Source: stored `status` column

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `processed` | success |  | Processed | `processed` | تمت المعالجة |

## record_state

Source: record_state enum

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `archived` | neutral |  | Archived | `status.archived` | مؤرشف |
| `deleted` | danger |  | Deleted | `status.deleted` | محذوف |

## active_flag

Source: isActive boolean

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `active` | success |  | Active | `active` | نشط |
| `inactive` | neutral |  | Inactive | `inactive` | غير نشط |

## stock

Source: derived (qty on hand vs reorder level)

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `low_stock` | warning |  | Low stock | `status.low_stock` | مخزون منخفض |
| `in_stock` | success |  | In stock | `status.in_stock` | متوفر |

## payment

Source: reversedAt set

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `reversed` | neutral |  | Reversed | `Reversed` | معكوسة |

## consent

Source: granted boolean

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `granted` | success |  | Granted | `Granted` | ممنوحة |
| `withdrawn` | neutral |  | Withdrawn | `Withdrawn` | مسحوبة |

## zatca_state

Source: org ZATCA flag

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `enabled` | success |  | Enabled — Locked | `Enabled — Locked` | مُفعّل — مقفل |
| `not_enabled` | neutral |  | Not Enabled | `Not Enabled` | غير مُفعّل |

## exchange_rate_state

Source: derived (rate age)

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `stale` | warning |  | Stale | `Stale` | قديم |

## security_severity

Source: stored `status` column

| Raw value | Tone | Pulse | English | i18n key | Arabic |
|---|---|---|---|---|---|
| `info` | neutral |  | Info | `status.severity_info` | معلومات |
| `low` | info |  | Low | `status.severity_low` | منخفض |
| `medium` | warning |  | Medium | `status.severity_medium` | متوسط |
| `high` | danger |  | High | `status.severity_high` | مرتفع |
| `critical` | danger |  | Critical | `status.severity_critical` | حرج |
