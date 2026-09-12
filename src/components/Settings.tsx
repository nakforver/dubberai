import { useState } from 'react';
import { ArrowLeft, Key, Plus, Volume2, ChevronRight } from 'lucide-react';
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
  voice: 'Piseth' | 'Sreymom' | 'VoxCPM2';
  setVoice: (voice: 'Piseth' | 'Sreymom' | 'VoxCPM2') => void;
  volume: number;
  setVolume: (val: number) => void;
}

export default function Settings({ 
  onNavigate, apiKey, setApiKey, awsAccessKeyId, setAwsAccessKeyId, 
  awsSecretAccessKey, setAwsSecretAccessKey, awsRegion, setAwsRegion, 
  awsS3Bucket, setAwsS3Bucket, workflow, setWorkflow, model, setModel, voice, setVoice, volume, setVolume 
}: SettingsProps) {
  
  const [testMessage, setTestMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  return (
    <div className="flex flex-col flex-1 h-screen bg-[#0f0f13]">
      <div className="flex items-center gap-4 p-4 bg-gray-950 border-b border-gray-900 sticky top-0 z-10">
        <button onClick={() => onNavigate('home')} className="text-gray-300 hover:text-white transition p-1 -ml-1">
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-lg font-bold text-gray-100">ការកំណត់</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-24">
        
        {/* API Key Section */}
        <section>
          <h2 className="text-[11px] font-bold text-gray-500 mb-3 uppercase tracking-widest pl-1">API KEY</h2>
          <div className="bg-gray-900/80 rounded-2xl p-4 border border-gray-800 flex items-center justify-between mb-3 shadow-sm">
            <div className="flex items-center gap-3 w-full">
              <div className="p-2 bg-green-900/20 rounded-lg shrink-0">
                <Key size={18} className="text-green-500" />
              </div>
              <input
                type="password"
                className="bg-transparent text-sm font-mono tracking-wider text-gray-200 outline-none w-full"
                placeholder="Enter Gemini API Key (optional)"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* AWS Credentials Section */}
        <section>
          <h2 className="text-[11px] font-bold text-gray-500 mb-3 uppercase tracking-widest pl-1">AWS CREDENTIALS</h2>
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
              {testMessage && (
                <div className={`p-3 rounded-lg text-sm ${testMessage.type === 'success' ? 'bg-green-900/30 text-green-400 border border-green-800' : 'bg-red-900/30 text-red-400 border border-red-800'}`}>
                  {testMessage.text}
                </div>
              )}
              <button
                disabled={isTesting}
                onClick={async () => {
                  setIsTesting(true);
                  setTestMessage(null);
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
                      setTestMessage({ type: 'success', text: data.message });
                    } else {
                      setTestMessage({ type: 'error', text: data.error });
                    }
                  } catch(e) {
                    setTestMessage({ type: 'error', text: 'បរាជ័យ: មិនអាចភ្ជាប់ទៅកាន់ Server បាន' });
                  } finally {
                    setIsTesting(false);
                  }
                }}
                className="px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-2 mt-2"
              >
                {isTesting ? 'កំពុងសាកល្បង...' : 'សាកល្បងភ្ជាប់ AWS (Test Connection)'}
              </button>
            </div>
            
          </div>
        </section>

        {/* Transcription Workflow Section */}
<section>
  <h2 className="text-[11px] font-bold text-gray-500 mb-3 uppercase tracking-widest pl-1">
    ដំណើរការ Transcription
  </h2>

  <div className="relative bg-gray-900/80 rounded-2xl p-4 border border-gray-800 cursor-pointer hover:bg-gray-900 transition shadow-sm">
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
  </div>
</section>

{/* Gemini Model Section */}
<section>
  <h2 className="text-[11px] font-bold text-gray-500 mb-3 uppercase tracking-widest pl-1">
    Gemini Model
  </h2>

  <div className="relative bg-gray-900/80 rounded-2xl p-4 border border-gray-800 cursor-pointer hover:bg-gray-900 transition shadow-sm">
    <select
      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      value={model}
      onChange={(e) => setModel(e.target.value)}
    >
      <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
      <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
      <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
      <option value="gemini-3.7-flash">Gemini 3.7 Flash</option>
    </select>

    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-semibold text-white">
          {model === 'gemini-2.5-flash'
            ? 'Gemini 2.5 Flash'
            : model === 'gemini-3.5-flash'
              ? 'Gemini 3.5 Flash'
              : model === 'gemini-3.6-flash'
                ? 'Gemini 3.6 Flash'
                : 'Gemini 3.7 Flash'}
        </p>
        <p className="text-[11px] text-gray-500 mt-1">
          ជ្រើសរើស Gemini model សម្រាប់ Translation និង Processing
        </p>
      </div>
      <ChevronRight size={18} className="text-gray-500" />
    </div>
  </div>
</section>

{/* Voice Section */}
        <section>
          <h2 className="text-[11px] font-bold text-gray-500 mb-3 uppercase tracking-widest pl-1">សំឡេង</h2>
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
               <div className="text-xs text-pink-400 font-bold bg-pink-900/20 px-3 py-1 rounded-lg border border-pink-900/40">
                 {voice === 'VoxCPM2' ? '🎙️ VoxCPM2 (Voice Clone)' : voice}
               </div>
            </div>
            
            <div className="grid grid-cols-1 gap-2.5">
              <div className="flex gap-2.5">
                <button 
                  onClick={() => setVoice('Piseth')}
                  className={`flex-1 py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm border transition ${
                    voice === 'Piseth' 
                      ? 'bg-pink-900/20 text-pink-400 border-pink-700 shadow-[0_0_10px_rgba(219,39,119,0.15)]' 
                      : 'bg-gray-800/50 hover:bg-gray-800 text-gray-300 border-gray-700/50'
                  }`}
                >
                  <span className="text-blue-400 text-base">👨</span> <span className="font-bold">ប្រុស (Piseth)</span>
                </button>
                <button 
                  onClick={() => setVoice('Sreymom')}
                  className={`flex-1 py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm border transition ${
                    voice === 'Sreymom' 
                      ? 'bg-pink-900/20 text-pink-400 border-pink-700 shadow-[0_0_10px_rgba(219,39,119,0.15)]' 
                      : 'bg-gray-800/50 hover:bg-gray-800 text-gray-300 border-gray-700/50'
                  }`}
                >
                  <span className="text-pink-400 text-base">👩</span> <span className="font-bold">ស្រី (Sreymom)</span>
                </button>
              </div>
              <button 
                onClick={() => setVoice('VoxCPM2')}
                className={`w-full py-3 rounded-xl flex items-center justify-center gap-2 text-sm border transition ${
                  voice === 'VoxCPM2' 
                    ? 'bg-gradient-to-r from-purple-900/30 via-indigo-900/30 to-purple-900/30 text-purple-300 border-purple-600 shadow-[0_0_15px_rgba(168,85,247,0.25)]' 
                    : 'bg-gray-800/50 hover:bg-gray-800 text-gray-300 border-gray-700/50'
                }`}
              >
                <span className="text-purple-400 text-lg">🎙️</span>
                <span className="font-bold">VoxCPM2 (Clone សំឡេងពីវីដេអូដើម)</span>
                <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/30">AI Clone</span>
              </button>
            </div>
            <div className="text-[11px] text-gray-500 leading-relaxed bg-gray-950/50 p-3 rounded-lg border border-gray-800/50">
              {voice === 'VoxCPM2' 
                ? '✨ មុខងារ VoxCPM2 នឹងទាញយកសំឡេងនិយាយផ្ទាល់ពីវីដេអូដើមរបស់អ្នក មកធ្វើ Voice Clone និយាយភាសាខ្មែរតាមទម្រង់សំឡេងដើម!'
                : 'ជ្រើសរើសសំឡេងប្រុស ឬស្រី (Edge-TTS)។ អ្នកក៏អាចជ្រើសរើស VoxCPM2 ដើម្បី Clone សំឡេងពីវីដេអូដើមបានផងដែរ។'}
            </div>
          </div>
        </section>

        {/* Volume Section */}
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
