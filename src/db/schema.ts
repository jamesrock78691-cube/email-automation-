import { pgTable, serial, text, integer, timestamp, boolean, pgEnum } from "drizzle-orm/pg-core";

// Users for Admin Login
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").default("admin").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Gmail / SMTP Accounts for Rotation
export const gmailAccounts = pgTable("gmail_accounts", {
  id: serial("id").primaryKey(),

  // Login Email
  email: text("email").notNull().unique(),



  // Sender Display Name
  senderName: text("sender_name")
    .default("Trademark Processing Department")
    .notNull(),

  // Reply-To Email
  replyToEmail: text("reply_to_email"),

  // Provider
  provider: text("provider")
    .default("gmail")
    .notNull(), // gmail | outlook | zoho | hostinger | namecheap | godaddy | cpanel | custom

  // SMTP Password / App Password
  appPassword: text("app_password").notNull(),

  // SMTP Settings
  smtpHost: text("smtp_host")
    .default("smtp.gmail.com")
    .notNull(),

  smtpPort: integer("smtp_port")
    .default(465)
    .notNull(),

  secure: boolean("secure")
    .default(true)
    .notNull(),

  // Rotation
  priority: integer("priority")
    .default(1)
    .notNull(),

  dailyLimit: integer("daily_limit")
    .default(500)
    .notNull(),

  minuteLimit: integer("minute_limit")
    .default(50)
    .notNull(),

  sentToday: integer("sent_today")
    .default(0)
    .notNull(),

  sentThisMinute: integer("sent_this_minute")
    .default(0)
    .notNull(),

  // Status
  status: text("status")
    .default("enabled")
    .notNull(),

  lastUsedAt: timestamp("last_used_at"),

  cooldownUntil: timestamp("cooldown_until"),

  errorCount: integer("error_count")
    .default(0)
    .notNull(),

  createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),
});

// Email Templates
export const templates = pgTable("templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  bodyHtml: text("body_html").notNull(),
bodyText: text("body_text").default("").notNull(),
 // Rich HTML content
  attachmentsJson: text("attachments_json").default("[]").notNull(), // Array of {filename, url_or_path}
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Campaigns
export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  templateId: integer("template_id").references(() => templates.id, { onDelete: "set null" }),
  status: text("status").default("draft").notNull(), // 'draft', 'running', 'paused', 'completed'
  scheduledAt: timestamp("scheduled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Queue System for sending emails
export const queue = pgTable("queue", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
  referenceNo: text("reference_no").notNull(),
  serialNo: text("serial_no").notNull(),
  markName: text("mark_name").notNull(),
  filingDate: text("filing_date").notNull(),
  email: text("email").notNull(),
  cc: text("cc"),
  bcc: text("bcc"),
  subject: text("subject").notNull(),
  templateId: integer("template_id").references(() => templates.id, { onDelete: "set null" }),
  status: text("status").default("pending").notNull(), // 'pending', 'sending', 'sent', 'failed'
  tries: integer("tries").default(0).notNull(),
  maxTries: integer("max_tries").default(3).notNull(),
  errorMessage: text("error_message"),
  retryAfter: timestamp("retry_after"),           // kab dobara try karni hai
  lastErrorType: text("last_error_type"),         // temporary | permanent | auth | rate_limit
  trackingId: text("tracking_id").notNull().unique(), // unique tracking key
  gmailUsedId: integer("gmail_used_id").references(() => gmailAccounts.id, { onDelete: "set null" }),
  gmailUsedEmail: text("gmail_used_email"),
  sentAt: timestamp("sent_at"),
  openCount: integer("open_count").default(0).notNull(),
  lastOpenedAt: timestamp("last_opened_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Open Tracking logs
export const trackingLogs = pgTable("tracking_logs", {
  id: serial("id").primaryKey(),
  queueId: integer("queue_id").references(() => queue.id, { onDelete: "cascade" }),
  trackingId: text("tracking_id").notNull(),
  openedAt: timestamp("opened_at").defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  browser: text("browser"),
  device: text("device"),
  country: text("country"),
});

// General Settings
export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
