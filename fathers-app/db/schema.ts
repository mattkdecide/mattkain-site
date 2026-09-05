import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(),
  userId: text("user_id").notNull(),
  userEmail: text("user_email").notNull(),
  dad: text("dad").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const googleConnections = sqliteTable("google_connections", {
  userId: text("user_id").primaryKey(),
  userEmail: text("user_email").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  tokenIv: text("token_iv").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const googleAppSettings = sqliteTable("google_app_settings", {
  userId: text("user_id").primaryKey(),
  clientId: text("client_id").notNull(),
  encryptedClientSecret: text("encrypted_client_secret").notNull(),
  secretIv: text("secret_iv").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const pickerSessions = sqliteTable("picker_sessions", {
  id: text("id").primaryKey(),
  googleSessionId: text("google_session_id").notNull(),
  userId: text("user_id").notNull(),
  dad: text("dad").notNull(),
  status: text("status").notNull(),
  nextPageToken: text("next_page_token"),
  importedCount: integer("imported_count").notNull().default(0),
  lockToken: text("lock_token"),
  lockUntil: integer("lock_until").notNull().default(0),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("idx_picker_sessions_user").on(table.userId, table.createdAt)]);

export const photoCandidates = sqliteTable("photo_candidates", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  dad: text("dad").notNull(),
  googleMediaId: text("google_media_id").notNull(),
  pickerSessionId: text("picker_session_id"),
  r2Key: text("r2_key").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  caption: text("caption").notNull().default(""),
  capturedAt: text("captured_at"),
  width: integer("width"),
  height: integer("height"),
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_candidates_user_dad_media").on(table.userId, table.dad, table.googleMediaId),
  index("idx_candidates_picker_session").on(table.pickerSessionId),
  index("idx_candidates_r2_key").on(table.r2Key),
  index("idx_candidates_user_dad_status").on(table.userId, table.dad, table.status),
]);
