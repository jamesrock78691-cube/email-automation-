import fs from "fs";
import { pool } from "@/db";

export type NodemailerAttachment = {
  filename: string;
  content?: Buffer;
  path?: string;
  contentType?: string;
};

/**
 * Resolve template attachmentsJson into nodemailer attachments.
 * Order: inline contentBase64 → settings att_blob:filename → local disk path.
 */
export async function loadTemplateAttachments(
  attachmentsJson: string | null | undefined,
  templateId?: number | null
): Promise<NodemailerAttachment[]> {
  const attachmentsList: NodemailerAttachment[] = [];
  if (!attachmentsJson) {
    console.log(`[ATTACH] template #${templateId} has no attachmentsJson`);
    return attachmentsList;
  }

  let parsed: any[];
  try {
    parsed = JSON.parse(attachmentsJson || "[]");
  } catch (e) {
    console.error("[ATTACH] invalid attachmentsJson", e);
    return attachmentsList;
  }
  if (!Array.isArray(parsed)) return attachmentsList;

  console.log(
    `[ATTACH] template #${templateId} has ${parsed.length} attachment meta`
  );

  for (const att of parsed) {
    const filename = att.originalName || att.filename || "attachment";
    const storedName = String(att.filename || "").trim();

    if (att.contentBase64 && typeof att.contentBase64 === "string") {
      try {
        const buf = Buffer.from(att.contentBase64, "base64");
        if (buf.length > 0) {
          attachmentsList.push({
            filename,
            content: buf,
            contentType: att.contentType || undefined,
          });
          console.log(`[ATTACH] inline base64 ok: ${filename} (${buf.length}b)`);
          continue;
        }
      } catch (e) {
        console.error("Bad base64 attachment", filename, e);
      }
    }

    if (storedName) {
      try {
        const blobRes = await pool.query(
          `SELECT value FROM settings WHERE key = $1 LIMIT 1`,
          [`att_blob:${storedName}`]
        );
        if (blobRes.rows?.length) {
          const blob = JSON.parse(blobRes.rows[0].value || "{}");
          if (blob.contentBase64) {
            const buf = Buffer.from(blob.contentBase64, "base64");
            attachmentsList.push({
              filename: blob.originalName || filename,
              content: buf,
              contentType: blob.contentType || att.contentType || undefined,
            });
            console.log(`[ATTACH] att_blob ok: ${storedName} (${buf.length}b)`);
            continue;
          }
        } else {
          console.warn(`[ATTACH] missing att_blob:${storedName}`);
        }
      } catch (e) {
        console.error("att_blob load failed", storedName, e);
      }
    }

    if (att.path && fs.existsSync(att.path)) {
      attachmentsList.push({
        filename,
        path: att.path,
        contentType: att.contentType || undefined,
      });
      console.log(`[ATTACH] disk path ok: ${att.path}`);
    } else {
      console.warn(
        `[ATTACH] FAILED to resolve: filename=${storedName} original=${filename}`
      );
    }
  }

  console.log(`[ATTACH] final count for send: ${attachmentsList.length}`);
  return attachmentsList;
}
