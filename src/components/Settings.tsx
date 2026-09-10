import { useState } from 'react';
import { 
  ArrowLeft, 
  Key, 
  Volume2, 
  ChevronRight, 
  Bot, 
  Sparkles, 
  ExternalLink, 
  Globe, 
  Cpu, 
  CheckCircle2, 
  AlertCircle,
  Loader2
} from 'lucide-react';
import { ViewState } from '../types';

interface SettingsProps {
  onNavigate: (view: ViewState) => void;
  apiKey: string;
  setApiKey: (key: string) => void;
  awsAccessKeyId: string;
  setAwsAccessKeyId: (key: string) => void;
  awsSecretAccessKey: string;
  setAwsSecretAccessKey: (key: string) => void;
  awsRegion: string;
  setAwsRegion: (val: string) => void;
  awsS3Bucket: string;
  setAwsS3Bucket: (val: string) => void;
  workflow: string;
  setWorkflow: (workflow: string) => void;
  model: string;
  setModel: (model: string) => void;
  voice: 'Piseth' | 'Sreymom';
  setVoice: (voice: 'Piseth' | 'Sreymom') => void;
  volume: number;
  setVolume: (val: number) => void;
  aiProvider: string;
  setAiProvider: (provider: string) => void;
  customApiKey: string;
  setCustomApiKey: (key: string) => void;
  customBaseUrl: string;
  setCustomBaseUrl: (url: string) => void;
  customModel: string;
  setCustomModel: (model: string) => void;
}

const CODECRAFT_MODELS = [
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', desc: 'ណែនាំខ្ពស់សម្រាប់បកប្រែ & AI Agent' },
  { id: 'claude-opus-5', name: 'Claude Opus 5', desc: 'ឆ្លាតវៃកម្រិតកំពូល (Top Performance)' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', desc: 'ល្បឿនលឿន 290 chars/s, សន្សំសំចៃ' },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', desc: 'Flagship Model របស់ OpenAI' },
  { id: 'deepseek-v4-pro-0813', name: 'DeepSeek V4 Pro', desc: '1.6T Parameters, ពូកែភាសាខ្មែរ' },
  { id: 'deepseek-v4-flash-0731', name: 'DeepSeek V4 Flash', desc: 'លឿន & តម្លៃសមរម្យបំផុត' },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', desc: 'Google Flash ជំនាន់ថ្មី' },
  { id: 'qwen3.8-max', name: 'Qwen 3.8 Max', desc: 'Alibaba Flagship 2.4T params' },
  { id: 'glm-5.3', name: 'GLM-5.3', desc: 'Zhipu AI Agent Model' },
  { id: 'grok-4.6', name: 'Grok 4.6', desc: 'xAI Reasoning Model' },
  { id: 'custom', name: 'បញ្ចូល Model ផ្សេងទៀត...', desc: 'វាយឈ្មោះ model ដោយខ្លួនឯង' }
];

export default function Settings({ 
  onNavigate, apiKey, setApiKey, awsAccessKeyId, setAwsAccessKeyId, 
  awsSecretAccessKey, setAwsSecretAccessKey, awsRegion, setAwsRegion, 
  awsS3Bucket, setAwsS3Bucket, workflow, setWorkflow, model, setModel, 
  voice, setVoice, volume, setVolume,
  aiProvider, setAiProvider, customApiKey, setCustomApiKey,
  customBaseUrl, setCustomBaseUrl, customModel, setCustomModel
}: SettingsProps) {
  
  const [testAwsMessage, setTestAwsMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);
  const [isTestingAws, setIsTestingAws] = useState(false);

  const [testAiMessage, setTestAiMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);
  const [isTestingAi, setIsTestingAi] = useState(false);

  const isCodeCraftCustom = !CODECRAFT_MODELS.slice(0, -1).some(m => m.id === customModel);

  const handleTestAi = async () => {
    setIsTestingAi(true);
    setTestAiMessage(null);
    try {
      const res = await fetch('/api/test-ai-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiProvider,
          apiKey: aiProvider === 'gemini' ? apiKey : customApiKey,
          baseUrl: customBaseUrl,
          model: aiProvider === 'gemini' ? model : customModel
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestAiMessage({ 
          type: 'success', 
          text: `${data.message} (${data.reply ? `ឆ្លើយតប: "${data.reply}"` : ''})` 
        });
      } else {
        setTestAiMessage({ type: 'error', text: data.error || 'ការតភ្ជាប់មិនបានសម្រេច' });
      }
    } catch (e: any) {
      setTestAiMessage({ type: 'error', text: 'បរាជ័យ: មិនអាចភ្ជាប់ទៅកាន់ Server បាន (' + e.message + ')' });
    } finally {
      setIsTestingAi(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 h-screen bg-[#0f0f13]">
      {/* Header */}
      <div className="flex items-center gap-4 p-4 bg-gray-950 border-b border-gray-900 sticky top-0 z-10">
        <button onClick={() => onNavigate('home')} className="text-gray-300 hover:text-white transition p-1 -ml-1">
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-lg font-bold text-gray-100">ការកំណត់ & AI Models</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-24">
        
        {/* AI MODEL PROVIDER SECTION */}
        <section>
          <div className="flex items-center justify-between mb-3 pl-1">
            <h2 className="text-[11px] font-bold text-pink-500 uppercase tracking-widest flex items-center gap-1.5">
              <Sparkles size={13} />
              <span>AI MODEL PROVIDER & AGENT</span>
            </h2>
            <span className="text-[10px] text-gray-400 bg-gray-800/80 px-2 py-0.5 rounded-full">
              {aiProvider === 'codecraft' ? 'CodeCraft API' : aiProvider === 'custom' ? 'OpenAI Compatible' : 'Google Gemini'}
            </span>
          </div>

          {/* Provider Selection Tabs */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <button
              type="button"
              onClick={() => setAiProvider('gemini')}
              className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center gap-1.5 ${
                aiProvider === 'gemini'
                  ? 'bg-pink-950/40 border-pink-500/80 text-white shadow-sm'
                  : 'bg-gray-900/60 border-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              <Sparkles size={16} className={aiProvider === 'gemini' ? 'text-pink-400' : 'text-gray-500'} />
              <span className="text-xs font-semibold">Gemini</span>
              <span className="text-[9px] text-gray-500">Google AI</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setAiProvider('codecraft');
                setCustomBaseUrl('https://codecraftapi.com/v1');
                if (!customModel || customModel.startsWith('gemini-2')) {
                  setCustomModel('claude-sonnet-5');
                }
              }}
              className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center gap-1.5 ${
                aiProvider === 'codecraft'
                  ? 'bg-orange-950/40 border-orange-500/80 text-white shadow-sm'
                  : 'bg-gray-900/60 border-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              <Cpu size={16} className={aiProvider === 'codecraft' ? 'text-orange-400' : 'text-gray-500'} />
              <span className="text-xs font-semibold">CodeCraft</span>
              <span className="text-[9px] text-orange-400/80 font-medium">31+ Models</span>
            </button>

            <button
              type="button"
              onClick={() => setAiProvider('custom')}
              className={`p-2.5 rounded-xl border text-center transition flex flex-col items-center gap-1.5 ${
                aiProvider === 'custom'
                  ? 'bg-blue-950/40 border-blue-500/80 text-white shadow-sm'
                  : 'bg-gray-900/60 border-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              <Globe size={16} className={aiProvider === 'custom' ? 'text-blue-400' : 'text-gray-500'} />
              <span className="text-xs font-semibold">Custom</span>
              <span className="text-[9px] text-gray-500">OpenAI / Other</span>
            </button>
          </div>

          {/* CODECRAFT API SETTINGS */}
          {aiProvider === 'codecraft' && (
            <div className="bg-gray-900/80 rounded-2xl p-4 border border-orange-900/40 space-y-4 mb-3 shadow-sm">
              {/* External link to CodeCraft Dashboard / Playground */}
              <a
                href="https://codecraftapi.com/dashboard/playground"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-orange-950/60 to-amber-950/40 border border-orange-700/40 text-xs text-orange-200 hover:text-white transition group"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">⚡</span>
                  <div>
                    <div className="font-semibold text-orange-100 flex items-center gap-1">
                      CodeCraft Playground & API Key
                      <ExternalLink size={12} className="text-orange-400 group-hover:translate-x-0.5 transition" />
                    </div>
                    <div className="text-[10px] text-orange-300/80">codecraftapi.com/dashboard/playground</div>
                  </div>
                </div>
                <span className="text-[11px] bg-orange-500/20 px-2 py-0.5 rounded text-orange-300 font-mono">1M Tokens Free</span>
              </a>

              {/* CodeCraft API Key */}
              <div>
                <label className="text-[11px] font-semibold text-gray-400 block mb-1.5">CodeCraft API Key</label>
                <div className="flex items-center gap-3 bg-black/40 p-2.5 rounded-xl border border-gray-800">
                  <Key size={16} className="text-orange-500 shrink-0" />
                  <input
                    type="password"
                    className="bg-transparent text-sm font-mono tracking-wider text-gray-200 outline-none w-full"
                    placeholder="បញ្ចូល CodeCraft API Key (sk-...)"
                    value={customApiKey}
                    onChange={(e) => setCustomApiKey(e.target.value)}
                  />
                </div>
              </div>

              {/* Model Selector */}
              <div>
                <label className="text-[11px] font-semibold text-gray-400 block mb-1.5">ជ្រើសរើស AI Model (31+ Models)</label>
                <div className="relative bg-black/40 rounded-xl p-3 border border-gray-800 cursor-pointer hover:bg-black/60 transition">
                  <select
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    value={isCodeCraftCustom ? 'custom' : customModel}
                    onChange={(e) => {
                      if (e.target.value !== 'custom') {
                        setCustomModel(e.target.value);
                      }
                    }}
                  >
                    {CODECRAFT_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} — {m.desc}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-white">
                        {CODECRAFT_MODELS.find(m => m.id === customModel)?.name || customModel}
                      </div>
                      <div className="text-[11px] text-orange-300/80 mt-0.5">
                        {CODECRAFT_MODELS.find(m => m.id === customModel)?.desc || 'Custom Model Selected'}
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-gray-500" />
                  </div>
                </div>

                {isCodeCraftCustom && (
                  <div className="mt-2 bg-black/40 p-2.5 rounded-xl border border-gray-800">
                    <input
                      type="text"
                      className="bg-transparent text-xs font-mono text-gray-200 outline-none w-full"
                      placeholder="វាយឈ្មោះ model (ឧទាហរណ៍: claude-fable-5, kimi-k3)"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {/* Base URL info */}
              <div className="text-[11px] text-gray-500 flex items-center justify-between px-1">
                <span>Base URL:</span>
                <span className="font-mono text-gray-400">{customBaseUrl || 'https://codecraftapi.com/v1'}</span>
              </div>
            </div>
          )}

          {/* CUSTOM OPENAI-COMPATIBLE SETTINGS */}
          {aiProvider === 'custom' && (
            <div className="bg-gray-900/80 rounded-2xl p-4 border border-blue-900/40 space-y-4 mb-3 shadow-sm">
              <div>
                <label className="text-[11px] font-semibold text-gray-400 block mb-1.5">OpenAI-Compatible Base URL</label>
                <div className="flex items-center gap-3 bg-black/40 p-2.5 rounded-xl border border-gray-800">
                  <Globe size={16} className="text-blue-400 shrink-0" />
                  <input
                    type="text"
                    className="bg-transparent text-sm font-mono tracking-wider text-gray-200 outline-none w-full"
                    placeholder="https://api.openai.com/v1"
                    value={customBaseUrl}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-gray-400 block mb-1.5">API Key</label>
                <div className="flex items-center gap-3 bg-black/40 p-2.5 rounded-xl border border-gray-800">
                  <Key size={16} className="text-blue-400 shrink-0" />
                  <input
                    type="password"
                    className="bg-transparent text-sm font-mono tracking-wider text-gray-200 outline-none w-full"
                    placeholder="sk-..."
                    value={customApiKey}
                    onChange={(e) => setCustomApiKey(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-gray-400 block mb-1.5">Model Name</label>
                <div className="flex items-center gap-3 bg-black/40 p-2.5 rounded-xl border border-gray-800">
                  <Bot size={16} className="text-blue-400 shrink-0" />
                  <input
                    type="text"
                    className="bg-transparent text-sm font-mono tracking-wider text-gray-200 outline-none w-full"
                    placeholder="gpt-4o, deepseek-chat, llama-3.3-70b-versatile..."
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* GOOGLE GEMINI SETTINGS */}
          {aiProvider === 'gemini' && (
            <div className="bg-gray-900/80 rounded-2xl p-4 border border-gray-800 space-y-4 mb-3 shadow-sm">
              <div>
                <label className="text-[11px] font-semibold text-gray-400 block mb-1.5">Gemini API Key (Optional)</label>
                <div className="flex items-center gap-3 bg-black/40 p-2.5 rounded-xl border border-gray-800">
                  <Key size={16} className="text-pink-500 shrink-0" />
                  <input
                    type="password"
                    className="bg-transparent text-sm font-mono tracking-wider text-gray-200 outline-none w-full"
                    placeholder="Enter Gemini API Key (defaults to server key)"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-gray-400 block mb-1.5">Gemini Model</label>
                <div className="relative bg-black/40 rounded-xl p-3 border border-gray-800 cursor-pointer hover:bg-black/60 transition">
                  <select
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (លឿន & ត្រឹមត្រូវ)</option>
                    <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                    <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
                    <option value="gemini-3.7-flash">Gemini 3.7 Flash</option>
                  </select>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-white">
                        {model === 'gemini-2.5-flash' ? 'Gemini 2.5 Flash' :
                         model === 'gemini-3.5-flash' ? 'Gemini 3.5 Flash' :
                         model === 'gemini-3.6-flash' ? 'Gemini 3.6 Flash' : 'Gemini 3.7 Flash'}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        Google GenAI Model សម្រាប់បកប្រែ & ដំណើរការ Subtitles
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-gray-500" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Test AI Connection Button & Message */}
          <div className="space-y-2">
            {testAiMessage && (
              <div className={`p-3 rounded-xl text-xs flex items-start gap-2 border ${
                testAiMessage.type === 'success' 
                  ? 'bg-green-950/40 text-green-300 border-green-800/60' 
                  : 'bg-red-950/40 text-red-300 border-red-800/60'
              }`}>
                {testAiMessage.type === 'success' ? (
                  <CheckCircle2 size={16} className="text-green-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
                )}
                <span className="leading-relaxed">{testAiMessage.text}</span>
              </div>
            )}

            <button
              disabled={isTestingAi}
              onClick={handleTestAi}
              className="w-full py-2.5 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-2"
            >
              {isTestingAi ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>កំពុងសាកល្បងភ្ជាប់ AI Model...</span>
                </>
              ) : (
                <>
                  <Bot size={14} />
                  <span>សាកល្បងភ្ជាប់ AI Agent (Test AI Connection)</span>
                </>
              )}
            </button>
          </div>
        </section>

        {/* AWS CREDENTIALS SECTION */}
        <section>
          <h2 className="text-[11px] font-bold text-gray-500 mb-3 uppercase tracking-widest pl-1">AWS CREDENTIALS (TRANSCRIBE)</h2>
          <div className="bg-gray-900/80 rounded-2xl p-4 border border-gray-800 space-y-4 mb-3 shadow-sm">
            
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-900/20 rounded-lg shrink-0">
                <Key size={18} className="text-blue-500" />
              </div>
              <input
                type="password"
                className="bg-transparent text-sm font-mono tracking-wider text-gray-200 outline-none w-full"
                placeholder="AWS Access Key ID"
                value={awsAccessKeyId}
                onChange={(e) => setAwsAccessKeyId(e.target.value)}
              />
            </div>
            
            <div className="h-px bg-gray-800/80 w-full"></div>
            
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-900/20 rounded-lg shrink-0">
                <Key size={18} className="text-blue-500" />
              </div>
              <input
                type="password"
                className="bg-transparent text-sm font-mono tracking-wider text-gray-200 outline-none w-full"
                placeholder="AWS Secret Access Key"
                value={awsSecretAccessKey}
                onChange={(e) => setAwsSecretAccessKey(e.target.value)}
              />
            </div>
            
            <div className="h-px bg-gray-800/80 w-full"></div>
            
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-900/20 rounded-lg shrink-0">
                <Key size={18} className="text-blue-400" />
              </div>
              <input
                type="text"
                className="bg-transparent text-sm font-mono tracking-wider text-gray-200 outline-none w-full"
                placeholder="AWS Region (e.g. ap-southeast-2)"
                value={awsRegion}
                onChange={(e) => setAwsRegion(e.target.value)}
              />
            </div>
            
            <div className="h-px bg-gray-800/80 w-full"></div>
            
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-900/20 rounded-lg shrink-0">
                <Key size={18} className="text-blue-400" />
              </div>
              <input
                type="text"
                className="bg-transparent text-sm font-mono tracking-wider text-gray-200 outline-none w-full"
                placeholder="AWS S3 Bucket Name"
                value={awsS3Bucket}
                onChange={(e) => setAwsS3Bucket(e.target.value)}
              />
            </div>
            
            <div className="flex flex-col gap-2 pt-2">
              {testAwsMessage && (
                <div className={`p-3 rounded-lg text-sm ${testAwsMessage.type === 'success' ? 'bg-green-900/30 text-green-400 border border-green-800' : 'bg-red-900/30 text-red-400 border border-red-800'}`}>
                  {testAwsMessage.text}
                </div>
              )}
              <button
                disabled={isTestingAws}
                onClick={async () => {
                  setIsTestingAws(true);
                  setTestAwsMessage(null);
                  try {
                    const res = await fetch('/api/test-aws', {
                      method: 'POST',
                      headers: {
                        'x-aws-access-key-id': awsAccessKeyId,
                        'x-aws-secret-access-key': awsSecretAccessKey,
                        'x-aws-region': awsRegion,
                        'x-aws-s3-bucket': awsS3Bucket
                      }
                    });
                    const data = await res.json();
                    if (res.ok) {
                      setTestAwsMessage({ type: 'success', text: data.message });
                    } else {
                      setTestAwsMessage({ type: 'error', text: data.error });
                    }
                  } catch(e) {
                    setTestAwsMessage({ type: 'error', text: 'បរាជ័យ: មិនអាចភ្ជាប់ទៅកាន់ Server បាន' });
                  } finally {
                    setIsTestingAws(false);
                  }
                }}
                className="px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-2 mt-2"
              >
                {isTestingAws ? 'កំពុងសាកល្បង...' : 'សាកល្បងភ្ជាប់ AWS (Test Connection)'}
              </button>
            </div>
            
          </div>
        </section>

        {/* TRANSCRIPTION WORKFLOW SECTION */}
        <section>
          <h2 className="text-[11px] font-bold text-gray-500 mb-3 uppercase tracking-widest pl-1">
            ដំណើរការ TRANSCRIPTION
          </h2>

          <div className="relative bg-gray-900/80 rounded-2xl p-4 border border-gray-800 cursor-pointer hover:bg-gray-900 transition shadow-sm">
            {aiProvider === 'gemini' ? (
              <>
                <select
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  value={workflow}
                  onChange={(e) => setWorkflow(e.target.value)}
                >
                  <option value="amazon">AWS Transcribe → Gemini Translate</option>
                  <option value="gemini">Gemini → Transcribe + Translate</option>
                </select>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {workflow === 'amazon'
                        ? 'AWS Transcribe → Gemini Translate'
                        : 'Gemini → Transcribe + Translate'}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-1">
                      ជ្រើសរើសវិធី Transcription និង Translation
                    </p>
                  </div>
                  <ChevronRight size={18} className="text-gray-500" />
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">
                    AWS Transcribe → {aiProvider === 'codecraft' ? 'CodeCraft' : 'Custom'} AI ({customModel})
                  </p>
                  <p className="text-[11px] text-orange-300/80 mt-1">
                    AWS ស្ដាប់សំឡេងដើម ➔ {customModel} បកប្រែជាភាសាខ្មែរ
                  </p>
                </div>
                <Sparkles size={16} className="text-orange-400" />
              </div>
            )}
          </div>
        </section>

        {/* VOICE SECTION */}
        <section>
          <h2 className="text-[11px] font-bold text-gray-500 mb-3 uppercase tracking-widest pl-1">សំឡេងអ្នកអាន (KHMER TTS)</h2>
          <div className="bg-gray-900/80 rounded-2xl p-4.5 border border-gray-800 space-y-5 shadow-sm">
            
            <div className="flex items-center justify-between">
              <div className="pr-4">
                <div className="text-sm font-medium mb-1.5 text-gray-200">Cut the delay</div>
                <div className="text-[11px] text-gray-500 leading-relaxed">
                  Trims the silence Edge-TTS adds to the start of every clip, so the dub lands on the picture instead of just after it.
                </div>
              </div>
              <div className="w-12 h-7 bg-pink-600 rounded-full relative shrink-0 cursor-pointer shadow-inner">
                <div className="absolute right-1 top-1 bottom-1 w-5 bg-white rounded-full shadow-sm"></div>
              </div>
            </div>
            
            <div className="h-px bg-gray-800/80 w-full"></div>
            
            <div className="flex items-center justify-between">
               <div className="text-sm font-medium text-gray-200">សំឡេងអ្នកអាន</div>
               <div className="text-sm text-pink-500 font-bold bg-pink-900/10 px-3 py-1 rounded-lg border border-pink-900/30">{voice}</div>
            </div>
            
            <div className="flex gap-3">
              <button 
                onClick={() => setVoice('Piseth')}
                className={`flex-1 py-3 rounded-xl flex items-center justify-center gap-2 text-sm border transition ${
                  voice === 'Piseth' 
                    ? 'bg-pink-900/10 text-pink-400 border-pink-900/40 shadow-[0_0_10px_rgba(219,39,119,0.05)]' 
                    : 'bg-gray-800/50 hover:bg-gray-800 text-gray-300 border-gray-700/50'
                }`}
              >
                <span className="text-blue-400 text-lg">👨</span> <span className="font-bold">ប្រុស (Piseth)</span>
              </button>
              <button 
                onClick={() => setVoice('Sreymom')}
                className={`flex-1 py-3 rounded-xl flex items-center justify-center gap-2 text-sm border transition ${
                  voice === 'Sreymom' 
                    ? 'bg-pink-900/10 text-pink-400 border-pink-900/40 shadow-[0_0_10px_rgba(219,39,119,0.05)]' 
                    : 'bg-gray-800/50 hover:bg-gray-800 text-gray-300 border-gray-700/50'
                }`}
              >
                <span className="text-pink-400 text-lg">👩</span> <span className="font-bold">ស្រី (Sreymom)</span>
              </button>
            </div>
            <div className="text-[11px] text-gray-500 leading-relaxed bg-gray-950/50 p-3 rounded-lg border border-gray-800/50">
              ជ្រើសរើសសំឡេងប្រុសឬស្រីនៅត្រង់នេះ។ អ្នកអាចប្ដូរវាមួយៗមួយៗនៅក្នុងវីដេអូ។
            </div>
          </div>
        </section>

        {/* VOLUME SECTION */}
        <section>
          <div className="bg-gray-900/80 rounded-2xl p-5 border border-gray-800 shadow-sm">
            <div className="flex items-center justify-between mb-5">
               <div className="flex items-center gap-2.5">
                 <div className="p-1.5 bg-pink-900/20 rounded-lg">
                   <Volume2 size={16} className="text-pink-500" />
                 </div>
                 <span className="text-sm font-medium text-gray-200">សំឡេងផ្ទៃខាងក្រោយ</span>
               </div>
               <span className="text-xs font-bold text-gray-400 bg-gray-800 px-2 py-1 rounded">{volume}%</span>
            </div>
            
            <div className="w-full bg-gray-800 h-2 rounded-full relative mb-4 cursor-pointer">
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={volume}
                onChange={(e) => setVolume(parseInt(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
              />
              <div className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-pink-700 to-pink-500 rounded-full" style={{width: `${volume}%`}}></div>
              <div className="absolute top-1/2 -translate-y-1/2 w-5 h-5 bg-white rounded-full shadow-md border-2 border-pink-200 pointer-events-none" style={{left: `${volume}%`}}></div>
            </div>
            
            <div className="text-[11px] text-gray-500 leading-relaxed text-center">
              កម្រិតសំឡេងដើមរបស់វីដេអូ។ ដាក់ឱ្យទាបដើម្បីឱ្យស្តាប់ការបកប្រែបានច្បាស់ល្អ។
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
