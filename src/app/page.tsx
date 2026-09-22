"use client";

import React, { useState, useEffect, useMemo } from "react";

export default function EmailAutomationDashboard() {
  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-8">
      <div className="max-w-lg text-center space-y-4">
        <h1 className="text-2xl font-bold">Dashboard restoring…</h1>
        <p className="text-slate-400 text-sm">
          Full UI is being restored. Please hard-refresh in 1–2 minutes after the next deploy.
          Attachment fix (PDF/JPG) is already live on the server.
        </p>
      </div>
    </div>
  );
}
