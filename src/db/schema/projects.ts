import { pgTable, serial, integer, text, numeric, date, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { customersTable } from "./customers";
import { employeesTable } from "./hr";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  clientId: integer("client_id").references(() => customersTable.id),
  status: text("status").notNull().default("planned"), // planned | active | on_hold | completed | cancelled
  startDate: date("start_date"),
  endDate: date("end_date"),
  budget: numeric("budget", { precision: 14, scale: 2 }),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertProjectSchema = createInsertSchema(projectsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  assigneeId: integer("assignee_id").references(() => employeesTable.id),
  status: text("status").notNull().default("todo"), // todo | in_progress | done | blocked
  priority: text("priority").default("medium"), // low | medium | high
  dueDate: date("due_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;

export const timeLogsTable = pgTable("time_logs", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  taskId: integer("task_id")
    .notNull()
    .references(() => tasksTable.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employeesTable.id),
  date: date("date").notNull(),
  hours: numeric("hours", { precision: 6, scale: 2 }).notNull(),
  notes: text("notes"),
  billable: boolean("billable").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertTimeLogSchema = createInsertSchema(timeLogsTable).omit({ id: true, createdAt: true });
export type InsertTimeLog = z.infer<typeof insertTimeLogSchema>;
export type TimeLog = typeof timeLogsTable.$inferSelect;
