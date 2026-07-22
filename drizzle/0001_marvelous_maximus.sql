ALTER TABLE "quotations" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "proforma_invoices" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "delivery_challans" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "delivery_challans" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "debit_notes" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "debit_notes" ADD COLUMN "deleted_at" timestamp;