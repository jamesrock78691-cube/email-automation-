import { db } from "./index";
import { users, gmailAccounts, templates, campaigns, queue, settings } from "./schema";
import { eq } from "drizzle-orm";

export async function seedDatabase() {
  try {
    // Check if user exists
    const existingUsers = await db.select().from(users).limit(1);
    if (existingUsers.length === 0) {
      console.log("Seeding database with default admin user...");
      await db.insert(users).values({
        username: "admin",
        passwordHash: "admin123", // For simple direct or hash login in this production V1
        role: "admin",
      });
    }

    // Check templates
    const existingTemplates = await db.select().from(templates).limit(1);
    if (existingTemplates.length === 0) {
      console.log("Seeding default templates...");
      
      // Template 1: General Notification
      await db.insert(templates).values({
        id: 1,
        name: "Trademark Notification Template",
        subject: "Action Required: Trademark Status Update for {{mark_name}} - Serial #{{serial_no}}",
        bodyHtml: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333333; line-height: 1.6; }
    .container { max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    .header { background: linear-gradient(135deg, #1e3a8a, #3b82f6); color: #ffffff; padding: 30px 20px; text-align: center; }
    .content { padding: 30px 25px; background-color: #ffffff; }
    .meta-table { width: 100%; border-collapse: collapse; margin: 20px 0; background-color: #f8fafc; border-radius: 6px; overflow: hidden; }
    .meta-table td { padding: 12px 15px; border-bottom: 1px solid #e2e8f0; }
    .meta-table td.label { font-weight: bold; color: #475569; width: 40%; }
    .btn { display: inline-block; background-color: #2563eb; color: #ffffff !important; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 15px; text-align: center; }
    .footer { background-color: #f1f5f9; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0; font-size: 24px; letter-spacing: 0.5px;">Intellectual Property Notification</h2>
    </div>
    <div class="content">
      <p>Dear Valued Client,</p>
      <p>We are writing to provide you with an official status update regarding your trademark registration application. Please find the details of the filed application below:</p>
      
      <table class="meta-table">
        <tr>
          <td class="label">Reference Number</td>
          <td><strong>{{reference_no}}</strong></td>
        </tr>
        <tr>
          <td class="label">Serial Number</td>
          <td><strong>{{serial_no}}</strong></td>
        </tr>
        <tr>
          <td class="label">Mark Name</td>
          <td><span style="color: #2563eb; font-weight: bold;">{{mark_name}}</span></td>
        </tr>
        <tr>
          <td class="label">Filing Date</td>
          <td>{{filing_date}}</td>
        </tr>
      </table>

      <p>Your action is requested to verify the listed data. Please review the attached documentation. If any changes are required, click the button below to connect with our legal processing desk immediately.</p>
      
      <div style="text-align: center;">
        <a href="https://example.com/verify?ref={{reference_no}}&serial={{serial_no}}" class="btn">Verify & Approve Trademark Details</a>
      </div>
      
      <p style="margin-top: 25px; font-size: 13px; color: #64748b;">Note: This is an automated update issued on {{today}}. Please do not reply directly to this email.</p>
    </div>
    <div class="footer">
      <p>&copy; Intellectual Property & Trademark Protection Bureau. All rights reserved.</p>
      <p>This message was intended for {{email}}.</p>
    </div>
  </div>
  {{tracking_pixel}}
</body>
</html>`,
        attachmentsJson: JSON.stringify([{ filename: "Trademark_Guide.pdf" }, { filename: "Official_Filing_Summary.pdf" }])
      });

      // Template 2: Renewal Template
      await db.insert(templates).values({
        id: 2,
        name: "Trademark Renewal Advisory",
        subject: "URGENT RENEWAL: Trademark {{mark_name}} (Serial No: {{serial_no}}) requires attention",
        bodyHtml: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; color: #222222; }
    .box { max-width: 550px; margin: 20px auto; border: 2px solid #dc2626; border-radius: 4px; padding: 25px; }
    .warning-header { color: #dc2626; font-size: 20px; font-weight: bold; margin-bottom: 15px; border-bottom: 2px solid #dc2626; padding-bottom: 10px; }
    .info-list { margin: 15px 0; background: #fff5f5; padding: 15px; border-left: 4px solid #dc2626; }
    .info-list p { margin: 6px 0; }
  </style>
</head>
<body>
  <div class="box">
    <div class="warning-header">⚠️ Trademark Expiration & Renewal Advisory</div>
    <p>Dear Associate,</p>
    <p>This is an automated legal compliance alert. The trademark listed below has reached its filing critical assessment window:</p>
    
    <div class="info-list">
      <p><strong>Mark Name:</strong> {{mark_name}}</p>
      <p><strong>Serial Number:</strong> {{serial_no}}</p>
      <p><strong>Reference No:</strong> {{reference_no}}</p>
      <p><strong>Filing Date:</strong> {{filing_date}}</p>
    </div>

    <p>To avoid cancellation, a declaration of continued use must be submitted. Please inspect the attached documents for the required forms and schedule guidelines.</p>
    <p>Regards,<br/>IP Renewal Team</p>
  </div>
  {{tracking_pixel}}
</body>
</html>`,
        attachmentsJson: JSON.stringify([{ filename: "Renewal_Instructions.pdf" }])
      });
    }

    // Check gmail_accounts
    const existingAccounts = await db.select().from(gmailAccounts).limit(1);
    if (existingAccounts.length === 0) {
      console.log("Seeding default Gmail accounts for rotation...");
      await db.insert(gmailAccounts).values([
        {
          email: "rotator1@gmail.com",
          appPassword: "abcd efgh ijkl mnop", // dummy app password
          smtpHost: "smtp.gmail.com",
          smtpPort: 465,
          secure: true,
          priority: 2,
          dailyLimit: 300,
          minuteLimit: 30,
          sentToday: 0,
          sentThisminute: 0,
          status: "enabled",
        },
        {
          email: "rotator2@gmail.com",
          appPassword: "qrst uvwx yzab cdef", // dummy app password
          smtpHost: "smtp.gmail.com",
          smtpPort: 465,
          secure: true,
          priority: 1,
          dailyLimit: 200,
          minuteLimit: 20,
          sentToday: 0,
          sentThisminute: 0,
          status: "enabled",
        }
      ]);
    }

    // Check campaigns
    const existingCampaigns = await db.select().from(campaigns).limit(1);
    if (existingCampaigns.length === 0) {
      console.log("Seeding demo campaign...");
      await db.insert(campaigns).values({
        id: 1,
        name: "Inaugural Trademark Outreach Campaign",
        templateId: 1,
        status: "running",
      });

      // Insert dummy queue items
      const existingQueue = await db.select().from(queue).limit(1);
      if (existingQueue.length === 0) {
        await db.insert(queue).values([
          {
            campaignId: 1,
            referenceNo: "REF-2026-9081",
            serialNo: "90812354",
            markName: "GLOW-TECH INDUSTRIES",
            filingDate: "2026-01-15",
            email: "demo-recipient-1@example.com",
            cc: "cc-partner-1@example.com",
            bcc: "",
            subject: "Action Required: Trademark Status Update for GLOW-TECH INDUSTRIES - Serial #90812354",
            templateId: 1,
            status: "pending",
            trackingId: "track_glowtech_90812354",
            tries: 0,
          },
          {
            campaignId: 1,
            referenceNo: "REF-2026-4421",
            serialNo: "88412953",
            markName: "AURA BEVERAGES",
            filingDate: "2025-11-22",
            email: "demo-recipient-2@example.com",
            cc: "",
            bcc: "audit@example.com",
            subject: "Action Required: Trademark Status Update for AURA BEVERAGES - Serial #88412953",
            templateId: 1,
            status: "sent",
            trackingId: "track_aurabeverages_88412953",
            tries: 1,
            gmailUsedEmail: "rotator1@gmail.com",
            sentAt: new Date(),
            openCount: 2,
            lastOpenedAt: new Date(),
          },
          {
            campaignId: 1,
            referenceNo: "REF-2026-7712",
            serialNo: "91726354",
            markName: "VORTEX CLOUD SYSTEMS",
            filingDate: "2026-02-10",
            email: "vortex-test@example.com",
            cc: "",
            bcc: "",
            subject: "Action Required: Trademark Status Update for VORTEX CLOUD SYSTEMS - Serial #91726354",
            templateId: 1,
            status: "failed",
            trackingId: "track_vortex_91726354",
            tries: 3,
            errorMessage: "Authentication failed. App password is invalid or expired.",
            gmailUsedEmail: "rotator2@gmail.com",
          }
        ]);
      }
    }

    console.log("Database seeded successfully!");
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}
