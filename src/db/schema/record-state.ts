import { pgEnum } from "drizzle-orm/pg-core";

// Soft-delete lifecycle, shared by every table tenantScope() applies to.
// active: normal. archived: hidden from default lists, still real data. deleted: Recycle Bin only.
export const recordStateEnum = pgEnum("record_state", ["active", "archived", "deleted"]);
export type RecordState = (typeof recordStateEnum.enumValues)[number];
