import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
// One versioned aggregate gives the pilot atomic cross-entity updates on SQLite/D1.
export const workspaceState = sqliteTable("workspace_state", {
  id: integer("id").primaryKey(),
  version: integer("version").notNull(),
  payload: text("payload").notNull(),
});
