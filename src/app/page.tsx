
"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  Mail,
  RotateCw,
  Sliders,
  FileCode,
  Layers,
  Database,
  PlusCircle,
  Play,
  Pause,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Eye,
  Trash2,
  FileSpreadsheet,
  Cpu,
  Smartphone,
  Globe,
  Settings,
  HelpCircle,
  Users
} from "lucide-react";

const RichTextComposer = dynamic(() => import("../components/RichTextComposer"), { ssr: false });


// Mock CSV / Spreadsheet text to pre-load so the user can easily test
const DEFAULT_SHEETS_CSV = `Reference No,Serial No,Mark Name,Filing Date,Email,CC,BCC,Subject,Template,Attachment
REF-2026-1011,90213423,NEXUS PRIME DRONES,2026-03-01,operator@nexusprime.test,finance@nexusprime.test,,Trademark Status Urgent Alert for NEXUS PRIME DRONES - Serial #90213423,1,Trademark_Guide.pdf
REF-2026-5592,88432104,OMNIVERSE SOFTWARE LLC,2026-01-20,ceo@omniverse-soft.test,legal@omniverse-soft.test,,Trademark Advisory Notice for OMNIVERSE SOFTWARE LLC - Serial #88432104,1,Official_Filing_Summary.pdf
REF-2026-8812,91230491,ZENITH ORGANICS INC,2025-12-15,admin@zenithorganics.test,,,Advisory: Trademark Renewal is Due for ZENITH ORGANICS INC - Serial #91230491,2,Renewal_Instructions.pdf`;

export default function EmailAutomationDashboard() {
  // Tabs: 'dashboard', 'gmail_accounts', 'sheets_importer', 'templates', 'queue_logs'
  const [activeTab, setActiveTab] = useState("compose"); 
  

  // Loading states
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
const [composeMode, setComposeMode] = useState<"html" | "source">("html");
const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
const [composeVariables, setComposeVariables] = useState({
  reference_no: "",
  serial_no: "",
  mark_name: "",
  filing_date: "",
  email: "",
  today: new Date().toISOString().slice(0, 10),
});

  // Auth / Admin
  const [authChecked, setAuthChecked] = useState(false);
  const [authUser, setAuthUser] = useState<{
    id: number;
    username: string;
    role: string;
    permissions?: string[];
    stats?: { totalSent: number; sentToday: number; dailyLimit: number };
  } | null>(null);
  const [agentTotals, setAgentTotals] = useState({ totalAllSent: 0, totalToday: 0, agents: 0 });
  const [authToken, setAuthToken] = useState<string>("");
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginPanel, setLoginPanel] = useState<"admin" | "operator">("admin");
  const [showForgot, setShowForgot] = useState(false);
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotInfo, setForgotInfo] = useState("");
  const [resetRequests, setResetRequests] = useState<any[]>([]);
  const [smtpAssignments, setSmtpAssignments] = useState<Record<string, number[]>>({});
  const [loginLoading, setLoginLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Compose field suggestion history
  const [composeSuggestions, setComposeSuggestions] = useState<Record<string, string[]>>({
    fromName: [], fromEmail: [], replyTo: [], subject: [],
  });
  const [activeSuggestField, setActiveSuggestField] = useState<string | null>(null);
  const [showNewUserPassword, setShowNewUserPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showGmailPassword, setShowGmailPassword] = useState(false);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [newUserForm, setNewUserForm] = useState({
    username: "",
    password: "",
    role: "operator",
    dailyLimit: 100,
    permissions: ["compose"] as string[],
  });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "" });
  const [editingPermsUser, setEditingPermsUser] = useState<any>(null);
const [showPreview, setShowPreview] = useState(false);

  // Data states
  const [stats, setStats] = useState<any>({
    totalEmails: 0,
    sent: 0,
    pending: 0,
    sending: 0,
    failed: 0,
    opened: 0,
    openRate: "0%",
    activeGmailCount: 0,
    totalGmailCount: 0,
    templatesCount: 0,
    campaignsCount: 0,
  });
  const [gmailAccounts, setGmailAccounts] = useState<any[]>([]);
  const [queueItems, setQueueItems] = useState<any[]>([]);
  const [recentOpens, setRecentOpens] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);

  // State for adding/editing Gmail Account
  const [editingGmail, setEditingGmail] = useState<any>(null);
 const [gmailForm, setGmailForm] = useState({
  id: "",
  email: "",
  senderName: "Trademark Processing Department",
  replyToEmail: "",
  provider: "gmail",
  appPassword: "",
  smtpHost: "smtp.gmail.com",
  smtpPort: 465,
  secure: true,
  priority: 1,
  dailyLimit: 500,
  minuteLimit: 50,
  status: "enabled",
});

  // State for adding/editing Template
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [templateEditorKey, setTemplateEditorKey] = useState(0);
  const [templateForm, setTemplateForm] = useState({
    id: "",
    name: "",
    subject: "",
    bodyHtml: "",
    bodyText: "",
    attachmentsJson: "[]",
  });

const [uploadingAttachment, setUploadingAttachment] = useState(false);

const [previewOpen, setPreviewOpen] = useState(false);

const [previewMode, setPreviewMode] = useState<"html" | "text">("html");

  // State for adding Campaign
  const [campaignForm, setCampaignForm] = useState({
    name: "",
    templateId: "",
    status: "running",
  });
const [manualEmailForm, setManualEmailForm] = useState({
  fromName: "",
  fromEmail: "",
  replyTo: "",
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  html: "",
  plainText: "",
  priority: "normal",
  tagline: "",
  smtpAccountId: "",
});


const quillModules = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike"],
    [{ color: [] }, { background: [] }],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ align: [] }],
    ["link"],
    ["clean"],
  ],
};

const quillFormats = [
  "header",
  "bold",
  "italic",
  "underline",
  "strike",
  "color",
  "background",
  "list",
  "bullet",
  "align",
  "link",
];


  // Spreadsheet Simulator text State
  const [spreadsheetText, setSpreadsheetText] = useState(DEFAULT_SHEETS_CSV);
  const [importCampaignId, setImportCampaignId] = useState("1");

  // Worker Auto-Runner State
  const [autoRunActive, setAutoRunActive] = useState(false);
  const [autoRunLogs, setAutoRunLogs] = useState<string[]>([]);
  const [autoRunTimer, setAutoRunTimer] = useState<any>(null);

  // Fetch all initial data
  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setErrorMsg("");
      const res = await fetch("/api/dashboard");
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
        setGmailAccounts(data.accounts || []);
        setQueueItems(data.recentQueue || []);
        setRecentOpens(data.recentOpens || []);
      } else {
        setErrorMsg(data.error || "Failed to load dashboard data");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Network error loading dashboard");
    } finally {
      setLoading(false);
    }
  };

  // Fetch templates & campaigns
  const loadTemplatesAndCampaigns = async () => {
    try {
      const tRes = await fetch("/api/template", { headers: authHeaders() });
      const tData = await tRes.json();
      if (tData.success) setTemplates(tData.list || []);

      const cRes = await fetch("/api/campaign");
      const cData = await cRes.json();
      if (cData.success) setCampaigns(cData.list || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  // Compose field suggestions history (must be before any early return)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("compose_suggestions_v1");
      if (raw) setComposeSuggestions(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    if (authUser) {
      loadDashboardData();
      loadTemplatesAndCampaigns();
      // Operators only see compose
      if (authUser.role === "operator") {
        setActiveTab("compose");
      }
    }
  }, [authUser]);

  useEffect(() => {
    if (activeTab === "admin" && authUser) {
      loadAdminUsers();
      loadResetRequests();
      loadSmtpAssignments();
    }
    if (activeTab === "gmail_accounts" && authUser) {
      loadAdminUsers();
      loadSmtpAssignments();
    }
    if ((activeTab === "templates" || activeTab === "compose") && authUser) {
      loadTemplatesAndCampaigns();
    }
  }, [activeTab, authUser]);

  // Poll password-reset notifications for super admin / admin
  useEffect(() => {
    if (!authUser) return;
    if (authUser.role !== "super_admin" && authUser.role !== "admin" && authUser.username !== "admin" && authUser.username !== "superadmin") return;
    loadResetRequests();
    const t = setInterval(loadResetRequests, 15000);
    return () => clearInterval(t);
  }, [authUser]);

  // Interval for queue auto-run
  useEffect(() => {
    let interval: any = null;
    if (autoRunActive) {
      interval = setInterval(async () => {
        try {
          const res = await fetch("/api/queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "process_next" }),
          });
          const data = await res.json();
          if (data.success && data.result) {
            const r = data.result;
            const timestamp = new Date().toLocaleTimeString();
            if (r.success) {
              addAutoLog(`[${timestamp}] Successfully sent email via ${r.gmailUsedEmail}`);
            } else {
              if (r.error && r.error.includes("No pending emails")) {
                addAutoLog(`[${timestamp}] Queue empty. Waiting for pending emails...`);
                setAutoRunActive(false);
              } else {
                addAutoLog(`[${timestamp}] Error: ${r.error || "Unknown transmission error"}`);
              }
            }
            // Refresh stats list
            loadDashboardData();
          }
        } catch (err) {
          console.error(err);
        }
      }, 3500); // Process next item every 3.5 seconds
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRunActive]);

  const addAutoLog = (text: string) => {
    setAutoRunLogs((prev) => [text, ...prev.slice(0, 30)]);
  };

  // Process a single queue item manually
  const handleProcessSingle = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process_next" }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.result?.success) {
          showSuccess(`Sent successfully via ${data.result.gmailUsedEmail}!`);
        } else {
          showError(data.result?.error || "Queue processor checked: No pending item or error occurred");
        }
        loadDashboardData();
      } else {
        showError(data.error);
      }
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleManualAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploadingAttachment(true);
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data.success) {
        showSuccess("Attachment uploaded successfully.");
      } else {
        showError(data.error || "Attachment upload failed.");
      }
    } catch (err: any) {
      showError(err.message);
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleSendManualEmail = async () => {
    await handleManualSend();
  };

  // Process batch
  const handleProcessBatch = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process_batch" }),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess(data.summary || "Batch processed successfully!");
        loadDashboardData();
      } else {
        showError(data.error);
      }
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Reset queue status
  const handleResetQueue = async () => {
    if (!confirm("Are you sure you want to reset all queue items back to 'pending' for simulation?")) return;
    try {
      setLoading(true);
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_all" }),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess(data.message);
        loadDashboardData();
      }
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Clear queue completely
  const handleClearQueue = async () => {
    if (!confirm("This will delete all items in the queue. Continue?")) return;
    try {
      setLoading(true);
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_all" }),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess(data.message);
        loadDashboardData();
      }
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Import from CSV sheet
  const handleImportSheet = async () => {
    try {
      setLoading(true);
      setErrorMsg("");
      setSuccessMsg("");

      // Simple CSV parser
      const lines = spreadsheetText.trim().split("\n");
      if (lines.length < 2) {
        showError("Invalid spreadsheet format. Need a header row and at least one data row.");
        return;
      }

      const headers = lines[0].split(",").map(h => h.trim());
      const items = [];

      for (let i = 1; i < lines.length; i++) {
        const currentLine = lines[i].split(",").map(val => val.trim());
        if (currentLine.length < headers.length) continue;

        const obj: any = {};
        headers.forEach((header, index) => {
          // Map headers correctly
          if (header === "Reference No") obj.referenceNo = currentLine[index];
          else if (header === "Serial No") obj.serialNo = currentLine[index];
          else if (header === "Mark Name") obj.markName = currentLine[index];
          else if (header === "Filing Date") obj.filingDate = currentLine[index];
          else if (header === "Email") obj.email = currentLine[index];
          else if (header === "CC") obj.cc = currentLine[index];
          else if (header === "BCC") obj.bcc = currentLine[index];
          else if (header === "Subject") obj.subject = currentLine[index];
          else if (header === "Template") obj.templateId = currentLine[index];
          else if (header === "Attachment") obj.attachment = currentLine[index];
        });
        items.push(obj);
      }

      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import",
          items: items,
          campaignId: importCampaignId
        }),
      });

      const data = await res.json();
      if (data.success) {
        showSuccess(
          data.message ||
            `Successfully imported ${data.count} items${data.templateId ? ` (template #${data.templateId})` : ""} into the queue!`
        );
        setSpreadsheetText("");
        loadDashboardData();
        setActiveTab("dashboard");
      } else {
        showError(data.error);
      }
    } catch (err: any) {
      showError(err.message || "Failed to parse and import sheet records.");
    } finally {
      setLoading(false);
    }
  };

  // Gmail account operations
  const handleSaveGmail = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      const isEdit = !!gmailForm.id;
      const url = "/api/gmail";
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gmailForm),
      });

      const data = await res.json();
      if (data.success) {
        showSuccess(`Account ${isEdit ? "updated" : "saved"} successfully!`);
        setGmailForm({
          id: "",
          email: "",
senderName: "uspto.gov examination",
          replyToEmail: "",
          provider: "gmail",
          appPassword: "",
          smtpHost: "smtp.gmail.com",
          smtpPort: 465,
          secure: true,
          priority: 1,
          dailyLimit: 500,
          minuteLimit: 50,
          status: "enabled",
        });
        setEditingGmail(null);
        loadDashboardData();
      } else {
        showError(data.error);
      }
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

const handleVerifySMTP = async () => {
  try {
    setLoading(true);

    const res = await fetch("/api/gmail/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider: gmailForm.provider,
        email: gmailForm.email,
        password: gmailForm.appPassword,
        smtpHost: gmailForm.smtpHost,
        smtpPort: Number(gmailForm.smtpPort),
        secure: gmailForm.secure,
      }),
    });

    const data = await res.json();

    if (data.success) {
      showSuccess(data.message);
    } else {
      showError(data.error);
    }
  } catch (err: any) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
};


const [manualSending, setManualSending] = useState(false);


  // Replace {{variable}} placeholders in template text
  const applyVariables = (content: string, vars: Record<string, string>) => {
    if (!content) return "";
    let out = content;
    Object.entries(vars).forEach(([key, val]) => {
      const re = new RegExp(`\\{\\{${key}\\}\\}`, "gi");
      out = out.replace(re, val || "");
    });
    // also support common aliases
    out = out.replace(/\{\{reference_no\}\}/gi, vars.reference_no || "");
    out = out.replace(/\{\{serial_no\}\}/gi, vars.serial_no || "");
    out = out.replace(/\{\{mark_name\}\}/gi, vars.mark_name || "");
    out = out.replace(/\{\{filing_date\}\}/gi, vars.filing_date || "");
    out = out.replace(/\{\{email\}\}/gi, vars.email || vars.email || "");
    out = out.replace(/\{\{today\}\}/gi, vars.today || new Date().toISOString().slice(0, 10));
    return out;
  };

  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) return;
    const tpl = templates.find((t: any) => String(t.id) === String(templateId));
    if (!tpl) return;

    const vars = {
      ...composeVariables,
      email: composeVariables.email || manualEmailForm.to || "",
      today: composeVariables.today || new Date().toISOString().slice(0, 10),
    };

    const subject = applyVariables(tpl.subject || "", vars);
    const html = applyVariables(tpl.bodyHtml || tpl.body_html || "", vars);

    setManualEmailForm((prev) => ({
      ...prev,
      subject,
      html,
    }));
  };

  // Re-apply variables when user changes variable fields (keeps selected template body refreshed)
  const handleVariableChange = (key: string, value: string) => {
    const nextVars = { ...composeVariables, [key]: value };
    setComposeVariables(nextVars);

    // if "email" variable changed, also sync To field optionally
    if (key === "email" && value) {
      setManualEmailForm((prev) => ({ ...prev, to: prev.to || value }));
    }

    if (selectedTemplateId) {
      const tpl = templates.find((t: any) => String(t.id) === String(selectedTemplateId));
      if (tpl) {
        const vars = {
          ...nextVars,
          email: nextVars.email || manualEmailForm.to || "",
          today: nextVars.today || new Date().toISOString().slice(0, 10),
        };
        setManualEmailForm((prev) => ({
          ...prev,
          subject: applyVariables(tpl.subject || "", vars),
          html: applyVariables(tpl.bodyHtml || tpl.body_html || "", vars),
        }));
      }
    }
  };


  const handleManualSend = async () => {
  if (!manualEmailForm.to || !manualEmailForm.subject || !manualEmailForm.html) {
    showError("To, Subject and Message are required");
    return;
  }

  // Operator daily limit check (client-side hint)
  const st = authUser?.stats;
  if (st && st.sentToday >= st.dailyLimit) {
    showError(`Daily limit reached (${st.sentToday}/${st.dailyLimit}). Contact admin.`);
    return;
  }

  try {
    setManualSending(true);
    setErrorMsg("");
    setSuccessMsg("");

    // Always send as HTML (rich text / source mode both produce HTML)
    const finalHtml = manualEmailForm.html || "";

    const res = await fetch("/api/manual-send", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...Object.fromEntries(Object.entries(authHeaders()).filter(([k]) => k !== "Content-Type")) },
      body: JSON.stringify({
        ...manualEmailForm,
        html: finalHtml,
        sentByUserId: authUser?.id,
      }),
    });
     

    const data = await res.json();

    if (data.success) {
      // Record agent progress / limit
      try {
        const rec = await fetch("/api/auth", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ action: "record_send", userId: authUser?.id }),
        });
        const recData = await rec.json();
        if (recData.success && recData.stats && authUser) {
          setAuthUser({ ...authUser, stats: recData.stats });
        } else if (rec.status === 429) {
          showError(recData.error || "Daily limit reached");
        }
      } catch {}
      showSuccess(`Email sent via ${data.usedAccount}`);
      // Save suggestions; keep fromName, fromEmail, replyTo, subject, html, smtpAccountId
      try {
        const raw = localStorage.getItem("compose_suggestions_v1");
        const prev = raw ? JSON.parse(raw) : { fromName: [], fromEmail: [], replyTo: [], subject: [] };
        const push = (key: string, val: string) => {
          if (!val?.trim()) return;
          const arr: string[] = prev[key] || [];
          prev[key] = [val.trim(), ...arr.filter((x: string) => x !== val.trim())].slice(0, 12);
        };
        push("fromName", manualEmailForm.fromName);
        push("fromEmail", manualEmailForm.fromEmail);
        push("replyTo", manualEmailForm.replyTo);
        push("subject", manualEmailForm.subject);
        localStorage.setItem("compose_suggestions_v1", JSON.stringify(prev));
        setComposeSuggestions(prev);
      } catch {}
      setManualEmailForm((prev) => ({
        ...prev,
        to: "",
        cc: "",
        bcc: "",
      }));
    } else {
      showError(data.error || "Failed to send");
    }
  } catch (err: any) {
    showError(err.message || "Network error");
  } finally {
    setManualSending(false);
  }
};

const handleTestGmailConnection = async (id: number) => {
  try {
    setLoading(true);

    const res = await fetch("/api/gmail/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id }),
    });

    const data = await res.json();

    if (data.success) {
      showSuccess(data.message || "SMTP connection successful.");
      loadDashboardData();
    } else {
      showError(data.error || "SMTP connection failed.");
    }
  } catch (err: any) {
    showError(err.message || "Unable to test SMTP connection.");
  } finally {
    setLoading(false);
  }
};

  const handleDeleteGmail = async (id: number) => {
    if (!confirm("Are you sure you want to remove this SMTP/Gmail account?")) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/gmail?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        showSuccess("Account removed successfully.");
        loadDashboardData();
      } else {
        showError(data.error);
      }
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

const handlePreviewManualEmail = () => {
  setPreviewOpen(true);
};

  // Template actions
  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      const isEdit = !!templateForm.id;
      const url = "/api/template";
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: authHeaders(),
        body: JSON.stringify(templateForm),
      });

      const data = await res.json();
      if (data.success) {
        showSuccess(`Template ${isEdit ? "updated" : "saved"} successfully!`);
        setTemplateForm({
          id: "",
          name: "",
          subject: "",
          bodyHtml: "",
          bodyText: "",
          attachmentsJson: "[]",
        });
        setEditingTemplate(null);
        loadTemplatesAndCampaigns();
        loadDashboardData();
      } else {
        showError(data.error);
      }
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTemplate = async (id: number) => {
    if (!confirm("Are you sure you want to delete this template?")) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/template?id=${id}`, { method: "DELETE", headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        showSuccess("Template deleted.");
        loadTemplatesAndCampaigns();
        loadDashboardData();
      } else {
        showError(data.error);
      }
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Campaign create
  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      const res = await fetch("/api/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campaignForm),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess("Campaign created successfully!");
        setCampaignForm({ name: "", templateId: "", status: "running" });
        loadTemplatesAndCampaigns();
        loadDashboardData();
      } else {
        showError(data.error);
      }
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleCampaignStatus = async (id: number, currentStatus: string) => {
    const nextStatus = currentStatus === "running" ? "paused" : "running";
    try {
      const res = await fetch("/api/campaign", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: nextStatus }),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess(`Campaign status set to ${nextStatus}.`);
        loadTemplatesAndCampaigns();
      }
    } catch (err: any) {
      showError(err.message);
    }
  };


  const authHeaders = (): HeadersInit => {
    const h: HeadersInit = { "Content-Type": "application/json" };
    const token =
      authToken ||
      (typeof window !== "undefined" ? localStorage.getItem("ea_token") || "" : "");
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  };

  const can = (perm: string) => {
    if (!authUser) return false;
    if (authUser.role === "super_admin") return true;
    const perms = authUser.permissions || [];
    if (perms.length) return perms.includes(perm);
    if (authUser.role === "admin") {
      // Admin: all modules, can add SMTP & users, cannot delete SMTP
      const adminDefault = [
        "compose", "dashboard", "sheets", "gmail", "templates", "campaigns",
        "admin_panel", "smtp_add", "manage_users",
      ];
      return adminDefault.includes(perm);
    }
    return perm === "compose" || perm === "templates";
  };

  const PERM_LABELS: Record<string, string> = {
    compose: "Compose Email",
    dashboard: "Live Queue & Run Panel",
    sheets: "Google Sheets Simulator",
    gmail: "Gmail & SMTP Tab",
    templates: "HTML Templates Studio",
    campaigns: "Outreach Campaigns",
    admin_panel: "Admin Panel",
    smtp_view: "View SMTP List",
    smtp_add: "Add SMTP Accounts",
    smtp_delete: "Delete SMTP Accounts",
    manage_users: "Manage Users / Agents",
  };

  const ALL_PERM_KEYS = Object.keys(PERM_LABELS);

  const isSuperAdmin = () =>
    !!authUser &&
    (authUser.role === "super_admin" ||
      authUser.username === "admin" ||
      authUser.username === "superadmin");

  const roleLabel = (role?: string) => {
    const r = (role || "").toLowerCase();
    if (r === "super_admin") return "Super Admin";
    if (r === "admin") return "Admin";
    return "Operator";
  };

  const checkAuth = async () => {
    try {
      const saved =
        typeof window !== "undefined" ? localStorage.getItem("ea_token") : null;
      const token = saved || authToken;
      if (!token) {
        setAuthUser(null);
        setAuthChecked(true);
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch("/api/auth?action=me", {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (res.ok && data?.success && data.user) {
        setAuthToken(token);
        setAuthUser(data.user);
      } else {
        // Old in-memory tokens / invalid → force re-login
        if (typeof window !== "undefined") localStorage.removeItem("ea_token");
        setAuthToken("");
        setAuthUser(null);
      }
    } catch {
      // Network / abort → show login, don't stay on spinner
      if (typeof window !== "undefined") localStorage.removeItem("ea_token");
      setAuthToken("");
      setAuthUser(null);
    } finally {
      setAuthChecked(true);
    }
  };

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    try {
      setLoginLoading(true);
      setErrorMsg("");
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "login",
          username: loginForm.username,
          password: loginForm.password,
          panel: loginPanel,
        }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem("ea_token", data.token);
        setAuthToken(data.token);
        setAuthUser(data.user);
        setLoginForm({ username: "", password: "" });
        showSuccess(`Welcome, ${data.user.username} (${data.user.role === "super_admin" ? "Super Admin" : data.user.role === "admin" ? "Admin" : "Operator"})`);
        if (data.user.role === "operator") {
          setActiveTab("compose");
        }
        loadDashboardData();
        loadTemplatesAndCampaigns();
      } else {
        showError(data.error || "Login failed");
      }
    } catch (err: any) {
      showError(err.message || "Login error");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "logout" }),
      });
    } catch {}
    localStorage.removeItem("ea_token");
    setAuthToken("");
    setAuthUser(null);
    setActiveTab("compose");
  };

  const loadAdminUsers = async () => {
    try {
      const res = await fetch("/api/auth?action=list_users", { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setAdminUsers(data.list || []);
        if (data.totals) setAgentTotals(data.totals);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadResetRequests = async () => {
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "list_reset_requests" }),
      });
      const data = await res.json();
      if (data.success) setResetRequests(data.list || []);
    } catch (e) {
      console.error(e);
    }
  };

  const loadSmtpAssignments = async () => {
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "get_smtp_assignments" }),
      });
      const data = await res.json();
      if (data.success) setSmtpAssignments(data.map || {});
    } catch (e) {
      console.error(e);
    }
  };

  const handleResolveReset = async (req: any, newPassword?: string) => {
    try {
      setLoading(true);
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          action: "resolve_reset",
          requestId: req.id,
          userId: req.userId,
          newPassword: newPassword || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess("Request resolved");
        loadResetRequests();
      } else showError(data.error || "Failed");
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleSmtpUserAssign = async (accountId: number, userId: number) => {
    const key = String(accountId);
    const cur = new Set(smtpAssignments[key] || []);
    if (cur.has(userId)) cur.delete(userId);
    else cur.add(userId);
    const next = { ...smtpAssignments, [key]: Array.from(cur) };
    setSmtpAssignments(next);
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "set_smtp_assignments", map: next }),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdatePermissions = async () => {
    if (!editingPermsUser) return;
    try {
      setLoading(true);
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          action: "update_permissions",
          userId: editingPermsUser.id,
          permissions: editingPermsUser.permissions || [],
          dailyLimit: editingPermsUser.dailyLimit,
          role: editingPermsUser.role,
          username: editingPermsUser.username,
          newPassword: editingPermsUser.newPassword || "",
        }),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess("User updated (username / password / permissions)");
        setEditingPermsUser(null);
        loadAdminUsers();
      } else {
        showError(data.error || "Update failed");
      }
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleNewUserPerm = (key: string) => {
    setNewUserForm((prev) => {
      const set = new Set(prev.permissions || []);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return { ...prev, permissions: Array.from(set) };
    });
  };

  const toggleEditPerm = (key: string) => {
    setEditingPermsUser((prev: any) => {
      if (!prev) return prev;
      const set = new Set(prev.permissions || []);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return { ...prev, permissions: Array.from(set) };
    });
  };


  const handleCreateUser = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (!newUserForm.username?.trim() || !newUserForm.password) {
      showError("Username and password required");
      return;
    }
    try {
      setLoading(true);
      setErrorMsg("");
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          action: "create_user",
          username: newUserForm.username.trim(),
          password: newUserForm.password,
          role: newUserForm.role || "operator",
          dailyLimit: newUserForm.dailyLimit || 100,
          permissions: newUserForm.permissions || ["compose"],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        showSuccess(`User "${newUserForm.username}" created (${data.role || newUserForm.role})`);
        setNewUserForm({
          username: "",
          password: "",
          role: "operator",
          dailyLimit: 100,
          permissions: ["compose"],
        });
        await loadAdminUsers();
      } else {
        showError(data.error || `Failed to create user (${res.status})`);
      }
    } catch (err: any) {
      showError(err.message || "Network error creating user");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (id: number) => {
    if (!confirm("Delete this user?")) return;
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "delete_user", id }),
      });
      const data = await res.json();
      if (data.success) {
        showSuccess("User deleted");
        loadAdminUsers();
      } else {
        showError(data.error || "Delete failed");
      }
    } catch (err: any) {
      showError(err.message);
    }
  };

  const handleChangePassword = async (e?: React.FormEvent) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      showError("Both password fields required");
      return;
    }
    try {
      setLoading(true);
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "change_password", ...passwordForm }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        showSuccess("Password updated");
        setPasswordForm({ currentPassword: "", newPassword: "" });
      } else {
        showError(data.error || "Password change failed");
      }
    } catch (err: any) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };


  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setErrorMsg("");
    setTimeout(() => setSuccessMsg(""), 6000);
  };

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setSuccessMsg("");
    setTimeout(() => setErrorMsg(""), 6000);
  };

const handleAttachmentUpload = async (
  e: React.ChangeEvent<HTMLInputElement>
) => {
  const file = e.target.files?.[0];

  if (!file) return;

  try {
    setUploadingAttachment(true);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (!data.success) {
      showError(data.error);
      return;
    }

    const existing = JSON.parse(templateForm.attachmentsJson || "[]");

    existing.push({
      filename: data.filename,
      originalName: data.originalName,
      path: data.path,
    });

    setTemplateForm({
      ...templateForm,
      attachmentsJson: JSON.stringify(existing),
    });

    showSuccess("Attachment uploaded successfully.");
  } catch (err: any) {
    showError(err.message);
  } finally {
    setUploadingAttachment(false);
  }
};

  // Loading auth
  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-300">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm">Checking session...</p>
        </div>
      </div>
    );
  }


  // Login screen — separate Admin/Super Admin vs Operator panels
  if (!authUser) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-950 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          <div className="text-center mb-6">
            <div className="inline-flex p-3 bg-blue-600 rounded-xl text-white mb-4">
              <Mail className="h-8 w-8" />
            </div>
            <h1 className="text-2xl font-bold text-white">Email Automation</h1>
            <p className="text-sm text-slate-400 mt-1">Dashboard V1 — Secure Access</p>
          </div>

          {/* Panel switcher */}
          <div className="flex rounded-xl bg-slate-900 border border-slate-800 p-1 mb-6">
            <button
              type="button"
              onClick={() => {
                setLoginPanel("admin");
                setShowForgot(false);
                setErrorMsg("");
                setForgotInfo("");
              }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition ${
                loginPanel === "admin"
                  ? "bg-blue-600 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Admin / Super Admin
            </button>
            <button
              type="button"
              onClick={() => {
                setLoginPanel("operator");
                setShowForgot(false);
                setErrorMsg("");
                setForgotInfo("");
              }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition ${
                loginPanel === "operator"
                  ? "bg-emerald-600 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Operator
            </button>
          </div>

          {errorMsg && (
            <div className="mb-4 p-3 bg-rose-950 border border-rose-800 text-rose-200 rounded-lg text-sm">
              {errorMsg}
            </div>
          )}
          {forgotInfo && (
            <div className="mb-4 p-3 bg-emerald-950 border border-emerald-800 text-emerald-200 rounded-lg text-sm">
              {forgotInfo}
            </div>
          )}

          {!showForgot ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 font-medium">Username</label>
                <input
                  type="text"
                  autoComplete="username"
                  className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={loginForm.username}
                  onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                  placeholder={loginPanel === "operator" ? "operator" : "admin / superadmin"}
                  required
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 font-medium">Password</label>
                <div className="relative mt-1">
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 pr-16 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white px-2"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loginLoading}
                className={`w-full text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-50 ${
                  loginPanel === "admin"
                    ? "bg-blue-600 hover:bg-blue-500"
                    : "bg-emerald-600 hover:bg-emerald-500"
                }`}
              >
                {loginLoading ? "Signing in..." : "Sign In"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForgot(true);
                  setForgotUsername(loginForm.username);
                  setErrorMsg("");
                  setForgotInfo("");
                }}
                className="w-full text-xs text-slate-500 hover:text-amber-400 underline underline-offset-2"
              >
                Forgot password?
              </button>
            </form>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setForgotLoading(true);
                setErrorMsg("");
                setForgotInfo("");
                try {
                  const res = await fetch("/api/auth", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "forgot_password",
                      username: forgotUsername.trim(),
                      panel: loginPanel,
                    }),
                  });
                  const data = await res.json();
                  if (data.success) {
                    setForgotInfo(data.message);
                    setShowForgot(false);
                  } else {
                    setErrorMsg(data.error || "Request failed");
                  }
                } catch (err: any) {
                  setErrorMsg(err.message || "Network error");
                } finally {
                  setForgotLoading(false);
                }
              }}
              className="space-y-4"
            >
              <div>
                <h3 className="text-white font-semibold text-sm mb-1">Forgot Password</h3>
                <p className="text-xs text-slate-400 mb-3">
                  {loginPanel === "operator"
                    ? "Operator: Super Admin ko notification jayegi — automatic reset nahi hoga."
                    : "Admin: Super Admin ko notification. Super Admin: current password jamesrock78691@gmail.com par email hogi."}
                </p>
                <label className="text-xs text-slate-400 font-medium">Your username</label>
                <input
                  type="text"
                  className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={forgotUsername}
                  onChange={(e) => setForgotUsername(e.target.value)}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={forgotLoading}
                className="w-full bg-amber-600 hover:bg-amber-500 text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-50"
              >
                {forgotLoading ? "Submitting..." : "Submit Recovery Request"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForgot(false);
                  setErrorMsg("");
                  setForgotInfo("");
                }}
                className="w-full text-xs text-slate-500 hover:text-white"
              >
                ← Back to login
              </button>
            </form>
          )}

          <p className="text-[11px] text-slate-600 text-center mt-6">
            No direct reset to admin123. Recovery goes through Super Admin.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-600 rounded-lg text-white shadow-lg shadow-blue-500/20">
            <Mail className="h-6 w-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              EMAIL AUTOMATION DASHBOARD <span className="text-xs bg-blue-500/10 text-blue-400 font-semibold px-2.5 py-0.5 rounded border border-blue-500/20">V1 Hum Production</span>
            </h1>
            <p className="text-xs text-slate-400">Node.js • Express • PostgreSQL • Google Sheets API • Nodemailer • Gmail Rotation • Open Tracking</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadDashboardData}
            disabled={loading}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-650 transition text-slate-200 px-3.5 py-2 rounded-lg text-sm font-medium border border-slate-700"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Sync Dashboard
          </button>
          
          <div className="h-6 w-px bg-slate-800"></div>

          <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1.5 rounded-lg text-xs font-semibold">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping"></span>
            SMTP Engine Active
          </div>

          <div className="h-6 w-px bg-slate-800"></div>

          <div className="flex items-center gap-3">
            {authUser?.stats && (
              <div className="hidden md:flex items-center gap-3 text-[11px] bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-1.5">
                <span className="text-slate-400">Limit <strong className="text-white">{authUser.stats.dailyLimit || 0}</strong></span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">Sent <strong className="text-emerald-400">{authUser.stats.sentToday || 0}</strong></span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">Left <strong className="text-amber-400">{Math.max(0, (authUser.stats.dailyLimit || 0) - (authUser.stats.sentToday || 0))}</strong></span>
              </div>
            )}
            <div className="text-right hidden sm:block">
              <p className="text-xs font-semibold text-white">{authUser?.username}</p>
              <p className="text-[10px] text-slate-400 uppercase">{roleLabel(authUser?.role)}</p>
            </div>
            <button
              onClick={handleLogout}
              className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-rose-600/80 border border-slate-700 text-slate-200 transition"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto p-6 space-y-6">
        
        {/* Alerts Center */}
        {successMsg && (
          <div className="p-4 bg-emerald-950 border border-emerald-800 text-emerald-200 rounded-xl flex items-start gap-3 shadow-md animate-in fade-in slide-in-from-top-4 duration-300">
            <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm">Operation Successful</p>
              <p className="text-xs opacity-90">{successMsg}</p>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="p-4 bg-rose-950 border border-rose-800 text-rose-200 rounded-xl flex items-start gap-3 shadow-md animate-in fade-in slide-in-from-top-4 duration-300">
            <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm">System Notice / Error</p>
              <p className="text-xs opacity-90">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Global Stats Grid — Super Admin / Admin only */}
        {authUser?.role !== "operator" && (
        <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl flex flex-col justify-between hover:border-slate-700 transition">
            <span className="text-xs text-slate-400 font-medium">Total Ingested Queue</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl font-bold text-white">{stats.totalEmails}</span>
              <span className="text-xs text-slate-500">emails</span>
            </div>
          </div>
          <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl flex flex-col justify-between hover:border-slate-700 transition">
            <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
              <CheckCircle className="h-3 w-3" /> Sent Success
            </span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl font-bold text-emerald-400">{stats.sent}</span>
              <span className="text-xs text-slate-500">delivered</span>
            </div>
          </div>
          <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl flex flex-col justify-between hover:border-slate-700 transition">
            <span className="text-xs text-yellow-400 font-medium flex items-center gap-1">
              <Sliders className="h-3 w-3 animate-spin" /> Pending In Queue
            </span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl font-bold text-yellow-400">{stats.pending}</span>
              <span className="text-xs text-slate-500">waiting</span>
            </div>
          </div>
          <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl flex flex-col justify-between hover:border-slate-700 transition">
            <span className="text-xs text-blue-400 font-medium flex items-center gap-1">
              <Eye className="h-3 w-3" /> Unique Opens
            </span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl font-bold text-blue-400">{stats.opened}</span>
              <span className="text-xs text-blue-500 font-semibold bg-blue-500/10 px-1.5 py-0.5 rounded ml-1">
                {stats.openRate} Rate
              </span>
            </div>
          </div>
          <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl flex flex-col justify-between hover:border-slate-700 transition">
            <span className="text-xs text-rose-400 font-medium flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Transmit Failed
            </span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl font-bold text-rose-400">{stats.failed}</span>
              <span className="text-xs text-slate-500">unsuccessful</span>
            </div>
          </div>
        </section>
        )}

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-px">
          {can("compose") && (
            <button
              onClick={() => setActiveTab("compose")}
              className={`px-4 py-2 rounded-lg font-medium ${
                activeTab === "compose"
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              Compose Email
            </button>
          )}

          {can("dashboard") && (
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition ${
                activeTab === "dashboard"
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-slate-400 hover:text-white"
              }`}
            >
              <Cpu className="h-4 w-4" />
              Live Queue & Run Panel
            </button>
          )}

          {can("sheets") && (
            <button
              onClick={() => setActiveTab("sheets_importer")}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition ${
                activeTab === "sheets_importer"
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-slate-400 hover:text-white"
              }`}
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
              Google Sheets Simulator
            </button>
          )}

          {(isSuperAdmin() || can("smtp_add")) && (
            <button
              onClick={() => setActiveTab("gmail_accounts")}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition ${
                activeTab === "gmail_accounts"
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-slate-400 hover:text-white"
              }`}
            >
              <RotateCw className="h-4 w-4 text-blue-400" />
              {isSuperAdmin() ? `Gmail & SMTP Rotators (${stats.totalGmailCount})` : "Add SMTP Account"}
            </button>
          )}

          {can("templates") && (
            <button
              onClick={() => setActiveTab("templates")}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition ${
                activeTab === "templates"
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-slate-400 hover:text-white"
              }`}
            >
              <FileCode className="h-4 w-4 text-indigo-400" />
              HTML Templates Studio ({stats.templatesCount})
            </button>
          )}

          {can("campaigns") && (
            <button
              onClick={() => setActiveTab("campaigns_tab")}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition ${
                activeTab === "campaigns_tab"
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-slate-400 hover:text-white"
              }`}
            >
              <Layers className="h-4 w-4 text-pink-400" />
              Active Outreach Campaigns ({stats.campaignsCount})
            </button>
          )}

          {can("admin_panel") && (
            <button
              onClick={() => setActiveTab("admin")}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition relative ${
                activeTab === "admin"
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-slate-400 hover:text-white"
              }`}
            >
              <Settings className="h-4 w-4 text-amber-400" />
              Admin Panel
              {resetRequests.length > 0 && (
                <span className="ml-1 inline-flex items-center gap-1">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                  </span>
                  <span className="text-[10px] font-bold text-red-400 bg-red-500/15 border border-red-500/30 px-1.5 py-0.5 rounded-full">
                    {resetRequests.length}
                  </span>
                </span>
              )}
            </button>
          )}
        </div>


        {/* Tab 1: Dashboard Panel */}
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            
            {/* Quick Engine Simulator Trigger Card */}
            <div className="bg-gradient-to-r from-slate-900 to-blue-950/60 border border-blue-900/60 p-6 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-xl">
              <div className="space-y-2">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-400 bg-blue-400/10 px-2.5 py-1 rounded border border-blue-500/20">
                  GMAIL ROTATION & SENDER ENGINE CONTROL
                </span>
                <h3 className="text-xl font-bold text-white">Manual Or Automatic Queue Trigger</h3>
                <p className="text-sm text-slate-300 max-w-2xl">
                  Simulate Gmail Server-Rotation in real-time. The sender engine picks the highest priority available, health-checked account, checks limits, compiles templates, appends PDF attachments, injects trackers, and sends!
                </p>
              </div>
              <div className="flex flex-wrap gap-3 shrink-0">
                <button
                  onClick={handleProcessSingle}
                  disabled={loading}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-sm px-5 py-3 rounded-xl transition shadow-lg shadow-blue-600/20 disabled:opacity-50"
                >
                  <Play className="h-4 w-4 fill-white" />
                  Process Next Email
                </button>
                <button
                  onClick={handleProcessBatch}
                  disabled={loading}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-semibold text-sm px-5 py-3 rounded-xl transition shadow-lg"
                >
                  <RefreshCw className="h-4 w-4" />
                  Batch Process (10x)
                </button>
                <button
                  onClick={() => setAutoRunActive(!autoRunActive)}
                  className={`flex items-center gap-2 font-bold text-sm px-5 py-3 rounded-xl transition ${
                    autoRunActive
                      ? "bg-amber-500 hover:bg-amber-600 text-slate-950 animate-pulse"
                      : "bg-emerald-600 hover:bg-emerald-500 text-white"
                  }`}
                >
                  {autoRunActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {autoRunActive ? "Pause Auto-Send" : "Auto-Run Daemon (3s)"}
                </button>
              </div>
            </div>

            {/* Auto-runner Realtime Console Logs */}
            {autoRunLogs.length > 0 && (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping"></span>
                    SMTP Rotation Daemon Terminal Output
                  </span>
                  <button onClick={() => setAutoRunLogs([])} className="text-[10px] text-slate-500 hover:text-white underline">
                    Clear Terminal
                  </button>
                </div>
                <div className="font-mono text-xs text-emerald-400 bg-slate-950/80 p-2 rounded max-h-36 overflow-y-auto space-y-1 scrollbar-thin">
                  {autoRunLogs.map((log, index) => (
                    <div key={index}>{log}</div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left 2 Columns: Email Queue Table */}
              <div className="lg:col-span-2 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-md font-bold text-white flex items-center gap-2">
                    <Database className="h-4 w-4 text-blue-400" />
                    Ingested Queue Logs (Google Sheets Status Mirror)
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleResetQueue}
                      className="text-xs bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 px-3 py-1.5 rounded border border-slate-700"
                    >
                      Reset Queue to Pending
                    </button>
                    <button
                      onClick={handleClearQueue}
                      className="text-xs bg-rose-950/30 text-rose-300 hover:text-white hover:bg-rose-900/50 px-3 py-1.5 rounded border border-rose-900/50"
                    >
                      Purge Queue Table
                    </button>
                  </div>
                </div>

                <div className="bg-slate-950/60 border border-slate-800 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-bold">
                          <th className="p-3">Reference No</th>
                          <th className="p-3">Serial No / Mark</th>
                          <th className="p-3">Filing Date</th>
                          <th className="p-3">Recipient Email</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Rotated Gmail Used</th>
                          <th className="p-3">Opens</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {queueItems.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-8 text-center text-slate-500">
                              Queue is currently empty. Use the <strong>Google Sheets Simulator</strong> tab to paste & import row data instantly!
                            </td>
                          </tr>
                        ) : (
                          queueItems.map((item) => (
                            <tr key={item.id} className="hover:bg-slate-900/50">
                              <td className="p-3 font-mono font-semibold text-blue-300">{item.referenceNo}</td>
                              <td className="p-3">
                                <div className="font-semibold text-white">{item.markName}</div>
                                <div className="text-[10px] text-slate-400 font-mono">Serial: #{item.serialNo}</div>
                              </td>
                              <td className="p-3 text-slate-400">{item.filingDate}</td>
                              <td className="p-3 font-mono text-slate-300">
                                {item.email}
                                {item.cc && <div className="text-[10px] text-slate-500 font-sans">CC: {item.cc}</div>}
                              </td>
                              <td className="p-3">
                                {item.status === "sent" && (
                                  <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-semibold text-[10px]">
                                    DELIVERED
                                  </span>
                                )}
                                {item.status === "pending" && (
                                  <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded font-semibold text-[10px]">
                                    PENDING
                                  </span>
                                )}
                                {item.status === "sending" && (
                                  <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded font-semibold text-[10px] animate-pulse">
                                    SENDING...
                                  </span>
                                )}
                                {item.status === "failed" && (
                                  <div className="space-y-1">
                                    <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded font-semibold text-[10px]">
                                      FAILED
                                    </span>
                                    {item.errorMessage && (
                                      <p className="text-[10px] text-rose-300 max-w-xs truncate" title={item.errorMessage}>
                                        {item.errorMessage}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="p-3 font-mono text-slate-400">
                                {item.gmailUsedEmail ? (
                                  <div className="flex items-center gap-1.5 text-blue-200">
                                    <span className="h-1.5 w-1.5 bg-emerald-400 rounded-full"></span>
                                    {item.gmailUsedEmail}
                                  </div>
                                ) : (
                                  <span className="text-slate-600">—</span>
                                )}
                              </td>
                              <td className="p-3">
                                {item.openCount > 0 ? (
                                  <div className="text-center">
                                    <span className="bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded font-bold">
                                      {item.openCount}x Opened
                                    </span>
                                    {item.lastOpenedAt && (
                                      <p className="text-[10px] text-slate-500 mt-1">
                                        {new Date(item.lastOpenedAt).toLocaleTimeString()}
                                      </p>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-slate-600 text-center block">—</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Right Column: Tracking Pixel Opens Feed */}
              <div className="space-y-4">
                <h4 className="text-md font-bold text-white flex items-center gap-2">
                  <Eye className="h-4 w-4 text-emerald-400" />
                  Live Tracking Pixel Opens
                </h4>

                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-4 max-h-[500px] overflow-y-auto scrollbar-thin">
                  <p className="text-xs text-slate-400">
                    When a recipient opens an email, the embedded transparent tracking pixel notifies our server. View live metadata here:
                  </p>

                  {recentOpens.length === 0 ? (
                    <div className="text-center py-12 text-slate-500 text-xs">
                      No tracking opens recorded yet. Send a campaign and open the mail to trigger instant updates!
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {recentOpens.map((op) => (
                        <div key={op.id} className="bg-slate-900 border border-slate-800/80 p-3 rounded-lg text-xs space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-blue-400 font-mono text-[11px]">
                              {op.referenceNo}
                            </span>
                            <span className="text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                              {new Date(op.openedAt).toLocaleTimeString()}
                            </span>
                          </div>

                          <div>
                            <p className="font-semibold text-slate-200">{op.markName}</p>
                            <p className="text-slate-400 font-mono text-[10px]">{op.email}</p>
                          </div>

                          <div className="flex flex-wrap gap-2 text-[10px] text-slate-400 border-t border-slate-800 pt-2">
                            <span className="flex items-center gap-1">
                              <Smartphone className="h-3 w-3 text-slate-500" />
                              {op.device || "Desktop"}
                            </span>
                            <span className="flex items-center gap-1">
                              <Globe className="h-3 w-3 text-slate-500" />
                              {op.browser || "Chrome"}
                            </span>
                            <span className="font-mono text-[9px] text-slate-500 ml-auto">
                              IP: {op.ipAddress}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}

{activeTab === "compose" && (
  <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4 text-gray-900 relative">
    {/* Operator / agent own progress */}
    {authUser?.stats && (
      <div className="border border-indigo-200 bg-indigo-50 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-indigo-900">My Send Progress</p>
          <p className="text-xs text-indigo-700">
            Limit: <strong>{authUser.stats.dailyLimit || 100}</strong>
            &nbsp;·&nbsp; Sent today: <strong>{authUser.stats.sentToday || 0}</strong>
            &nbsp;·&nbsp; Remaining: <strong>{Math.max(0, (authUser.stats.dailyLimit || 100) - (authUser.stats.sentToday || 0))}</strong>
            &nbsp;·&nbsp; All time: <strong>{authUser.stats.totalSent || 0}</strong>
          </p>
        </div>
        <div className="w-full sm:w-48 h-2 bg-indigo-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all"
            style={{
              width: `${Math.min(100, ((authUser.stats.sentToday || 0) / (authUser.stats.dailyLimit || 100)) * 100)}%`,
            }}
          />
        </div>
        <span className="text-[10px] uppercase bg-indigo-100 text-indigo-800 px-2 py-1 rounded font-semibold">
          {roleLabel(authUser.role)}
        </span>
      </div>
    )}

    {/* Header + Buttons */}
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Compose Email</h2>
        <p className="text-sm text-gray-600">Create and send a new email</p>
      </div>

      <div className="flex items-center gap-2">
        {/* HTML Toggle: visual rich editor vs raw HTML source */}
        <button
          type="button"
          onClick={() =>
            setComposeMode(composeMode === "html" ? "source" : "html")
          }
          className={`px-3 py-2 rounded-lg text-sm font-medium border ${
            composeMode === "html"
              ? "bg-purple-600 text-white border-purple-600"
              : "bg-white text-gray-800 border-gray-300 hover:bg-gray-50"
          }`}
        >
          {composeMode === "html" ? "HTML: ON" : "HTML: OFF (Source)"}
        </button>

        {/* Preview */}
        <button
          type="button"
          onClick={() => setShowPreview(true)}
          className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 flex items-center gap-2"
        >
          Preview
        </button>

        {/* Send */}
        <button
          type="button"
          onClick={handleManualSend}
          disabled={manualSending}
          className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
        >
          {manualSending ? "Sending..." : "Send Email"}
        </button>
      </div>
    </div>

    {/* ===== Variables + Template Selector ===== */}
    <div className="border border-blue-200 bg-blue-50/60 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold text-blue-900">Template Variables</h3>
          <p className="text-xs text-blue-700/80">
            Ye values template ke {"{{reference_no}}"}, {"{{serial_no}}"}, {"{{mark_name}}"} etc. mein auto fill hongi.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setComposeVariables({
              reference_no: "",
              serial_no: "",
              mark_name: "",
              filing_date: "",
              email: "",
              today: new Date().toISOString().slice(0, 10),
            });
            setSelectedTemplateId("");
          }}
          className="text-xs px-3 py-1.5 rounded-lg border border-blue-300 text-blue-800 hover:bg-blue-100"
        >
          Clear Variables
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-700">Reference No</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900 text-sm"
            value={composeVariables.reference_no}
            onChange={(e) => handleVariableChange("reference_no", e.target.value)}
            placeholder="REF-2026-9081"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Serial No</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900 text-sm"
            value={composeVariables.serial_no}
            onChange={(e) => handleVariableChange("serial_no", e.target.value)}
            placeholder="90812354"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Mark Name</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900 text-sm"
            value={composeVariables.mark_name}
            onChange={(e) => handleVariableChange("mark_name", e.target.value)}
            placeholder="GLOW-TECH INDUSTRIES"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Filing Date</label>
          <input
            type="text"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900 text-sm"
            value={composeVariables.filing_date}
            onChange={(e) => handleVariableChange("filing_date", e.target.value)}
            placeholder="e.g. 15 Jan 2026 or 2026-01-15"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Email (variable)</label>
          <input
            type="email"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900 text-sm"
            value={composeVariables.email}
            onChange={(e) => handleVariableChange("email", e.target.value)}
            placeholder="client@example.com"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Today</label>
          <input
            type="date"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900 text-sm"
            value={composeVariables.today}
            onChange={(e) => handleVariableChange("today", e.target.value)}
          />
        </div>
      </div>

      {/* Template selector */}
      <div className="pt-2 border-t border-blue-200">
        <label className="text-xs font-medium text-gray-700">
          My Templates ({templates.length})
        </label>
        <div className="flex flex-col sm:flex-row gap-2 mt-1">
          <select
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 text-sm"
            value={selectedTemplateId}
            onChange={(e) => handleSelectTemplate(e.target.value)}
          >
            <option value="">— Choose a template to load —</option>
            {templates.map((t: any) => (
              <option key={t.id} value={String(t.id)}>
                {t.name || `Template #${t.id}`}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => selectedTemplateId && handleSelectTemplate(selectedTemplateId)}
            disabled={!selectedTemplateId}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
          >
            Apply / Refresh Template
          </button>
        </div>
        <p className="text-[11px] text-gray-500 mt-1.5">
          Template select karte hi subject + body variables ke sath fill ho jayenge. Variables change karo to auto update.
          Naye templates HTML Templates Studio se banao.
        </p>
      </div>
    </div>

    {/* Form Fields */}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="relative">
        <label className="text-sm font-medium text-gray-800">From Name *</label>
        <input
          className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900"
          value={manualEmailForm.fromName}
          onChange={(e) =>
            setManualEmailForm({ ...manualEmailForm, fromName: e.target.value })
          }
          onFocus={() => setActiveSuggestField("fromName")}
          onBlur={() => setTimeout(() => setActiveSuggestField((f) => (f === "fromName" ? null : f)), 180)}
          placeholder="USPTO"
        />
        {activeSuggestField === "fromName" && (composeSuggestions.fromName || []).length > 0 && (
          <ul className="absolute z-20 left-0 right-0 mt-1 max-h-40 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg text-sm text-gray-900">
            {(composeSuggestions.fromName || []).map((s: string) => (
              <li key={s}>
                <button type="button" className="w-full text-left px-3 py-2 hover:bg-blue-50 truncate"
                  onMouseDown={(e) => { e.preventDefault(); setManualEmailForm({ ...manualEmailForm, fromName: s }); setActiveSuggestField(null); }}>
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="relative">
        <label className="text-sm font-medium text-gray-800">From Email</label>
        <input
          className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900"
          value={manualEmailForm.fromEmail}
          onChange={(e) =>
            setManualEmailForm({ ...manualEmailForm, fromEmail: e.target.value })
          }
          onFocus={() => setActiveSuggestField("fromEmail")}
          onBlur={() => setTimeout(() => setActiveSuggestField((f) => (f === "fromEmail" ? null : f)), 180)}
          placeholder="statusalerts@usfiling.com"
        />
        {activeSuggestField === "fromEmail" && (composeSuggestions.fromEmail || []).length > 0 && (
          <ul className="absolute z-20 left-0 right-0 mt-1 max-h-40 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg text-sm text-gray-900">
            {(composeSuggestions.fromEmail || []).map((s: string) => (
              <li key={s}>
                <button type="button" className="w-full text-left px-3 py-2 hover:bg-blue-50 truncate"
                  onMouseDown={(e) => { e.preventDefault(); setManualEmailForm({ ...manualEmailForm, fromEmail: s }); setActiveSuggestField(null); }}>
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="md:col-span-2">
        <label className="text-sm font-medium text-gray-800">To Email *</label>
        <input
          className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900"
          value={manualEmailForm.to}
          onChange={(e) =>
            setManualEmailForm({ ...manualEmailForm, to: e.target.value })
          }
          placeholder="recipient@gmail.com"
        />
      </div>

      <div>
        <label className="text-sm font-medium text-gray-800">CC Email</label>
        <input
          className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900"
          value={manualEmailForm.cc}
          onChange={(e) =>
            setManualEmailForm({ ...manualEmailForm, cc: e.target.value })
          }
        />
      </div>

      <div>
        <label className="text-sm font-medium text-gray-800">BCC Email</label>
        <input
          className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900"
          value={manualEmailForm.bcc}
          onChange={(e) =>
            setManualEmailForm({ ...manualEmailForm, bcc: e.target.value })
          }
        />
      </div>

      <div className="relative">
        <label className="text-sm font-medium text-gray-800">Reply To</label>
        <input
          className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900"
          value={manualEmailForm.replyTo}
          onChange={(e) =>
            setManualEmailForm({ ...manualEmailForm, replyTo: e.target.value })
          }
          onFocus={() => setActiveSuggestField("replyTo")}
          onBlur={() => setTimeout(() => setActiveSuggestField((f) => (f === "replyTo" ? null : f)), 180)}
        />
        {activeSuggestField === "replyTo" && (composeSuggestions.replyTo || []).length > 0 && (
          <ul className="absolute z-20 left-0 right-0 mt-1 max-h-40 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg text-sm text-gray-900">
            {(composeSuggestions.replyTo || []).map((s: string) => (
              <li key={s}>
                <button type="button" className="w-full text-left px-3 py-2 hover:bg-blue-50 truncate"
                  onMouseDown={(e) => { e.preventDefault(); setManualEmailForm({ ...manualEmailForm, replyTo: s }); setActiveSuggestField(null); }}>
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label className="text-sm font-medium text-gray-800">SMTP Account</label>
        <select
          className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900"
          value={manualEmailForm.smtpAccountId}
          onChange={(e) =>
            setManualEmailForm({
              ...manualEmailForm,
              smtpAccountId: e.target.value,
            })
          }
        >
          <option value="">Auto select (assigned pool)</option>
          {gmailAccounts
            .filter((acc: any) => {
              if (isSuperAdmin()) return true;
              const assigned = smtpAssignments[String(acc.id)] || [];
              // if no assignments configured for this SMTP, only super can use; if assigned, check user
              if (assigned.length === 0) return false;
              return assigned.includes(authUser?.id);
            })
            .map((acc: any) => (
            <option key={acc.id} value={acc.id}>
              {acc.email}
            </option>
          ))}
        </select>
      </div>

      <div className="md:col-span-2 relative">
        <label className="text-sm font-medium text-gray-800">Subject *</label>
        <input
          className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 bg-white text-gray-900"
          value={manualEmailForm.subject}
          onChange={(e) =>
            setManualEmailForm({ ...manualEmailForm, subject: e.target.value })
          }
          onFocus={() => setActiveSuggestField("subject")}
          onBlur={() => setTimeout(() => setActiveSuggestField((f) => (f === "subject" ? null : f)), 180)}
        />
        {activeSuggestField === "subject" && (composeSuggestions.subject || []).length > 0 && (
          <ul className="absolute z-20 left-0 right-0 mt-1 max-h-40 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg text-sm text-gray-900">
            {(composeSuggestions.subject || []).map((s: string) => (
              <li key={s}>
                <button type="button" className="w-full text-left px-3 py-2 hover:bg-blue-50 truncate"
                  onMouseDown={(e) => { e.preventDefault(); setManualEmailForm({ ...manualEmailForm, subject: s }); setActiveSuggestField(null); }}>
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Message box - Always rich HTML (visual or source) */}
      <div className="md:col-span-2">
        <label className="text-sm font-medium text-gray-800">
          Message *{" "}
          <span className="text-gray-500 font-normal">
            ({composeMode === "html" ? "Rich Text Editor (Gmail-style)" : "Raw HTML Source"})
          </span>
        </label>

        {composeMode === "html" ? (
          <div className="mt-1">
            <RichTextComposer
              value={manualEmailForm.html}
              onChange={(val) =>
                setManualEmailForm({ ...manualEmailForm, html: val })
              }
              placeholder="Type your email message here... Use the toolbar for font, size, bold, colors, lists, etc."
            />
            <p className="text-xs text-gray-500 mt-2">
              Full Gmail-like toolbar: Font family, size, bold, italic, underline, colors, lists, alignment, link & more. HTML: OFF se raw source dekh/edit kar sakte ho.
            </p>
          </div>
        ) : (
          <>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 min-h-[260px] bg-white text-gray-900 placeholder:text-gray-400 font-mono text-sm"
              value={manualEmailForm.html}
              onChange={(e) =>
                setManualEmailForm({ ...manualEmailForm, html: e.target.value })
              }
              placeholder="<div style=&quot;font-family:Arial&quot;><p>Your HTML here...</p></div>"
            />
            <p className="text-xs text-gray-500 mt-1">
              Raw HTML source mode. HTML: ON se wapas rich editor pe jao.
            </p>
          </>
        )}
      </div>
    </div>

    {/* ===== PREVIEW MODAL (Desktop / Mobile) ===== */}
    {showPreview && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div
          className={`bg-gray-100 rounded-xl shadow-2xl max-h-[90vh] overflow-auto transition-all ${
            previewDevice === "mobile" ? "w-full max-w-[390px]" : "w-full max-w-3xl"
          }`}
        >
          {/* Modal header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-white rounded-t-xl gap-2 flex-wrap">
            <h3 className="font-semibold text-gray-900">Email Preview</h3>

            {/* Device switcher */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              <button
                type="button"
                onClick={() => setPreviewDevice("desktop")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition ${
                  previewDevice === "desktop"
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
                Desktop / Laptop
              </button>
              <button
                type="button"
                onClick={() => setPreviewDevice("mobile")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition ${
                  previewDevice === "mobile"
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><line x1="12" x2="12.01" y1="18" y2="18"/></svg>
                Mobile
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowPreview(false)}
              className="text-gray-500 hover:text-gray-800 text-xl leading-none px-2"
            >
              ×
            </button>
          </div>

          {/* Email chrome */}
          <div className={`p-4 ${previewDevice === "mobile" ? "bg-slate-800" : ""}`}>
            <div
              className={`bg-white shadow border overflow-hidden mx-auto ${
                previewDevice === "mobile"
                  ? "rounded-[1.5rem] border-4 border-slate-700 max-w-[360px]"
                  : "rounded-lg"
              }`}
            >
              {/* Fake phone notch (mobile only) */}
              {previewDevice === "mobile" && (
                <div className="bg-slate-900 h-6 flex items-center justify-center">
                  <div className="w-16 h-1.5 rounded-full bg-slate-600" />
                </div>
              )}

              <div className={`px-4 py-3 border-b text-sm text-gray-700 space-y-1 ${previewDevice === "mobile" ? "text-xs" : ""}`}>
                <p>
                  <span className="text-gray-500">From:</span>{" "}
                  <strong>{manualEmailForm.fromName || "Sender"}</strong>
                  {manualEmailForm.fromEmail
                    ? ` <${manualEmailForm.fromEmail}>`
                    : ""}
                </p>
                <p>
                  <span className="text-gray-500">To:</span>{" "}
                  {manualEmailForm.to || "—"}
                </p>
                <p>
                  <span className="text-gray-500">Subject:</span>{" "}
                  {manualEmailForm.subject || "—"}
                </p>
              </div>

              <div
                className={`text-gray-900 min-h-[200px] ${
                  previewDevice === "mobile" ? "px-3 py-4 text-sm" : "px-6 py-5"
                }`}
                dangerouslySetInnerHTML={{
                  __html:
                    manualEmailForm.html ||
                    "<p style='color:#9ca3af'>No content</p>",
                }}
              />
            </div>
          </div>

          <div className="px-4 py-3 border-t bg-white rounded-b-xl flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                setShowPreview(false);
                handleManualSend();
              }}
              disabled={manualSending}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Send Email
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
)}
        {/* Tab 2: Google Sheets Importer Simulator */}
        {activeTab === "sheets_importer" && (
          <div className="space-y-6">
            <div className="bg-slate-950/60 border border-slate-800 p-6 rounded-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
                    Google Sheets Raw Records Simulator
                  </h3>
                  <p className="text-xs text-slate-400">
                    Paste CSV records to simulate automatic synchronization of columns. The system dynamically reads and injects them into the database queue.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Associate Campaign:</span>
                  <select
                    value={importCampaignId}
                    onChange={(e) => setImportCampaignId(e.target.value)}
                    className="bg-slate-900 border border-slate-700 text-white rounded text-xs px-2.5 py-1.5 focus:outline-none"
                  >
                    {campaigns.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Table Column Reference Order Sheet */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Mandatory Frozen Sheet Columns:
                </span>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-center">
                  {[
                    "Reference No",
                    "Serial No",
                    "Mark Name",
                    "Filing Date",
                    "Email",
                    "CC / BCC"
                  ].map((col, idx) => (
                    <div key={idx} className="bg-slate-900/80 border border-slate-800 p-2 rounded text-xs font-mono font-semibold text-emerald-300">
                      {col}
                    </div>
                  ))}
                </div>
              </div>

              {/* Text Area */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300">Edit or Paste Raw CSV Rows:</label>
                <textarea
                  value={spreadsheetText}
                  onChange={(e) => setSpreadsheetText(e.target.value)}
                  rows={8}
                  className="w-full bg-slate-950 font-mono text-xs text-emerald-400 p-4 rounded-xl border border-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="Paste CSV rows here..."
                />
              </div>

              <div className="flex justify-between items-center">
                <button
                  onClick={() => setSpreadsheetText(DEFAULT_SHEETS_CSV)}
                  className="text-xs text-slate-400 hover:text-white underline"
                >
                  Reset Template Rows
                </button>
                <button
                  onClick={handleImportSheet}
                  disabled={loading}
                  className="bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold text-sm px-6 py-2.5 rounded-xl transition shadow-lg shadow-emerald-600/15"
                >
                  Import Rows to Send Queue
                </button>
              </div>
            </div>

            {/* Instruction block */}
            <div className="bg-slate-950/40 border border-slate-800 p-5 rounded-xl space-y-2">
              <h4 className="text-sm font-semibold text-white">How the Sheet Rotation Flow Works:</h4>
              <ul className="list-disc pl-5 text-xs text-slate-400 space-y-1">
                <li>Under general configuration, the Gmail rotator script parses these imported rows sequentially.</li>
                <li>Each recipient's dynamic variables such as <code className="text-blue-300 font-mono">{"{{mark_name}}"}</code>, <code className="text-blue-300 font-mono">{"{{serial_no}}"}</code>, and <code className="text-blue-300 font-mono">{"{{reference_no}}"}</code> are automatically evaluated dynamically.</li>
                <li>The system tracks sending status, Gmail account used, and individual tracking opens by automatically syncing back state.</li>
              </ul>
            </div>
          </div>
        )}

        {/* Tab 3: Gmail Setup */}
        {activeTab === "gmail_accounts" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Rotated Gmail & SMTP Servers</h3>
                <p className="text-xs text-slate-400">Configure unlimited SMTP accounts. The dispatcher rotates them dynamically using priority levels, daily/minute send limits, and fail-safe cooldown recovery.</p>
              </div>
              <button
                onClick={() => {
                  setEditingGmail({ isNew: true });
                  setGmailForm({
                    id: "",
                    email: "",
                    senderName:"uspto.gov examination",
                    appPassword: "",
                    replyToEmail: "",
                    provider: "gmail",
                    smtpHost: "smtp.gmail.com",
                    smtpPort: 465,
                    secure: true,
                    priority: 1,
                    dailyLimit: 500,
                    minuteLimit: 50,
                    status: "enabled",
                  });
                }}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition"
              >
                <PlusCircle className="h-4 w-4" /> Add Rotator Account
              </button>
            </div>

            {/* Editing / Creating Section */}
            {editingGmail && (
              <form onSubmit={handleSaveGmail} className="bg-slate-950 border border-slate-800 p-6 rounded-2xl space-y-4 animate-in fade-in slide-in-from-top-3">
                <h4 className="text-sm font-bold text-white border-b border-slate-800 pb-2">
                  {editingGmail.isNew ? "Create Gmail Rotator Account" : "Modify Rotator Account"}
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Gmail / SMTP Email Address</label>
                    <input
                      type="email"
                      value={gmailForm.email}
                      onChange={(e) => {
  const email = e.target.value.toLowerCase();

  let provider = "custom";
  let smtpHost = "";
  let smtpPort = 465;
  let secure = true;

  if (email.endsWith("@gmail.com")) {
    provider = "gmail";
    smtpHost = "smtp.gmail.com";
  } else if (
    email.endsWith("@outlook.com") ||
    email.endsWith("@hotmail.com") ||
    email.endsWith("@live.com")
  ) {
    provider = "outlook";
    smtpHost = "smtp.office365.com";
    smtpPort = 587;
    secure = false;
  } else if (email.includes(".zoho.")) {
    provider = "zoho";
    smtpHost = "smtp.zoho.com";
  }

  setGmailForm({
    ...gmailForm,
    email,
    provider,
    smtpHost,
    smtpPort,
    secure,
  });
}}
                      required
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      placeholder="e.g. outreach1@gmail.com"
                    />
                  </div>

<div className="space-y-1">
  <label className="text-xs text-slate-400">
    Account Type
  </label>

  <select
    value={gmailForm.provider}
    onChange={(e) => {
  const provider = e.target.value;

  const smtpMap: any = {
    gmail: {
      smtpHost: "smtp.gmail.com",
      smtpPort: 465,
      secure: true,
    },
    outlook: {
      smtpHost: "smtp.office365.com",
      smtpPort: 587,
      secure: false,
    },
    zoho: {
      smtpHost: "smtp.zoho.com",
      smtpPort: 465,
      secure: true,
    },
    hostinger: {
      smtpHost: "smtp.hostinger.com",
      smtpPort: 465,
      secure: true,
    },
    namecheap: {
      smtpHost: "mail.privateemail.com",
      smtpPort: 465,
      secure: true,
    },
    godaddy: {
      smtpHost: "smtpout.secureserver.net",
      smtpPort: 465,
      secure: true,
    },
    cpanel: {
      smtpHost: "",
      smtpPort: 465,
      secure: true,
    },
    custom: {
      smtpHost: "",
      smtpPort: 465,
      secure: true,
    },
  };

  setGmailForm({
    ...gmailForm,
    provider,
    smtpHost: smtpMap[provider].smtpHost,
    smtpPort: smtpMap[provider].smtpPort,
    secure: smtpMap[provider].secure,
  });
}}
    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs"
  >
    <option value="gmail">Gmail</option>
    <option value="outlook">Outlook 365</option>
    <option value="zoho">Zoho Mail</option>
    <option value="hostinger">Hostinger</option>
    <option value="namecheap">Namecheap</option>
    <option value="godaddy">GoDaddy</option>
    <option value="cpanel">cPanel SMTP</option>
    <option value="custom">Custom SMTP</option>
  </select>
</div>


<div className="space-y-1">
  <label className="text-xs text-slate-400">
    Sender Name
  </label>

  <input
    value={gmailForm.senderName}
    onChange={(e) =>
      setGmailForm({
        ...gmailForm,
        senderName: e.target.value,
      })
    }
    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs"
  />
</div>

<div className="space-y-1">
  <label className="text-xs text-slate-400">
    Reply-To Email
  </label>

  <input
    type="email"
    value={gmailForm.replyToEmail || ""}
    onChange={(e) =>
      setGmailForm({
        ...gmailForm,
        replyToEmail: e.target.value,
      })
    }
    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs"
    placeholder="reply@yourdomain.com"
  />
</div>

                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">App Password / Auth Token</label>
                    <div className="relative">
                    <input
                      type={showGmailPassword ? "text" : "password"}
                      value={gmailForm.appPassword}
                      onChange={(e) => setGmailForm({ ...gmailForm, appPassword: e.target.value })}
                      required
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2 pr-14 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      placeholder="Enter Google App Password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowGmailPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 hover:text-white"
                    >
                      {showGmailPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">SMTP Host / Server Address</label>
                    <input
                      type="text"
                      value={gmailForm.smtpHost}
                      onChange={(e) => setGmailForm({ ...gmailForm, smtpHost: e.target.value })}
readOnly={gmailForm.provider !== "custom" && gmailForm.provider !== "cpanel"}
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">SMTP Port</label>
                    <input
                      type="number"
                      value={gmailForm.smtpPort}
                      onChange={(e) => setGmailForm({ ...gmailForm, smtpPort: Number(e.target.value) })}
readOnly={gmailForm.provider !== "custom" && gmailForm.provider !== "cpanel"}
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Daily Limit (Total)</label>
                    <input
                      type="number"
                      value={gmailForm.dailyLimit}
                      onChange={(e) => setGmailForm({ ...gmailForm, dailyLimit: Number(e.target.value) })}
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">MInute Limit</label>
                    <input
                      type="number"
                      value={gmailForm.minuteLimit}
                      onChange={(e) => setGmailForm({ ...gmailForm, minuteLimit: Number(e.target.value) })}
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Priority (Higher=First)</label>
                    <input
                      type="number"
                      value={gmailForm.priority}
                      onChange={(e) => setGmailForm({ ...gmailForm, priority: Number(e.target.value) })}
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Status</label>
                    <select
                      value={gmailForm.status}
                      onChange={(e) => setGmailForm({ ...gmailForm, status: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 text-white rounded p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                    >
                      <option value="enabled">Enabled</option>
                      <option value="disabled">Disabled</option>
                      <option value="cooldown">Cooldown</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-900">
                  <button
                    type="button"
                    onClick={() => setEditingGmail(null)}
                    className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded"
                  >
                    Cancel
                  </button>

                 <button
  type="button"
  onClick={handleVerifySMTP}
  className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-5 py-2 rounded"
>
  Test SMTP
</button>

<button
  type="submit"
  className="text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold px-5 py-2 rounded"


>
  Save Rotator Credentials
</button>
                </div>
              </form>
)}
{/* List of current accounts */}
            {isSuperAdmin() && (
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-bold">
                    <th className="p-3">Rotator Email</th>
                    <th className="p-3">Host & Port</th>
                    <th className="p-3">Priority Level</th>
                    <th className="p-3">Daily/minute Limit</th>
                    <th className="p-3">Sent Count (Today)</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {gmailAccounts.map((acc) => (
                    <tr key={acc.id} className="hover:bg-slate-900/50">
                      <td className="p-3 font-mono font-bold text-white">
                        {acc.email}
                        {acc.email.includes("rotator") && (
                          <span className="ml-2 text-[9px] bg-indigo-500/10 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/20">
                            Rotator Simulator Active
                          </span>
                        )}
                        {isSuperAdmin() && adminUsers.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2 font-sans font-normal">
                            <span className="text-[10px] text-slate-500 w-full">Assign to users (rotation pool):</span>
                            {adminUsers.filter((u: any) => u.role !== "super_admin").map((u: any) => (
                              <label key={u.id} className="inline-flex items-center gap-1 text-[10px] text-slate-300 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={(smtpAssignments[String(acc.id)] || []).includes(u.id)}
                                  onChange={() => toggleSmtpUserAssign(acc.id, u.id)}
                                  className="rounded border-slate-600"
                                />
                                {u.username}
                              </label>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="p-3 font-mono text-slate-400">
                        {acc.smtpHost}:{acc.smtpPort}
                      </td>
                      <td className="p-3">
                        <span className="bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded font-mono">
                          Level {acc.priority}
                        </span>
                      </td>
                      <td className="p-3 font-mono text-slate-400">
                        Daily: {acc.dailyLimit} / M {acc.minuteLimit}
                      </td>
                      <td className="p-3 font-mono text-slate-300">
                        <span className="text-emerald-400 font-bold">{acc.sentToday}</span> today / <span className="text-indigo-400">{acc.sentThisminute}</span> this minute
                      </td>
                      <td className="p-3">
                        {acc.status === "enabled" ? (
                          <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-bold text-[10px]">
                            ACTIVE
                          </span>
                        ) : acc.status === "disabled" ? (
                          <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded font-bold text-[10px]">
                            DISABLED
                          </span>
                        ) : (
                          <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded font-bold text-[10px]">
                            COOLDOWN
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right flex justify-end gap-2">
                        <button
                          onClick={() => handleTestGmailConnection(acc.id)}
                          className="text-[10px] bg-emerald-900/40 text-emerald-300 hover:bg-emerald-900/60 px-2.5 py-1 rounded border border-emerald-800"
                        >
                          Health Check
                        </button>
                        <button
                          onClick={() => {
                            setEditingGmail(acc);
                            setGmailForm({
                              id: acc.id.toString(),
                              email: acc.email,

                             senderName: acc.senderName,
                            replyToEmail: acc.replyToEmail || "",
                                provider: acc.provider || "gmail",
                              appPassword: acc.appPassword,
                              smtpHost: acc.smtpHost,
                              smtpPort: acc.smtpPort,
                              secure: acc.secure,
                              priority: acc.priority,
                              dailyLimit: acc.dailyLimit,
                              minuteLimit: acc.minuteLimit,
                              status: acc.status,
                            });
                          }}
                          className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded"
                        >
                          Edit
                        </button>
{can("smtp_delete") && (
                        <button
                          onClick={() => handleDeleteGmail(acc.id)}
                          className="text-[10px] bg-rose-950 text-rose-300 hover:bg-rose-900 px-2 py-1 rounded"
                        >
                          Delete
                        </button>
)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
            {!isSuperAdmin() && (
              <p className="text-xs text-slate-400 bg-slate-950/60 border border-slate-800 rounded-xl p-4">
                SMTP account list is only visible to Super Admin. You can still add new SMTP accounts above if permitted.
              </p>
            )}
          </div>
        )}

        {/* Tab 4: Templates Studio */}
        {activeTab === "templates" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">My Templates Studio</h3>
                <p className="text-xs text-slate-400">
                  Sirf aapke templates — har user ke apne alag. Variables: {"{{mark_name}}"}, {"{{serial_no}}"}, {"{{reference_no}}"}, etc.
                </p>
              </div>
              <button
                onClick={() => {
                  setEditingTemplate({ isNew: true });
                  setTemplateForm({
                    id: "",
                    name: "",
                    subject: "",
                    bodyHtml: `<!DOCTYPE html>
<html>
<body>
  <div style="font-family: sans-serif; padding: 25px; border: 1px solid #e0e0e0;">
    <h2>Action Required for Trademark {{mark_name}}</h2>
    <p>Dear Client, your trademark Serial Number {{serial_no}} has been updated as of {{today}}.</p>
    <p>Reference Code: {{reference_no}}</p>
    {{tracking_pixel}}
  </div>
</body>
</html>`,
                    bodyText: "",
                    attachmentsJson: "[]",
                  });
                }}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition"
              >
                <PlusCircle className="h-4 w-4" /> Create HTML Template
              </button>
            </div>

            {/* Template Editor Form */}
            {editingTemplate && (
              <form onSubmit={handleSaveTemplate} className="bg-slate-950 border border-slate-800 p-6 rounded-2xl space-y-4 animate-in fade-in slide-in-from-top-3">
                <h4 className="text-sm font-bold text-white border-b border-slate-800 pb-2">
                  {editingTemplate.isNew ? "Create Rich Template" : "Edit HTML Template"}
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs text-slate-400">Template Title / Name</label>
                    <input
                      type="text"
                      value={templateForm.name}
                      onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                      required
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs text-white focus:outline-none"
                      placeholder="e.g. Primary Trademark Warning"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-slate-400">Email Default Subject Line</label>
                    <input
                      type="text"
                      value={templateForm.subject}
                      onChange={(e) => setTemplateForm({ ...templateForm, subject: e.target.value })}
                      required
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs text-white focus:outline-none"
                      placeholder="e.g. URGENT: Action required for {{mark_name}}"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center flex-wrap gap-2">
                    <label className="text-xs text-slate-400">HTML Code Block</label>
                    <span className="text-[10px] text-blue-400">Variables: {"{{reference_no}}"}, {"{{serial_no}}"}, {"{{mark_name}}"}, {"{{filing_date}}"}, {"{{today}}"}, {"{{tracking_pixel}}"}</span>
                  </div>
                  <textarea
                    value={templateForm.bodyHtml}
                    onChange={(e) =>
                      setTemplateForm({ ...templateForm, bodyHtml: e.target.value })
                    }
                    onBlur={() => {
                      // Force rich editor to pick up HTML after editing code
                      setTemplateEditorKey((k) => k + 1);
                    }}
                    rows={12}
                    required
                    className="w-full bg-slate-900 font-mono text-xs text-white p-3 rounded border border-slate-800 focus:outline-none"
                    placeholder="HTML yahan paste/type karo — neeche Rich Editor mein dikhega"
                  />
                  <p className="text-[11px] text-slate-500">
                    HTML paste/edit karke textarea se bahar click karo — Rich Editor update ho jayega.
                  </p>
                </div>

                <div className="space-y-2 mt-4">
                  <label className="text-xs text-slate-400">
                    Rich Editor (Compose Email jaisa)
                  </label>
                  <div className="rounded-lg overflow-hidden border border-slate-700 bg-white">
                    <RichTextComposer
                      key={templateEditorKey}
                      value={templateForm.bodyHtml}
                      onChange={(val) =>
                        setTemplateForm((prev) => ({
                          ...prev,
                          bodyHtml: val,
                          bodyText: "",
                        }))
                      }
                      placeholder="Yahan likho — upar HTML Code Block auto update hoga..."
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Rich Editor ↔ HTML Code Block live sync: dono taraf changes reflect hote hain.
                  </p>
                </div>


<div className="mt-3">
  <label className="text-xs text-slate-400">
    Upload Attachment
  </label>

  <input
    type="file"
    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.zip,.png,.jpg,.jpeg"
    onChange={handleAttachmentUpload}
    disabled={uploadingAttachment}
    className="w-full bg-slate-900 text-slate-300 p-2 rounded border border-slate-800"
  />

  {uploadingAttachment && (
    <p className="text-xs text-blue-400 mt-2">
      Uploading...
    </p>
  )}
{JSON.parse(templateForm.attachmentsJson || "[]").map((file:any, index:number) => (
  <div key={index} className="flex items-center justify-between bg-slate-900 border border-slate-800 p-2 mt-2 rounded text-xs">
    <span className="text-emerald-400">
      📎 {file.originalName || file.filename}
    </span>

    <button
      type="button"
      onClick={() => {
        const files = JSON.parse(templateForm.attachmentsJson || "[]");
        files.splice(index, 1);

        setTemplateForm({
          ...templateForm,
          attachmentsJson: JSON.stringify(files),
        });
      }}
      className="text-rose-400 hover:text-rose-300"
    >
      Remove
    </button>
  </div>
))}
</div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-900">
                  <button
                    type="button"
                    onClick={() => setEditingTemplate(null)}
                    className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded"
                  >
                    Cancel
                  </button>

<button
  type="button"
  onClick={() => {
    setPreviewMode("html");
    setPreviewOpen(true);
  }}
  className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-5 py-2 rounded"
>
  Preview
</button>

                  <button
                    type="submit"

                    className="text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold px-5 py-2 rounded"
                  >
                    Save Template
                  </button>
                </div>
              </form>
            )}

            {/* Template List Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {templates.map((tmpl) => (
                <div key={tmpl.id} className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-white text-md">{tmpl.name}</h4>
                      <p className="text-[10px] text-slate-400 font-mono">Template ID: #{tmpl.id}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingTemplate(tmpl);
                          setTemplateForm({
                            id: tmpl.id.toString(),
                            name: tmpl.name,
                            subject: tmpl.subject,
                            bodyHtml: tmpl.bodyHtml,
                            bodyText: tmpl.bodyText,
                            attachmentsJson: tmpl.attachmentsJson,
                          });
                        }}
                        className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded border border-slate-700"
                      >
                        Modify Code
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(tmpl.id)}
                        className="text-xs bg-rose-950 text-rose-300 hover:bg-rose-900 px-3 py-1.5 rounded"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="font-semibold text-slate-300 mb-1">Attachments:</div>

<div className="text-blue-300 font-mono text-[11px]">
  {(() => {
    try {
      const files = JSON.parse(tmpl.attachmentsJson || "[]");

      if (!files.length) {
        return "No attachments";
      }

      return files.map((file:any, index:number) => (
        <div key={index}>
          📎 {file.originalName || file.filename}
        </div>
      ));
    } catch {
      return "No attachments";
    }
  })()}
</div>

                  <div className="bg-slate-900/60 p-3.5 rounded border border-slate-800 text-xs">
                    <div className="font-semibold text-slate-300 mb-1">JSON Attachments:</div>
                    <div className="text-blue-300 font-mono text-[11px]">{tmpl.attachmentsJson}</div>
                  </div>

                  <div>
                    <span className="text-xs font-semibold text-slate-400">Substituted Live Preview:</span>
                    <div
                      className="bg-white text-slate-900 rounded p-4 h-48 overflow-y-auto mt-1 scale-100 border border-slate-700 text-xs scrollbar-thin"
                      dangerouslySetInnerHTML={{
                        __html: tmpl.bodyHtml
                          .replace(/{{\s*mark_name\s*}}/gi, "GLOW-TECH TRADEMARKS")
                          .replace(/{{\s*serial_no\s*}}/gi, "90213455")
                          .replace(/{{\s*reference_no\s*}}/gi, "REF-LIVE-DEMO")
                          .replace(/{{\s*filing_date\s*}}/gi, "2026-03-01")
                          .replace(/{{\s*today\s*}}/gi, "Monday, 16th of March 2026")
                          .replace(/{{\s*tracking_pixel\s*}}/gi, "<div style='background-color:#eff6ff; padding:4px; font-size:10px; color:#1e40af; border:1px dashed #bfdbfe; margin-top:8px;'>Tracking Pixel Tracker Mock Loaded</div>")
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

{/* Tab: Manual Email */}
{activeTab === "manual" && (
  <div className="space-y-6">
    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6">
      <h3 className="text-xl font-bold text-white">
        Manual Email Composer
      </h3>
      <p className="text-sm text-slate-400 mt-2">
        Compose and send a single email using any configured SMTP account.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        {/* From SMTP Account */}
        <div className="space-y-2">
          <label className="text-xs text-slate-400">From SMTP Account</label>
          <select
            value={manualEmailForm.smtpAccountId}
            onChange={(e) =>
              setManualEmailForm({
                ...manualEmailForm,
                smtpAccountId: e.target.value,
              })
            }
            className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white text-sm"
          >
            <option value="">Select SMTP Account</option>
            {gmailAccounts.map((acc: any) => (
              <option key={acc.id} value={acc.id}>
                {acc.senderName} ({acc.email})
              </option>
            ))}
          </select>
        </div>

        {/* To Email */}
        <div className="space-y-2">
          <label className="text-xs text-slate-400">To Email</label>
          <input
            type="email"
            value={manualEmailForm.to}
            onChange={(e) =>
              setManualEmailForm({
                ...manualEmailForm,
                to: e.target.value,
              })
            }
            className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white text-sm"
            placeholder="client@example.com"
          />
        </div>
      </div>

      {/* CC / BCC / Subject */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <div className="space-y-2">
          <label className="text-xs text-slate-400">CC</label>
          <input
            type="text"
            value={manualEmailForm.cc}
            onChange={(e) =>
              setManualEmailForm({
                ...manualEmailForm,
                cc: e.target.value,
              })
            }
            className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white text-sm"
            placeholder="cc@example.com"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-slate-400">BCC</label>
          <input
            type="text"
            value={manualEmailForm.bcc}
            onChange={(e) =>
              setManualEmailForm({
                ...manualEmailForm,
                bcc: e.target.value,
              })
            }
            className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white text-sm"
            placeholder="bcc@example.com"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-slate-400">Subject</label>
          <input
            type="text"
            value={manualEmailForm.subject}
            onChange={(e) =>
              setManualEmailForm({
                ...manualEmailForm,
                subject: e.target.value,
              })
            }
            className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white text-sm"
            placeholder="Email Subject"
          />
        </div>
      </div>

     {/* HTML Editor */}
      <div className="mt-5 border border-slate-700 rounded-lg overflow-hidden">
        <RichTextComposer 
  value={manualEmailForm.html} 
  onChange={(content) => setManualEmailForm({ ...manualEmailForm, html: content })} 
/>
      </div>


      {/* Attachment */}
      <div className="space-y-2 mt-4">
        <label className="text-xs text-slate-400">Attachment</label>
        <input
          type="file"
          onChange={handleManualAttachmentUpload}
          className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white text-xs"
        />
      </div>

      {/* Buttons */}
      <div className="flex justify-end gap-3 mt-6">
        <button
          type="button"
          onClick={handlePreviewManualEmail}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded font-semibold text-sm"
        >
          Preview Email
        </button>
        <button
          type="button"
          onClick={handleSendManualEmail}
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded font-semibold text-sm"
        >
          Send Email
        </button>
      </div>
    </div>
  </div>
)}
        {/* Tab 5: Campaigns Setup */}
        {activeTab === "campaigns_tab" && (
          <div className="space-y-6">
            <div className="bg-slate-950/60 border border-slate-800 p-6 rounded-2xl space-y-4">
              <h3 className="text-lg font-bold text-white">Create New Outreach Campaign</h3>
              
              <form onSubmit={handleCreateCampaign} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Campaign Name / Identifier</label>
                  <input
                    type="text"
                    value={campaignForm.name}
                    onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })}
                    required
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none text-white"
                    placeholder="e.g. March 2026 Ingress Outreach"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Default Template to Associate</label>
                  <select
                    value={campaignForm.templateId}
                    onChange={(e) => setCampaignForm({ ...campaignForm, templateId: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 text-white rounded p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="">-- Choose Template --</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Scheduler / Live Mode</label>
                  <select
                    value={campaignForm.status}
                    onChange={(e) => setCampaignForm({ ...campaignForm, status: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 text-white rounded p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="running">Immediate Send Active</option>
                    <option value="draft">Draft Mode (Hold Queue)</option>
                  </select>
                </div>
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-6 py-2.5 rounded-lg transition h-9 shrink-0"
                >
                  Create & Launch Campaign
                </button>
              </form>
            </div>

            {/* Campaigns list */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-bold">
                    <th className="p-3">Campaign ID</th>
                    <th className="p-3">Campaign Name</th>
                    <th className="p-3">Associated HTML Template</th>
                    <th className="p-3">Created Date</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Action Toggle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {campaigns.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-900/50">
                      <td className="p-3 font-mono text-slate-400">#{c.id}</td>
                      <td className="p-3 font-bold text-white">{c.name}</td>
                      <td className="p-3 text-indigo-300 font-semibold">{c.templateName || "None Associated"}</td>
                      <td className="p-3 text-slate-400">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-3">
                        {c.status === "running" ? (
                          <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-bold text-[10px]">
                            RUNNING
                          </span>
                        ) : (
                          <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded font-bold text-[10px]">
                            PAUSED / DRAFT
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => handleToggleCampaignStatus(c.id, c.status)}
                          className={`text-xs px-3 py-1 rounded font-bold transition ${
                            c.status === "running"
                              ? "bg-amber-950 text-amber-300 hover:bg-amber-900"
                              : "bg-emerald-950 text-emerald-300 hover:bg-emerald-900"
                          }`}
                        >
                          {c.status === "running" ? "Pause Sending" : "Activate Live Send"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab: Admin Panel */}
        {activeTab === "admin" && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-slate-900 to-amber-950/40 border border-amber-900/40 p-6 rounded-2xl">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Settings className="h-5 w-5 text-amber-400" />
                Admin Panel
                {resetRequests.length > 0 && (
                  <span className="ml-2 text-xs font-bold text-red-400 bg-red-500/15 border border-red-500/40 px-2 py-0.5 rounded-full">
                    {resetRequests.length} pending
                  </span>
                )}
              </h3>
              <p className="text-sm text-slate-400 mt-1">
                Manage users, password, and system overview. Logged in as{" "}
                <span className="text-amber-400 font-semibold">{authUser?.username}</span>
              </p>
            </div>

            {/* Password reset / forgot-password notifications */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  {resetRequests.length > 0 && (
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                    </span>
                  )}
                  Password Reset Requests
                  <span className="text-xs font-normal text-slate-400">({resetRequests.length} pending)</span>
                </h4>
                <button type="button" onClick={loadResetRequests} className="text-[11px] text-slate-400 hover:text-white">Refresh</button>
              </div>
              {resetRequests.length === 0 ? (
                <p className="text-xs text-slate-500">No pending forgot-password requests.</p>
              ) : (
                <ul className="space-y-2">
                  {resetRequests.map((req: any) => (
                    <li key={req.id} className="flex flex-wrap items-center gap-3 justify-between bg-slate-900/80 border border-red-500/30 rounded-xl px-4 py-3">
                      <div className="flex items-start gap-2 min-w-0">
                        <span className="mt-1 relative flex h-2.5 w-2.5 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm text-white font-medium">
                            #{req.id} · <span className="text-amber-300">{req.username}</span>
                            <span className="ml-2 text-[10px] uppercase text-slate-400 border border-slate-700 px-1.5 py-0.5 rounded">{req.role}</span>
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">{req.message || "Password reset requested"} · {req.createdAt ? new Date(req.createdAt).toLocaleString() : ""}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
                          onClick={() => {
                            const np = prompt(`Set new password for ${req.username} (leave empty to only dismiss):`);
                            handleResolveReset(req, np || undefined);
                          }}
                        >
                          Resolve / Set password
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-400">Gmail / SMTP Accounts</p>
                <p className="text-2xl font-bold text-white mt-1">{stats.totalGmailCount}</p>
                <p className="text-[11px] text-emerald-400">{stats.activeGmailCount} active</p>
              </div>
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-400">Templates</p>
                <p className="text-2xl font-bold text-white mt-1">{stats.templatesCount}</p>
              </div>
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-400">Campaigns</p>
                <p className="text-2xl font-bold text-white mt-1">{stats.campaignsCount}</p>
              </div>
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-400">Queue Total</p>
                <p className="text-2xl font-bold text-white mt-1">{stats.totalEmails}</p>
                <p className="text-[11px] text-slate-500">{stats.sent} sent · {stats.pending} pending</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-6 space-y-4">
                <h4 className="text-lg font-bold text-white flex items-center gap-2">
                  <Users className="h-4 w-4 text-blue-400" />
                  User Management
                </h4>

                {/* Totals bar */}
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div className="bg-slate-900 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-slate-500">All Agents Sent</p>
                    <p className="text-lg font-bold text-white">{agentTotals.totalAllSent || 0}</p>
                  </div>
                  <div className="bg-slate-900 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-slate-500">Sent Today</p>
                    <p className="text-lg font-bold text-emerald-400">{agentTotals.totalToday || 0}</p>
                  </div>
                  <div className="bg-slate-900 rounded-lg p-2 text-center">
                    <p className="text-[10px] text-slate-500">Operators</p>
                    <p className="text-lg font-bold text-blue-400">{agentTotals.agents || 0}</p>
                  </div>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleCreateUser(e);
                  }}
                  className="space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400">Username</label>
                      <input
                        className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                        value={newUserForm.username}
                        onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                        required
                        placeholder="operator1"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400">Password</label>
                      <div className="relative mt-1">
                        <input
                          type={showNewUserPassword ? "text" : "password"}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 pr-14 text-sm text-white"
                          value={newUserForm.password}
                          onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                          required
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewUserPassword((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
                        >
                          {showNewUserPassword ? "Hide" : "Show"}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-slate-400">Role</label>
                      <select
                        className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                        value={newUserForm.role}
                        onChange={(e) => {
                          const role = e.target.value;
                          const defaults =
                            role === "admin"
                              ? ["compose", "templates", "admin_panel", "smtp_add", "manage_users"]
                              : ["compose", "templates"];
                          setNewUserForm({ ...newUserForm, role, permissions: defaults });
                        }}
                      >
                        <option value="operator">Operator</option>
                        {isSuperAdmin() && (
                          <option value="admin">Admin</option>
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-slate-400">Daily Send Limit</label>
                      <input
                        type="number"
                        min={1}
                        className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                        value={newUserForm.dailyLimit}
                        onChange={(e) =>
                          setNewUserForm({ ...newUserForm, dailyLimit: Number(e.target.value) || 100 })
                        }
                      />
                    </div>
                  </div>

                  {/* Permission checkboxes — Admin: only Compose + Templates; Super Admin: full list */}
                  <div className="border border-slate-800 rounded-lg p-3">
                    <p className="text-xs font-semibold text-slate-300 mb-2">
                      Permissions (check to allow)
                      {!isSuperAdmin() && (
                        <span className="text-slate-500 font-normal"> — Admin can only grant Compose + HTML Templates</span>
                      )}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {(isSuperAdmin() ? ALL_PERM_KEYS : ["compose", "templates"]).map((key) => (
                        <label
                          key={key}
                          className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer hover:text-white"
                        >
                          <input
                            type="checkbox"
                            checked={(newUserForm.permissions || []).includes(key)}
                            onChange={() => toggleNewUserPerm(key)}
                            className="rounded border-slate-600"
                          />
                          {PERM_LABELS[key] || key}
                        </label>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleCreateUser}
                    disabled={loading}
                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                  >
                    {loading ? "Creating..." : "Add User"}
                  </button>
                </form>

                <div className="border border-slate-800 rounded-xl overflow-x-auto">
                  <table className="w-full text-sm min-w-[520px]">
                    <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">User</th>
                        <th className="text-left px-3 py-2">Role</th>
                        <th className="text-left px-3 py-2">Today</th>
                        <th className="text-left px-3 py-2">Total</th>
                        <th className="text-left px-3 py-2">Limit</th>
                        <th className="text-right px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminUsers.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-4 text-center text-slate-500 text-xs">
                            No users loaded
                          </td>
                        </tr>
                      ) : (
                        adminUsers.map((u: any) => (
                          <tr key={u.id} className="border-t border-slate-800 hover:bg-slate-900/50">
                            <td className="px-3 py-2 text-white font-medium">
                              {u.username}
                              <span className="text-[10px] text-slate-500 ml-1">#{u.id}</span>
                            </td>
                            <td className="px-3 py-2">
                              <span className="text-[10px] uppercase bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                                {roleLabel(u.role)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-emerald-400">{u.sentToday || 0}</td>
                            <td className="px-3 py-2 text-slate-300">{u.totalSent || 0}</td>
                            <td className="px-3 py-2 text-slate-400">{u.dailyLimit || 100}</td>
                            <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                              {(isSuperAdmin() || can("manage_users")) &&
                                u.role !== "super_admin" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditingPermsUser({
                                      ...u,
                                      permissions: u.permissions || [],
                                      dailyLimit: u.dailyLimit || 100,
                                    })
                                  }
                                  className="text-xs text-blue-400 hover:text-blue-300"
                                >
                                  Edit
                                </button>
                              )}
                              {u.id !== authUser?.id && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteUser(u.id)}
                                  className="text-xs text-rose-400 hover:text-rose-300"
                                >
                                  Delete
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Edit permissions modal */}
                {editingPermsUser && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                    <div className="bg-slate-950 border border-slate-700 rounded-2xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
                      <h4 className="text-lg font-bold text-white">
                        Edit User #{editingPermsUser.id}
                      </h4>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-slate-400">Username</label>
                          <input
                            type="text"
                            className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                            value={editingPermsUser.username || ""}
                            onChange={(e) =>
                              setEditingPermsUser({
                                ...editingPermsUser,
                                username: e.target.value,
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-400">
                            New Password{" "}
                            <span className="text-slate-600">(blank = no change)</span>
                          </label>
                          <div className="relative mt-1">
                            <input
                              type={showNewPassword ? "text" : "password"}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 pr-14 text-sm text-white"
                              value={editingPermsUser.newPassword || ""}
                              onChange={(e) =>
                                setEditingPermsUser({
                                  ...editingPermsUser,
                                  newPassword: e.target.value,
                                })
                              }
                              placeholder="Leave blank to keep current"
                            />
                            <button
                              type="button"
                              onClick={() => setShowNewPassword((v) => !v)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
                            >
                              {showNewPassword ? "Hide" : "Show"}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setEditingPermsUser({
                              ...editingPermsUser,
                              newPassword: "pass123",
                            })
                          }
                          className="text-xs px-3 py-1.5 rounded-lg border border-amber-700 text-amber-300 hover:bg-amber-950"
                        >
                          Reset password → pass123
                        </button>
                      </div>

                      <div>
                        <label className="text-xs text-slate-400">Daily Limit</label>
                        <input
                          type="number"
                          className="w-full mt-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                          value={editingPermsUser.dailyLimit || 100}
                          onChange={(e) =>
                            setEditingPermsUser({
                              ...editingPermsUser,
                              dailyLimit: Number(e.target.value) || 100,
                            })
                          }
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                        {ALL_PERM_KEYS.map((key) => (
                          <label key={key} className="flex items-center gap-2 text-xs text-slate-300">
                            <input
                              type="checkbox"
                              checked={(editingPermsUser.permissions || []).includes(key)}
                              onChange={() => toggleEditPerm(key)}
                            />
                            {PERM_LABELS[key] || key}
                          </label>
                        ))}
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingPermsUser(null)}
                          className="px-4 py-2 text-sm border border-slate-600 rounded-lg text-slate-300"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleUpdatePermissions}
                          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg"
                        >
                          Save Changes
                        </button>
                      </div>
                    </div>
                  </div>
                )}

              </div>

              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-6 space-y-4">
                <h4 className="text-lg font-bold text-white">Change My Password</h4>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleChangePassword(e);
                  }}
                  className="space-y-3"
                >
                  <div>
                    <label className="text-xs text-slate-400">Current Password</label>
                    <div className="relative mt-1">
                      <input
                        type={showCurrentPassword ? "text" : "password"}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 pr-14 text-sm text-white"
                        value={passwordForm.currentPassword}
                        onChange={(e) =>
                          setPasswordForm({ ...passwordForm, currentPassword: e.target.value })
                        }
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPassword((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
                      >
                        {showCurrentPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">New Password</label>
                    <div className="relative mt-1">
                      <input
                        type={showNewPassword ? "text" : "password"}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 pr-14 text-sm text-white"
                        value={passwordForm.newPassword}
                        onChange={(e) =>
                          setPasswordForm({ ...passwordForm, newPassword: e.target.value })
                        }
                        required
                        minLength={4}
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
                      >
                        {showNewPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-amber-600 hover:bg-amber-500 text-white font-semibold py-2.5 rounded-lg text-sm disabled:opacity-50"
                  >
                    Update Password
                  </button>
                </form>

                <div className="pt-4 border-t border-slate-800 space-y-2 text-xs text-slate-400">
                  <p className="font-semibold text-slate-300">Quick notes</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Default login: admin / admin123</li>
                    <li>Only admins can create / delete users</li>
                    <li>Session lasts 7 days</li>
                    <li>Gmail, templates, campaigns — unke apne tabs se manage karo</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}


      </main>

    {/* ================= TEMPLATE PREVIEW MODAL ================= */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
          <div className="w-full max-w-5xl bg-slate-950 border border-slate-700 rounded-xl overflow-hidden">

            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
              <h3 className="text-white font-bold">
                Template Preview
              </h3>

              <div className="flex gap-2">

                <button
                  onClick={() => setPreviewMode("html")}
                  className={`px-3 py-1 rounded text-xs ${
                    previewMode === "html"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-800 text-slate-300"
                  }`}
                >
                  HTML
                </button>

                <button
                  onClick={() => setPreviewMode("text")}
                  className={`px-3 py-1 rounded text-xs ${
                    previewMode === "text"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-800 text-slate-300"
                  }`}
                >
                  Plain Text
                </button>

                <button
                  onClick={() => setPreviewOpen(false)}
                  className="bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded text-xs"
                >
                  Close
                </button>

              </div>
            </div>

            <div className="p-6 max-h-[80vh] overflow-auto bg-white">

              {previewMode === "html" ? (
                <div
                  dangerouslySetInnerHTML={{
                    __html: templateForm.bodyHtml,
                  }}
                />
              ) : (
                <pre className="whitespace-pre-wrap text-black text-sm">
                  {templateForm.bodyText}
                </pre>
              )}

            </div>
          </div>
        </div>
      )}


      {/* Footer information bar */}
      <footer className="border-t border-slate-800 bg-slate-950 py-6 mt-12 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <p>© 2026 EMAIL AUTOMATION DASHBOARD V1. Designed for production speed, zero-duplicates, and high efficiency.</p>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 bg-emerald-400 rounded-full"></span>
              Postgres Connected
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400 font-mono">Reference No, Serial No, Mark Name, Filing Date Auto-Mapped</span>
          </div>
        </div>
      </footer>

    </div>
  );
}

