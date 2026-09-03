import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Music, LayoutGrid, MoreVertical, Play, Pause, Mic, FileAudio, Download, CheckSquare, Square, Volume2, CheckCircle2, Loader2 } from 'lucide-react';
import { ViewState, SubtitleLine } from '../types';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

interface EditorProps {
  onNavigate: (view: ViewState) => void;
  videoFile: File | null;
  apiKey: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsRegion: string;
  awsS3Bucket: string;
  workflow: string;
  voice: 'Piseth' | 'Sreymom';
  model: string;
}

export default function Editor({ onNavigate, videoFile, apiKey, awsAccessKeyId, awsSecretAccessKey, awsRegion, awsS3Bucket, workflow, voice, model }: EditorProps) {
  const [lines, setLines] = useState<SubtitleLine[]>([]);

  const linesRef = useRef<SubtitleLine[]>([]);

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeStatus, setTranscribeStatus] = useState<string>('');
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  
  // Keep track of currently generating audios
  const [generatingLines, setGeneratingLines] = useState<Set<string>>(new Set());
  const [ttsBatchProgress, setTtsBatchProgress] = useState({ current: 0, total: 0, active: false });
  
  
  // Unified MAGIC PROCESS progress: one continuous 0–100% cycle
  const magicProgress = (() => {
    if (isTranscribing) {
      return Math.round(transcribeProgress * 0.33);
    }

    if (ttsBatchProgress.active) {
      const ttsProgress =
        (ttsBatchProgress.current / Math.max(ttsBatchProgress.total, 1)) * 100;
      return Math.round(33 + ttsProgress * 0.34);
    }

    if (isExporting) {
      return Math.round(67 + exportProgress * 0.33);
    }

    return downloadUrl ? 100 : 0;
  })();

const videoRef = useRef<HTMLVideoElement>(null);
  const audioRefs = useRef<{ [id: string]: HTMLAudioElement }>({});

  const [videoUrl, setVideoUrl] = useState<string>('');

  useEffect(() => {
    if (videoFile) {
      const url = URL.createObjectURL(videoFile);
      setVideoUrl(url);

      return () => URL.revokeObjectURL(url);
    }
  }, [videoFile]);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTranscribe = async () => {
    if (lines.length > 0 || !videoFile) return;
    setIsTranscribing(true);
    setTranscribeError(null);
    setDownloadUrl(null);
    setTranscribeProgress(0);
    setTranscribeStatus('កំពុងរៀបចំវីដេអូ...');
    
    let progressInterval: NodeJS.Timeout | undefined;

    try {
      const fileId = Date.now().toString();
      const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
      const totalChunks = Math.ceil(videoFile.size / CHUNK_SIZE);
      
      setTranscribeStatus('កំពុងបញ្ជូនវីដេអូទៅម៉ាស៊ីនមេ...');
      
      for (let i = 0; i < totalChunks; i++) {
        const chunk = videoFile.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        
        let chunkRes;
        let retries = 0;
        while (retries < 20) {
          try {
            chunkRes = await fetch(`/api/upload-chunk?fileId=${fileId}&chunkIndex=${i}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk });
            if (chunkRes.ok) break;
          } catch (e) {
            console.warn(`Chunk ${i} upload failed (attempt ${retries + 1}), retrying...`);
          }
          retries++;
          if (retries === 20) throw new Error('បរាជ័យក្នុងការបញ្ជូនវីដេអូ ដោយសារអ៊ីនធឺណិតខ្សោយ (Network Error - Failed to fetch)');
          await new Promise(r => setTimeout(r, 2000 * retries)); // Exponential-ish backoff
        }
        
        if (!chunkRes || !chunkRes.ok) {
          throw new Error('បរាជ័យក្នុងការបញ្ជូនវីដេអូទៅកាន់ម៉ាស៊ីនមេ');
        }
        
        setTranscribeProgress(Math.round(((i + 1) / totalChunks) * 40));
        
        // Small delay to prevent rate-limiting from the reverse proxy
        await new Promise(r => setTimeout(r, 50));
      }

      setTranscribeStatus('កំពុងចាប់ផ្តើមបកប្រែ...');
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }
      if (awsAccessKeyId) {
        headers['x-aws-access-key-id'] = awsAccessKeyId;
      }
      if (awsSecretAccessKey) {
        headers['x-aws-secret-access-key'] = awsSecretAccessKey;
      }
      if (awsRegion) {
        headers['x-aws-region'] = awsRegion;
      }
      if (awsS3Bucket) {
        headers['x-aws-s3-bucket'] = awsS3Bucket;
      }

      const startRes = await fetch('/api/transcribe/start', {
        method: 'POST',
        headers,
        body: JSON.stringify({ 
           fileId, 
           mimetype: videoFile.type || 'video/mp4', 
           model,
           workflow,
           totalChunks
        }),
      });

      if (!startRes.ok) {
        let errorMsg = await startRes.text();
        try {
          const parsed = JSON.parse(errorMsg);
          if (parsed.error) errorMsg = parsed.error;
        } catch(e) {}
        throw new Error(errorMsg);
      }

      const { jobId } = await startRes.json();
      
      // Poll for status
      let isDone = false;
      let statusRetries = 0;
      while (!isDone) {
        await new Promise(r => setTimeout(r, 2000));
        let statusRes;
        try {
          statusRes = await fetch(`/api/transcribe/status?jobId=${jobId}`);
          statusRetries = 0; // reset on success
        } catch (e) {
          console.error('Status check failed, retrying...', e);
          statusRetries++;
          if (statusRetries >= 5) {
            throw new Error('ដាច់ការភ្ជាប់ជាមួយម៉ាស៊ីនមេ (Connection Lost - Failed to fetch)');
          }
          continue;
        }

        if (!statusRes.ok) {
           if (statusRes.status === 404) throw new Error('ម៉ាស៊ីនមេមានបញ្ហា (Job not found) សូមព្យាយាមម្តងទៀត');
           throw new Error('បរាជ័យក្នុងការត្រួតពិនិត្យដំណើរការ (Failed to fetch status)');
        }
        
        const job = await statusRes.json();
        
        if (job.status === 'error') {
           throw new Error(job.error || 'មានបញ្ហាក្នុងការបកប្រែ');
        }
        
        if (job.status === 'done') {
          const newLines = job.lines.map((l: any, idx: number) => ({
            ...l,
            id: l.id || `line-${Date.now()}-${idx}`,
            selected: true,
            generated: false,
            audioUrl: null
          }));
          setLines(newLines);
          // Keep ref synchronized immediately for MAGIC PROCESS.
          linesRef.current = newLines;
          setTranscribeProgress(100);
          setTranscribeStatus('រួចរាល់!');
          // Server will handle 0 lines check
          isDone = true;
        } else {
          setTranscribeProgress(job.progress || 50);
          if (job.status === 'extracting audio') setTranscribeStatus('កំពុងទាញសំឡេងចេញពីវីដេអូដើម្បីផ្ញើទៅ AI...');
          else if (job.status === 'uploading to gemini') setTranscribeStatus('កំពុងបញ្ចូលវីដេអូទៅ AI...');
          else if (job.status === 'processing video') setTranscribeStatus('AI កំពុងវិភាគវីដេអូ...');
          else if (job.status === 'generating subtitles') setTranscribeStatus('កំពុងទាញយកអត្ថបទបកប្រែ...');
        }
      }
    } catch (err: any) {
      console.error(err);
      setTranscribeError(err.message);
    } finally {
      // no interval
      setTimeout(() => {
        setIsTranscribing(false);
      }, 800);
    }
  };

  const toggleSelectAll = () => {
    const allSelected = lines.length > 0 && lines.every(l => l.selected);
    setLines(lines.map(l => ({ ...l, selected: !allSelected })));
  };

  const toggleSelect = (id: string) => {
    setLines(lines.map(l => l.id === id ? { ...l, selected: !l.selected } : l));
  };

  const generateAudioForLine = async (lineId: string, text: string): Promise<boolean> => {
    try {
      setGeneratingLines(prev => {
        const next = new Set(prev);
        next.add(lineId);
        return next;
      });

      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice })
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(errorText || `TTS Failed (${res.status})`);
      }

      const blob = await res.blob();

      if (!blob || blob.size === 0) {
        throw new Error('TTS returned empty audio');
      }

      const url = URL.createObjectURL(blob);

      // Update ref immediately so the next operation sees the latest audio.
      const updated = linesRef.current.map(l =>
        l.id === lineId
          ? { ...l, generated: true, audioUrl: url }
          : l
      );

      linesRef.current = updated;
      setLines(updated);

      return true;
    } catch (err) {
      console.error(`TTS failed for line ${lineId}:`, err);
      return false;
    } finally {
      setGeneratingLines(prev => {
        const next = new Set(prev);
        next.delete(lineId);
        return next;
      });
    }
  };

  const handleGenerateAI = async () => {
    const selectedLines = lines.filter(l => l.selected && !l.generated);
    if (selectedLines.length === 0) return;
    
    setTtsBatchProgress({ current: 0, total: selectedLines.length, active: true });
    let completed = 0;
    
    for (const line of selectedLines) {
      await generateAudioForLine(line.id, line.text);
      completed++;
      setTtsBatchProgress(prev => ({ ...prev, current: completed }));
    }
    
    setTimeout(() => {
      setTtsBatchProgress({ current: 0, total: 0, active: false });
    }, 1000);
  };

  const playAudio = (url: string) => {
    const audio = new Audio(url);
    audio.play();
  };

  // ✨ MAGIC PROCESS
  // One click: Transcribe/Translate → Edge TTS → Export Video
  const handleMagicProcess = async () => {
    if (!videoFile || isTranscribing || isExporting || ttsBatchProgress.active) {
      return;
    }

    try {
      // STEP 1 — Transcribe + Translate using the existing
      // Gemini API key from the App Settings slot.
      if (linesRef.current.length === 0) {
        await handleTranscribe();
      }

      // handleTranscribe now updates linesRef.current immediately,
      // so do not wait up to 60 seconds for React state.
      const currentLines = linesRef.current;

      if (currentLines.length === 0) {
        throw new Error('មិនមាន Subtitle Lines បន្ទាប់ពី Transcribe');
      }

      console.log(
        `✨ TRANSCRIBE READY: ${currentLines.length} subtitle lines`
      );

      // STEP 2 — Generate Edge TTS for every subtitle line
      const linesToGenerate = currentLines.filter(line => !line.audioUrl);

      if (linesToGenerate.length > 0) {
        setTtsBatchProgress({
          current: 0,
          total: linesToGenerate.length,
          active: true
        });

        let completed = 0;

        for (const line of linesToGenerate) {
            const success = await generateAudioForLine(line.id, line.text);
            if (!success) {
              throw new Error(`Edge TTS បរាជ័យសម្រាប់ subtitle: ${line.id}`);
            }
            completed++;
            setTtsBatchProgress({
              current: completed,
              total: linesToGenerate.length,
              active: completed < linesToGenerate.length
            });
          }
      }

      setTtsBatchProgress({
        current: linesToGenerate.length,
        total: linesToGenerate.length,
        active: false
      });

      // STEP 3 — Verify the ref has the latest TTS audio.
      // generateAudioForLine() already updates linesRef.current.
      const finalLines = linesRef.current;

      const missingAudio = finalLines.filter(line => !line.audioUrl);

      if (missingAudio.length > 0) {
        throw new Error(
          `Edge TTS មិនទាន់រួចរាល់ ${missingAudio.length}/${finalLines.length} lines`
        );
      }

      console.log(
        `✨ MAGIC READY: ${finalLines.length} subtitles + ` +
        `${finalLines.filter(line => line.audioUrl).length} Khmer audio files`
      );

      // STEP 4 — Export using the latest ref state.
      await handleExport();

    } catch (err: any) {
      console.error("MAGIC PROCESS ERROR:", err);

      setTtsBatchProgress({
        current: 0,
        total: 0,
        active: false
      });

      setTranscribeError(
        err?.message || 'MAGIC PROCESS បរាជ័យ'
      );
    }
  };

  const handleExport = async () => {
    // Always export the latest subtitle/TTS state.
    // React state may still be one render behind after Magic TTS.
    const exportLines = linesRef.current;

    if (exportLines.length === 0) {
      throw new Error('មិនមាន Subtitle Lines សម្រាប់ Export');
    }

    setIsExporting(true);
    setExportProgress(0);
    
    // We will poll progress from server
    
    try {
      const toSrtTime = (timeStr: string) => {
        const parts = timeStr.split(':');
        if (parts.length < 2) return "00:00:00,000";
        let h = "00", m = "00", s = "00", ms = "000";
        
        if (parts.length === 3) {
          h = parts[0].padStart(2, '0');
          m = parts[1].padStart(2, '0');
          const secParts = parts[2].split('.');
          s = secParts[0].padStart(2, '0');
          ms = (secParts[1] ? secParts[1].substring(0,3).padEnd(3, '0') : "000");
        } else {
          m = parts[0].padStart(2, '0');
          const secParts = parts[1].split('.');
          s = secParts[0].padStart(2, '0');
          ms = (secParts[1] ? secParts[1].substring(0,3).padEnd(3, '0') : "000");
        }
        return `${h}:${m}:${s},${ms}`;
      };

      const srtContent = exportLines.map((line, index) => {
        return `${index + 1}\n${toSrtTime(line.start)} --> ${toSrtTime(line.end)}\n${line.text}\n`;
      }).join('\n');

      const baseName = videoFile?.name.replace(/\.[^/.]+$/, "") || 'video';

      let videoFileId = '';
      let videoTotalChunks = 0;
      
      if (videoFile) {
         videoFileId = 'export_' + Date.now().toString();
         const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
         videoTotalChunks = Math.ceil(videoFile.size / CHUNK_SIZE);
         
         for (let i = 0; i < videoTotalChunks; i++) {
           const chunk = videoFile.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
           let retries = 0;
           let chunkRes;
           while (retries < 10) {
             try {
               chunkRes = await fetch(`/api/upload-chunk?fileId=${videoFileId}&chunkIndex=${i}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk });
               if (chunkRes.ok) break;
             } catch (e) {}
             retries++;
             await new Promise(r => setTimeout(r, 1000));
           }
           if (!chunkRes || !chunkRes.ok) throw new Error('បរាជ័យក្នុងការបញ្ជូនវីដេអូទៅកាន់ម៉ាស៊ីនមេសម្រាប់ការនាំចេញ');
           setExportProgress(Math.round(((i + 1) / videoTotalChunks) * 50)); // Upload takes up to 50%
           await new Promise(r => setTimeout(r, 50)); // small delay to prevent rate limit
         }
      }

      const formData = new FormData();
      if (videoFileId) {
        formData.append('videoFileId', videoFileId);
        formData.append('videoTotalChunks', videoTotalChunks.toString());
      }
      formData.append('srt', new Blob([srtContent], { type: 'text/srt' }), 'subtitles.srt');
      
      const audioMetadata = [];
      const audioLines = exportLines.filter(l => l.audioUrl);
      
      for (let i = 0; i < audioLines.length; i++) {
        const line = audioLines[i];
        const audioData = await fetch(line.audioUrl as string).then(r => r.blob());
        const key = `audio_${i}`;
        formData.append(key, audioData, `${key}.mp3`);
        audioMetadata.push({ key, start: line.start });
      }
      
      formData.append('metadata', JSON.stringify(audioMetadata));
      
      const res = await fetch('/api/export-video', {
         method: 'POST',
         body: formData
      });
      
      if (!res.ok) {
         let errMsg = 'បរាជ័យក្នុងការបំប្លែងវីដេអូ';
         try {
            const errData = await res.json();
            if (errData.error) errMsg = errData.error;
         } catch(e) {}
         throw new Error(errMsg);
      }
      
      const { jobId } = await res.json();
      
      let pollFailCount = 0;
      // Poll for status
      while (true) {
        await new Promise(r => setTimeout(r, 1000));
        let statusRes;
        try {
          statusRes = await fetch(`/api/export/status/${jobId}`);
        } catch (e) {
          pollFailCount++;
          if (pollFailCount > 5) throw new Error('ដាច់ការភ្ជាប់ជាមួយម៉ាស៊ីនមេ (Network Error)');
          continue;
        }

        if (!statusRes.ok) {
          if (statusRes.status === 404) {
             throw new Error('ដំណើរការត្រូវកាត់ផ្តាច់ (Server Restarted)។ សូមសាកល្បង Export ម្តងទៀត ហើយកុំបិទអេក្រង់ ឬប្តូរកម្មវិធីពេលកំពុងដំណើរការ។');
          }
          pollFailCount++;
          if (pollFailCount > 5) throw new Error('បរាជ័យក្នុងការត្រួតពិនិត្យដំណើរការ (Server Error)');
          continue;
        }
        pollFailCount = 0; // reset
        const statusData = await statusRes.json();
        
        if (typeof statusData.progress === 'number') {

        
          // Export progress must NEVER move backwards.

        
          setExportProgress(prev =>

        
            Math.max(prev, Math.min(100, statusData.progress))

        
          );

        
        }
        
        if (statusData.status === 'completed') {
           setExportProgress(100);

           // Exported video replaces the original video in the main preview
           const version = Date.now();
           const exportedUrl = `/api/export/download/${jobId}?filename=${encodeURIComponent(baseName + '_khmer.mp4')}&v=${version}`;

           setVideoUrl(exportedUrl);
           setDownloadUrl(exportedUrl);
           setIsPlaying(false);

           break;
        } else if (statusData.status === 'error') {
           throw new Error(statusData.error || 'បរាជ័យក្នុងការបំប្លែងវីដេអូ');
        }
      }
      
    } catch (err: any) {
      console.error(err);
      setTranscribeError(err.message || "មានបញ្ហាក្នុងការនាំចេញឯកសារ (Export Failed)");
    } finally {
      // clearInterval(progressInterval);
      setTimeout(() => setIsExporting(false), 500);
    }
  };

  const selectedCount = lines.filter(l => l.selected).length;
  const generatedCount = lines.filter(l => l.generated).length;
  const totalCount = lines.length;

  return (
    <div className="flex flex-col h-full bg-[#0f0f13]">
      {/* Top Header */}
      <div className="flex items-center justify-between p-4 bg-gray-950/80 backdrop-blur-md z-10">
        <button onClick={() => onNavigate('home')} className="p-2 -ml-2 text-gray-300 hover:text-white transition">
          <ArrowLeft size={24} />
        </button>
        <div className="truncate flex-1 text-center font-medium text-sm text-gray-200 px-4">
          {videoFile?.name || '[2010년 사극 레전드] 동이 Dong Yi.mp4'}
        </div>
        <div className="flex items-center gap-4 text-gray-400">
          <Music size={20} className="hover:text-white cursor-pointer" />
          <LayoutGrid size={20} className="hover:text-white cursor-pointer" />
          <MoreVertical size={20} className="hover:text-white cursor-pointer" />
        </div>
      </div>

      {/* Video Player Area */}
      <div className="relative w-full aspect-video bg-black flex items-center justify-center group shrink-0">
        {videoFile && videoUrl ? (
          <video 
            ref={videoRef}
            src={videoUrl} 
            className="w-full h-full object-contain"
                                  controls
                                  playsInline
                                  onEnded={() => setIsPlaying(false)}
            />
        ) : (
          <div className="text-gray-600 text-sm">No video selected</div>
        )}
      </div>

      {/* Subtitle List Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-900 border-y border-gray-800 text-xs text-gray-400 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={toggleSelectAll} className="text-gray-400 hover:text-gray-300 transition">
            {totalCount > 0 && selectedCount === totalCount ? <CheckSquare size={16} className="text-pink-500" /> : <Square size={16} />}
          </button>
          <span>{selectedCount} selected</span>
        </div>
        <div className="flex items-center gap-5">
          <span className="flex items-center gap-1.5">
            <span className="text-[10px] border border-gray-600 rounded px-1 text-gray-400 font-medium tracking-wider">A</span> 
            {totalCount}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-[10px] border border-green-700/50 text-green-500 bg-green-900/20 rounded px-1 font-medium tracking-wider">AI</span> 
            {generatedCount}
          </span>
        </div>
        <div className="text-[10px] bg-gray-800 px-2 py-1 rounded">Auto-Fit Medium</div>
      </div>

      {/* Subtitle Lines Area */}
      <div className="flex-1 overflow-y-auto p-4 relative bg-[#0f0f13]">
        {lines.length === 0 && !isTranscribing && (
          <div className="h-full flex flex-col items-center justify-center text-center px-8 animate-in fade-in duration-500">
            <div className="w-20 h-20 bg-gray-900/50 rounded-3xl flex items-center justify-center border border-gray-800 mb-5">
              <FileAudio size={32} className="text-gray-500" />
            </div>
            <h3 className="text-lg font-bold mb-3 text-gray-200">No lines yet</h3>
            <p className="text-sm text-gray-500 leading-relaxed max-w-[250px]">
              Transcribe the video to build them automatically, or import a .srt / .vtt you already have.
            </p>
          </div>
        )}

        {(isTranscribing || ttsBatchProgress.active || isExporting) && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#08060f]/95 backdrop-blur-md animate-in fade-in">
            <div className="relative w-[340px] max-w-[92vw] overflow-hidden rounded-[20px] border border-white/[0.06] bg-[radial-gradient(ellipse_at_top,#1a1330,#08060f_70%)] px-6 py-8">

              {/* Ambient glow */}
              <div className="absolute -left-16 -top-16 h-[220px] w-[220px] rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.35),transparent_70%)] blur-[10px] animate-pulse" />
              <div className="absolute -bottom-16 -right-10 h-[200px] w-[200px] rounded-full bg-[radial-gradient(circle,rgba(236,72,153,0.30),transparent_70%)] blur-[10px] animate-pulse" />

              <div className="relative text-center">

                {/* Progress circle */}
                <div className="relative mx-auto mb-5 h-40 w-40">

                  <div className="absolute inset-2 rounded-full border border-white/[0.06] bg-purple-500/[0.08] backdrop-blur-md" />

                  <svg
                    className="absolute inset-0 h-full w-full -rotate-90"
                    viewBox="0 0 160 160"
                  >
                    <circle
                      cx="80"
                      cy="80"
                      r="66"
                      fill="none"
                      stroke="rgba(255,255,255,0.06)"
                      strokeWidth="7"
                    />

                    <circle
                      cx="80"
                      cy="80"
                      r="66"
                      fill="none"
                      stroke="url(#magic-progress-gradient)"
                      strokeWidth="7"
                      strokeLinecap="round"
                      strokeDasharray="414.7"
                      strokeDashoffset={
                        414.7 - (magicProgress / 100) * 414.7
                      }
                      style={{
                        filter:
                          "drop-shadow(0 0 6px rgba(168,85,247,0.7))",
                        transition:
                          "stroke-dashoffset 350ms ease-out",
                      }}
                    />

                    <defs>
                      <linearGradient
                        id="magic-progress-gradient"
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="100%"
                      >
                        <stop offset="0%" stopColor="#c084fc" />
                        <stop offset="50%" stopColor="#8b5cf6" />
                        <stop offset="100%" stopColor="#f472b6" />
                      </linearGradient>
                    </defs>
                  </svg>

                  {/* Two touching animated gears */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center">

                    <div className="relative mb-1 h-12 w-[76px]">

                      <span
                        className="absolute left-0 top-[-5px] inline-block select-none text-[40px] leading-none"
                        style={{
                          color: "transparent",
                          background:
                            "linear-gradient(135deg,#c4b5fd,#8b5cf6)",
                          WebkitBackgroundClip: "text",
                          backgroundClip: "text",
                          filter:
                            "drop-shadow(0 0 6px rgba(139,92,246,0.6))",
                          animation:
                            "magicGearCW 2.2s linear infinite",
                          transformOrigin: "center",
                        }}
                      >
                        ⚙
                      </span>

                      <span
                        className="absolute left-[44px] top-[6px] inline-block select-none text-[24px] leading-none"
                        style={{
                          color: "transparent",
                          background:
                            "linear-gradient(135deg,#f9a8d4,#ec4899)",
                          WebkitBackgroundClip: "text",
                          backgroundClip: "text",
                          filter:
                            "drop-shadow(0 0 5px rgba(236,72,153,0.6))",
                          animation:
                            "magicGearCCW 1.5s linear infinite",
                          transformOrigin: "center",
                        }}
                      >
                        ⚙
                      </span>

                    </div>

                    {/* Percentage */}
                    <p className="mt-2 text-[32px] font-medium tracking-[-0.5px] text-white">
                      {magicProgress}
                      <span className="text-base text-[#c9c3e8]">%</span>
                    </p>

                  </div>
                </div>



              </div>

              <style>{`
                @keyframes turtleWalkLR {
                    0% {
                      transform: translateX(0) translateY(2px) scaleX(1);
                    }
                    25% {
                      transform: translateX(45px) translateY(-3px) scaleX(1);
                    }
                    50% {
                      transform: translateX(90px) translateY(2px) scaleX(1);
                    }
                    75% {
                      transform: translateX(135px) translateY(-3px) scaleX(1);
                    }
                    100% {
                      transform: translateX(0) translateY(2px) scaleX(1);
                    }
                  }

                  @keyframes magicButtonTurtle {
                    0% {
                      left: 0;
                      transform: translateY(2px);
                    }
                    25% {
                      left: 25%;
                      transform: translateY(-2px);
                    }
                    50% {
                      left: calc(100% - 30px);
                      transform: translateY(2px);
                    }
                    75% {
                      left: 25%;
                      transform: translateY(-2px);
                    }
                    100% {
                      left: 0;
                      transform: translateY(2px);
                    }
                  }

                  @keyframes magicGearCW {
                  from { transform: rotate(0deg); }
                  to { transform: rotate(360deg); }
                }

                @keyframes magicGearCCW {
                  from { transform: rotate(360deg); }
                  to { transform: rotate(0deg); }
                }

                @keyframes magicGradient {
                  0% { background-position: 0% 50%; }
                  50% { background-position: 100% 50%; }
                  100% { background-position: 0% 50%; }
                }

                @keyframes magicPulse {
                  0%,100% {
                    box-shadow:
                      0 8px 30px rgba(168,85,247,0.4),
                      inset 0 1px 0 rgba(255,255,255,0.2);
                  }
                  50% {
                    box-shadow:
                      0 8px 46px rgba(236,72,153,0.8),
                      inset 0 1px 0 rgba(255,255,255,0.3);
                  }
                }
              `}</style>

            </div>
          </div>
        )}

        {downloadUrl && !isExporting && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in rounded-2xl overflow-y-auto p-6">
             <div className="flex flex-col items-center justify-center w-full min-h-min my-auto">
             <div className="w-24 h-24 rounded-full bg-green-900/30 flex items-center justify-center mb-6 border border-green-500/30">
                <CheckCircle2 size={40} className="text-green-500" />
             </div>
             
             
             
             <div className="flex flex-col sm:flex-row gap-4">
                <button 
                  onClick={async () => {
                    try {
                      // Attempt to use Web Share API to save directly to Gallery
                      const res = await fetch(downloadUrl);
                      if (!res.ok) {
                         alert("រកមិនឃើញវីដេអូទេ (Server អាចនឹង Restart)។ សូម Export ម្តងទៀត។");
                         return;
                      }
                      const blob = await res.blob();
                      const file = new File([blob], 'exported_video_khmer.mp4', { type: 'video/mp4' });
                      
                      if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        await navigator.share({
                          files: [file],
                          title: 'Exported Video'
                        });
                      } else {
                        // Fallback to normal download
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = 'exported_video_khmer.mp4';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                      }
                    } catch (e) {
                      console.error("Share failed", e);
                      // Fallback to normal download
                      const a = document.createElement('a');
                      a.href = downloadUrl;
                      a.download = 'exported_video_khmer.mp4';
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }
                  }}
                  className="px-8 py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl font-medium transition flex items-center gap-2"
                >
                   <Download size={20} />
                </button>
                <button onClick={() => setDownloadUrl(null)} className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-medium transition">
                   
                </button>
             </div>
             </div>
          </div>
        )}
        {isExporting && (
          <div className="absolute inset-0 bg-[#0f0f13]/95 z-20 flex flex-col items-center justify-center p-8 animate-in fade-in overflow-hidden">
             <div className="w-32 h-32 relative mb-6">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" stroke="#1f2937" strokeWidth="8" fill="none" />
                  <circle 
                    cx="50" cy="50" r="42" 
                    stroke="url(#export-gradient)" 
                    strokeWidth="8" 
                    fill="none" 
                    strokeLinecap="round"
                    className="transition-all duration-300 ease-out"
                    style={{
                      strokeDasharray: 263.89,
                      strokeDashoffset: 263.89 - (exportProgress / 100) * 263.89,
                    }}
                  />
                  <defs>
                    <linearGradient id="export-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#16a34a" />
                      <stop offset="100%" stopColor="#22c55e" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-white tracking-tighter">
                    {Math.round(exportProgress)}<span className="text-base text-gray-400 ml-0.5">%</span>
                  </span>
                </div>
             </div>
             <div className="text-sm font-medium text-green-500 mb-6">កំពុងនាំចេញវីដេអូ...</div>
          </div>
        )}

        <div className="space-y-3 pb-4">
          {lines.map((line, idx) => (
            <div key={line.id} className={`flex gap-3 bg-gray-900/80 rounded-xl p-3.5 border transition duration-200 ${line.selected ? 'border-pink-900/50 shadow-[0_0_10px_rgba(219,39,119,0.05)]' : 'border-gray-800'} items-start animate-in slide-in-from-bottom-2`} style={{ animationDelay: `${idx * 100}ms`, animationFillMode: 'both' }}>
              <button onClick={() => toggleSelect(line.id)} className="mt-0.5 shrink-0 transition">
                {line.selected ? <CheckSquare size={18} className="text-pink-500" /> : <Square size={18} className="text-gray-500" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center text-[11px] text-gray-500 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded-sm font-medium">{idx + 1}</span>
                    <span className="font-mono tracking-tighter">{line.start} - {line.end}</span>
                  </div>
                  <div className="flex items-center gap-2">
                     <div className="w-5 h-5 rounded bg-gray-800/80 flex items-center justify-center text-blue-400">
                       <span className="text-[10px]">{voice === 'Piseth' ? '♂' : '♀'}</span>
                     </div>
                  </div>
                </div>
                <textarea 
                  className="w-full bg-transparent text-sm font-medium text-gray-200 leading-relaxed outline-none resize-none border-b border-transparent focus:border-pink-500 transition-colors h-14"
                  value={line.text}
                  onChange={(e) => setLines(lines.map(l => l.id === line.id ? { ...l, text: e.target.value, generated: false } : l))}
                />
                
                {generatingLines.has(line.id) && (
                  <div className="text-[10px] text-indigo-400 flex items-center gap-1.5 mt-2.5 font-medium">
                    <Loader2 size={12} className="animate-spin" /> កំពុងបង្កើត...
                  </div>
                )}
                
                {line.generated && !generatingLines.has(line.id) && (
                  <div className="text-[10px] text-green-500 flex items-center gap-1.5 mt-2.5 font-medium bg-green-900/10 inline-flex px-2 py-0.5 rounded-full border border-green-900/30">
                    <CheckCircle2 size={12} /> បានបង្កើតសំឡេង
                  </div>
                )}
              </div>
              <button 
                onClick={() => line.audioUrl && playAudio(line.audioUrl)}
                disabled={!line.audioUrl}
                className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center self-center transition ${line.audioUrl ? 'bg-gray-800 hover:bg-pink-900/30 text-gray-400 hover:text-pink-500 cursor-pointer' : 'bg-gray-900 text-gray-700 cursor-not-allowed'}`}
              >
                <Play size={14} className="ml-0.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="bg-gray-950/90 backdrop-blur-md p-4 border-t border-gray-900 shrink-0 pb-6 z-20">
  <button
    onClick={handleMagicProcess}
    disabled={!videoFile || isTranscribing || isExporting || ttsBatchProgress.active}
    className={`w-full flex items-center justify-center gap-3 py-4 px-5 rounded-2xl border transition-all ${
      videoFile && !isTranscribing && !isExporting && !ttsBatchProgress.active
        ? 'bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 text-white border-purple-400/30 hover:scale-[1.01] shadow-[0_0_25px_rgba(139,92,246,0.25)]'
        : 'bg-gray-900/50 text-gray-600 border-gray-800 cursor-not-allowed'
    }`}
  >
    {isTranscribing || isExporting || ttsBatchProgress.active ? (
  <div className="relative flex items-center w-full h-12 overflow-hidden">
      <span
        className="absolute left-0 text-[30px] select-none"
        style={{
          animation: "magicButtonTurtle 7s ease-in-out infinite",
          filter: "drop-shadow(0 0 5px rgba(34,197,94,0.55))",
        }}
      >
        🐢
      </span>
    </div>
) : (
  <span className="text-2xl">✨</span>
)}
  </button>
</div>
    </div>
  );
}
