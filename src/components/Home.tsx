import { Moon, Settings, Film, FileText, ArrowRight, Mic, CheckCircle2 } from 'lucide-react';
import { useRef } from 'react';
import { ViewState } from '../types';

interface HomeProps {
  onNavigate: (view: ViewState) => void;
  videoFile: File | null;
  setVideoFile: (file: File) => void;
}

export default function Home({ onNavigate, videoFile, setVideoFile }: HomeProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setVideoFile(e.target.files[0]);
    }
  };

  return (
    <div className="flex flex-col flex-1 p-5">
      <div className="flex justify-end gap-4 mb-8">
        <button className="p-2 bg-gray-800 rounded-full text-gray-300">
          <Moon size={20} />
        </button>
        <button onClick={() => onNavigate('settings')} className="p-2 bg-gray-800 rounded-full text-gray-300 hover:text-white transition">
          <Settings size={20} />
        </button>
      </div>

      <div className="flex flex-col items-center mb-10 relative">
        {/* Glow effect */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-pink-600/20 blur-3xl rounded-full pointer-events-none"></div>
        <div className="relative z-10 w-24 h-24 bg-gradient-to-br from-indigo-900 to-pink-900 rounded-3xl flex items-center justify-center border border-pink-500/30 mb-6 shadow-lg shadow-pink-900/20">
           <Mic size={40} className="text-pink-400" />
        </div>
        <h1 className="text-2xl font-bold mb-3 tracking-wide">បកប្រែវីដេអូ</h1>
        <p className="text-center text-gray-400 text-sm max-w-[280px] leading-relaxed">
          ជាកម្មវិធីសម្រាប់បកប្រែវីដេអូ ដោយប្រើប្រាស់ AI របស់ Google GEMINI។
        </p>
      </div>

      <div className="space-y-4 mb-8 relative z-10">
        <input 
          type="file" 
          accept="video/*" 
          className="hidden" 
          ref={fileInputRef} 
          onChange={handleVideoSelect} 
        />
        <div 
          className={`p-4 rounded-2xl border ${videoFile ? 'border-green-500/50 bg-green-900/10' : 'border-gray-800 bg-gray-900'} flex items-start gap-4 cursor-pointer hover:bg-gray-800 transition shadow-sm`}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="mt-1">
            {videoFile ? (
              <CheckCircle2 size={24} className="text-green-500" />
            ) : (
              <Film size={24} className="text-gray-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-center mb-1">
              <h3 className="font-semibold text-sm text-gray-200">ជំហាន 1 : <span className="font-bold text-white">វីដេអូ</span></h3>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed truncate">
              {videoFile ? videoFile.name : 'ជ្រើសរើសវីដេអូដែលអ្នកចង់បកប្រែ'}
            </p>
          </div>
          <div className="text-gray-600 self-center">
            <ArrowRight size={20} />
          </div>
        </div>

        <div className="p-4 rounded-2xl border border-gray-800 bg-gray-900 flex items-start gap-4 opacity-70">
          <div className="mt-1">
            <FileText size={24} className="text-gray-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center mb-1 flex-wrap gap-2">
              <h3 className="font-semibold text-sm text-gray-200">ជំហាន 2 : <span className="font-bold text-white">ចំណងជើង</span></h3>
              <span className="text-[10px] bg-gray-800 text-gray-300 px-2 py-0.5 rounded font-medium">មិនបាច់មាន</span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">
              បញ្ចូល .srt / .vtt ឬបំលែង ហើយចុច Transcribe ក្នុងកម្មវិធីតែម្តង
            </p>
          </div>
          <div className="text-gray-600 self-center">
            <ArrowRight size={20} />
          </div>
        </div>
      </div>

      <button 
        onClick={() => onNavigate('editor')}
        disabled={!videoFile}
        className={`mt-auto mb-6 flex items-center justify-center gap-2 w-full py-4 rounded-xl font-bold text-sm transition-all duration-300 ${
          videoFile 
            ? 'bg-gradient-to-r from-pink-700 to-red-600 text-white shadow-[0_0_20px_rgba(219,39,119,0.4)] hover:scale-[1.02]' 
            : 'bg-gray-800 text-gray-500 cursor-not-allowed'
        }`}
      >
        ចូលទៅកាន់ការបកប្រែ
        <ArrowRight size={18} />
      </button>
    </div>
  );
}
