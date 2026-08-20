import React, { useState } from 'react';
import { ApiConfiguration } from '../types/route';
import {
  Check,
  Cpu,
  Database,
  ExternalLink,
  Radio,
  Server,
  ShieldCheck,
  Sliders,
  X,
} from 'lucide-react';

interface ApiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ApiConfiguration;
  onSaveConfig: (cfg: ApiConfiguration) => void;
}

export const ApiSettingsModal: React.FC<ApiSettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
}) => {
  const [orsKey, setOrsKey] = useState(config.openRouteServiceKey || '');
  const [fastApiUrl, setFastApiUrl] = useState(config.fastApiEndpointUrl || '');
  const [supabaseUrl, setSupabaseUrl] = useState(config.supabaseUrl || '');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(config.supabaseAnonKey || '');
  const [sentryDsn, setSentryDsn] = useState(config.sentryDsn || '');
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveConfig({
      openRouteServiceKey: orsKey.trim() || undefined,
      fastApiEndpointUrl: fastApiUrl.trim() || undefined,
      supabaseUrl: supabaseUrl.trim() || undefined,
      supabaseAnonKey: supabaseAnonKey.trim() || undefined,
      sentryDsn: sentryDsn.trim() || undefined,
    });
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 900);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-xl max-h-[85vh] rounded-3xl bg-[#FAF7F2] dark:bg-[#19201D] border border-[#E5DFD3] dark:border-[#2E3C34] shadow-2xl flex flex-col overflow-hidden text-stone-800 dark:text-stone-100">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[#E5DFD3] dark:border-[#2E3C34] flex items-center justify-between bg-white/70 dark:bg-[#1E2723]/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#2D4F3E]/10 dark:bg-[#3D6B56]/25 text-[#2D4F3E] dark:text-[#7EB89B] border border-[#2D4F3E]/20">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">API & Microservices Architecture</h3>
              <p className="text-xs text-stone-500 dark:text-stone-400">Configure production endpoints, PostGIS, and microservices</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-[#25302A] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-4">
          <div className="p-3 rounded-xl bg-white dark:bg-[#202924] border border-[#E5DFD3] dark:border-[#2E3C34] text-xs text-stone-600 dark:text-stone-300 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#2D4F3E] dark:text-[#7EB89B] shrink-0" />
            <span>
              <strong>Zero-friction mode:</strong> Built-in vector glyph synthesis and simulated spatial road graph snapping run seamlessly in this client session out of the box!
            </span>
          </div>

          {/* 1. OpenRouteService / HeiGIT Key */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-stone-800 dark:text-stone-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-[#2D4F3E] dark:text-[#7EB89B]" />
                OpenRouteService / HeiGIT Key (Standard Routing)
              </span>
              <a
                href="https://openrouteservice.org/dev/#/signup"
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-[#2D4F3E] dark:text-[#7EB89B] hover:underline flex items-center gap-0.5"
              >
                Get Free Key on HeiGIT <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </label>
            <input
              type="text"
              value={orsKey}
              onChange={(e) => setOrsKey(e.target.value)}
              placeholder="Paste your HeiGIT / ORS key (supports new 120-char tokens)..."
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#151B18] border border-[#E5DFD3] dark:border-[#2E3C34] text-xs font-mono text-stone-800 dark:text-stone-200 placeholder-stone-400 focus:outline-none focus:border-[#2D4F3E]"
            />
          </div>

          {/* 2. Python FastAPI Microservice on Render */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-stone-800 dark:text-stone-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-[#8C6838] dark:text-[#DFBD84]" />
                Render Python FastAPI URL (OSMnx / NetworkX)
              </span>
              <span className="text-[10px] text-stone-500">Render Web Service</span>
            </label>
            <input
              type="url"
              value={fastApiUrl}
              onChange={(e) => setFastApiUrl(e.target.value)}
              placeholder="https://gps-art-fastapi.onrender.com"
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#151B18] border border-[#E5DFD3] dark:border-[#2E3C34] text-xs font-mono text-stone-800 dark:text-stone-200 placeholder-stone-400 focus:outline-none focus:border-[#8C6838]"
            />
          </div>

          {/* 3. Supabase PostGIS */}
          <div className="flex flex-col gap-2 p-3 rounded-2xl bg-white dark:bg-[#202924] border border-[#E5DFD3] dark:border-[#2E3C34]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-[#2D4F3E] dark:text-[#7EB89B]" />
                Supabase PostGIS Database & Auth
              </span>
              <a
                href="https://supabase.com"
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-[#2D4F3E] dark:text-[#7EB89B] hover:underline flex items-center gap-0.5"
              >
                Supabase Console <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>

            <input
              type="url"
              value={supabaseUrl}
              onChange={(e) => setSupabaseUrl(e.target.value)}
              placeholder="Supabase Project URL (https://xyz.supabase.co)"
              className="w-full px-3 py-2 rounded-lg bg-[#FAF7F2] dark:bg-[#151B18] border border-[#E5DFD3] dark:border-[#2E3C34] text-xs font-mono text-stone-800 dark:text-stone-200 placeholder-stone-400 focus:outline-none focus:border-[#2D4F3E]"
            />

            <input
              type="text"
              value={supabaseAnonKey}
              onChange={(e) => setSupabaseAnonKey(e.target.value)}
              placeholder="Supabase Anon Key (eyJhbGciOi...)"
              className="w-full px-3 py-2 rounded-lg bg-[#FAF7F2] dark:bg-[#151B18] border border-[#E5DFD3] dark:border-[#2E3C34] text-xs font-mono text-stone-800 dark:text-stone-200 placeholder-stone-400 focus:outline-none focus:border-[#2D4F3E]"
            />
          </div>

          {/* 4. Sentry DSN */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-stone-800 dark:text-stone-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-[#C86432]" />
                Sentry DSN (Observability & Exception Tracking)
              </span>
            </label>
            <input
              type="text"
              value={sentryDsn}
              onChange={(e) => setSentryDsn(e.target.value)}
              placeholder="https://abc123xyz@o000000.ingest.sentry.io/0000000"
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#151B18] border border-[#E5DFD3] dark:border-[#2E3C34] text-xs font-mono text-stone-800 dark:text-stone-200 placeholder-stone-400 focus:outline-none focus:border-[#C86432]"
            />
          </div>

          {/* Footer Save CTA */}
          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-[#25302A] transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#2D4F3E] hover:bg-[#233F31] text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-[#2D4F3E]/20 cursor-pointer"
            >
              {savedSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Config Saved!</span>
                </>
              ) : (
                <span>Save Configuration</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
