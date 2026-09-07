"use client";

import { useEffect } from "react";

export default function Page() {
  useEffect(() => {
    // Auto-redirect note for operators
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="max-w-lg w-full border border-slate-800 rounded-2xl p-8 space-y-4 bg-slate-900">
        <h1 className="text-xl font-bold text-blue-400">Email Automation</h1>
        <p className="text-sm text-slate-300">
          Dashboard UI file is being restored. Tracking pixel, Google Sheets open-count,
          and manual open logging on the API are already live.
        </p>
        <p className="text-xs text-slate-500 font-mono">
          Restore src/app/page.tsx from commit 1db96fbc (or use History on GitHub).
        </p>
        <a
          className="inline-block text-sm text-blue-400 underline"
          href="https://github.com/jamesrock78691-cube/email-automation-/blob/1db96fbc4e8707fa164d5f0c3f998ef720d2a968/src/app/page.tsx"
          target="_blank"
          rel="noreferrer"
        >
          Open good page.tsx on GitHub
        </a>
      </div>
    </div>
  );
}
