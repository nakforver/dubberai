import * as dotenv from 'dotenv';
dotenv.config();
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { TranscribeClient, StartTranscriptionJobCommand, GetTranscriptionJobCommand } from "@aws-sdk/client-transcribe";
import express from 'express';
import * as crypto from 'crypto';
import path from 'path';
import multer from 'multer';
import { EdgeTTS } from 'node-edge-tts';
import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs';
import os from 'os';
import { exec, spawn } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);


function logFfmpegDiagnostic(stepName, command, error, stderr, stdout) {
  const timestamp = new Date().toISOString();
  console.error(`\n[FFMPEG DIAGNOSTIC LOG - ${timestamp}]`);
  console.error(`STEP: ${stepName}`);
  console.error(`COMMAND: ${command}`);
  if (error) {
    console.error(`ERROR OBJECT: ${error.message || error}`);
  }
  if (stderr) {
    console.error(`STDERR:\n${stderr}`);
  }
  if (stdout) {
    console.error(`STDOUT:\n${stdout}`);
  }
  console.error(`[END FFMPEG DIAGNOSTIC]\n`);
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 500 * 1024 * 1024 } });

const defaultGeminiKey = process.env.GEMINI_API_KEY;
const ai = defaultGeminiKey ? new GoogleGenAI({ apiKey: defaultGeminiKey }) : null;

app.post('/api/upload-chunk', express.raw({ type: '*/*', limit: '500mb' }), async (req, res) => {
  try {
    const { fileId, chunkIndex } = req.query;
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ error: 'No chunk body provided' });
    }
    if (!fileId) {
      return res.status(400).json({ error: 'Missing fileId in query' });
    }
    const chunkPath = path.join(os.tmpdir(), `upload_${fileId}_part_${chunkIndex}`);
    fs.writeFileSync(chunkPath, req.body);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const jobs = new Map<string, { status: string, progress: number, lines?: any[], error?: string }>();
const exportJobs = new Map<string, { status: string; error?: string; path?: string; progress?: number; }>();
const exportCache = new Map<string, string>();


// ============================================================
// SHARED GEMINI SUBTITLE TRANSLATOR
// ============================================================
// IMPORTANT:
// - Receives an already-created source SRT
// - Translates ONLY the text field
// - NEVER changes id/start/end
// - NEVER changes subtitle line count
// ============================================================

async function translateSubtitleLinesToKhmer(
  sourceLines: any[],
  geminiModel: string
): Promise<any[]> {
  if (!Array.isArray(sourceLines) || sourceLines.length === 0) {
    throw new Error('No source subtitle lines available for translation.');
  }

  const CHUNK_SIZE = 40;
  const translatedLines: any[] = [];

  console.log(
    `[TRANSLATE] Translating ${sourceLines.length} subtitle lines using ${geminiModel}`
  );

  for (let i = 0; i < sourceLines.length; i += CHUNK_SIZE) {
    const chunk = sourceLines.slice(i, i + CHUNK_SIZE);

    let success = false;
    let retries = 0;
    let lastError: any = null;

    while (!success && retries < 3) {
      try {
        const response =
          await currentAi.models.generateContent({
            model: geminiModel,
            contents: [{
              role: 'user',
              parts: [{
                text:
`You are a professional subtitle translator.

Translate the following subtitle JSON array into Khmer (Cambodian).

STRICT RULES:

1. Translate ONLY the "text" field.
2. NEVER change "id".
3. NEVER change "start".
4. NEVER change "end".
5. Return EXACTLY the same number of subtitle objects.
6. Keep the EXACT same object order.
7. Do NOT merge subtitle lines.
8. Do NOT split subtitle lines.
9. Do NOT omit any subtitle.
10. Do NOT add any subtitle.
11. Preserve the original meaning accurately.
12. Do not summarize.
13. Do not invent information.
14. ALL translated "text" values must be Khmer.
15. Return ONLY valid JSON.
16. The output must contain exactly the same structure.

SOURCE SUBTITLES:
${JSON.stringify(chunk)}`
              }]
            }],
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    start: { type: Type.STRING },
                    end: { type: Type.STRING },
                    text: { type: Type.STRING }
                  },
                  required: [
                    "id",
                    "start",
                    "end",
                    "text"
                  ]
                }
              }
            }
          });

        let responseText = response.text || '';

        responseText = responseText
          .replace(/^\s*```json\s*/, '')
          .replace(/\s*```\s*$/, '')
          .trim();

        const parsed = JSON.parse(responseText);

        if (!Array.isArray(parsed)) {
          throw new Error('Gemini translation response is not an array.');
        }

        if (parsed.length !== chunk.length) {
          throw new Error(
            `Gemini returned ${parsed.length} lines, expected ${chunk.length}.`
          );
        }

        const validated = chunk.map((originalLine: any, index: number) => {
          const translated = parsed[index];

          const text =
            typeof translated?.text === 'string'
              ? translated.text.trim()
              : '';

          if (!text) {
            throw new Error(
              `Empty translation at subtitle index ${index}.`
            );
          }

          return {
            id: String(originalLine.id),
            start: String(originalLine.start),
            end: String(originalLine.end),
            text
          };
        });

        translatedLines.push(...validated);
        success = true;

        console.log(
          `[TRANSLATE] Chunk ${i + 1}-${Math.min(i + CHUNK_SIZE, sourceLines.length)} completed`
        );

      } catch (err: any) {
        lastError = err;

        console.error(
          `[TRANSLATE] Chunk ${i} error:`,
          err?.message || err
        );

        retries++;

        if (retries < 3) {
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }

    if (!success) {
      throw new Error(
        'Translation via Gemini failed after 3 attempts: ' +
        (lastError?.message || lastError)
      );
    }
  }

  if (translatedLines.length !== sourceLines.length) {
    throw new Error(
      `Translation line count mismatch: ${translatedLines.length} / ${sourceLines.length}`
    );
  }

  return translatedLines;
}

app.post('/api/transcribe/start', async (req, res) => {
  const { fileId, mimetype, model, workflow, totalChunks } = req.body;
  const apiKey = req.headers['x-api-key'] as string; // Optional user key from headers
  const reqAwsAccessKeyId = req.headers['x-aws-access-key-id'] as string;
  const reqAwsSecretAccessKey = req.headers['x-aws-secret-access-key'] as string;
  const reqAwsRegion = req.headers['x-aws-region'] as string;
  const reqAwsS3Bucket = req.headers['x-aws-s3-bucket'] as string;
  const jobId = Date.now().toString();
  
  jobs.set(jobId, { status: 'starting', progress: 40 });
  res.json({ jobId });

  // Process in background to avoid HTTP timeouts
  (async () => {
    try {
      const filePath = path.join(os.tmpdir(), `upload_${fileId}`);
      
      // Merge chunks
      if (fs.existsSync(filePath)) {
         fs.unlinkSync(filePath);
      }
      for (let i = 0; i < (totalChunks || 0); i++) {
        const chunkPath = path.join(os.tmpdir(), `upload_${fileId}_part_${i}`);
        if (!fs.existsSync(chunkPath)) {
          throw new Error(`Missing chunk ${i}`);
        }
        const chunkData = fs.readFileSync(chunkPath);
        fs.appendFileSync(filePath, chunkData);
        fs.unlinkSync(chunkPath);
      }
      
      if (!fs.existsSync(filePath)) {
         throw new Error('File not found on server');
      }

      const currentAi = apiKey
          ? new GoogleGenAI({ apiKey })
          : ai;

        if (!currentAi) {
          throw new Error(
            'Gemini API Key មិនត្រូវបានកំណត់។ សូមបញ្ចូល Gemini API Key ក្នុង App Settings។'
          );
        }
      
      let uploadPath = filePath;
      let uploadMime = mimetype;
      
      const isVideo = mimetype.startsWith('video/') || mimetype === 'application/octet-stream' || mimetype === '';
      
      if (isVideo) {
        console.log('Extracting audio from video to speed up upload...');
        jobs.set(jobId, { status: 'extracting audio', progress: 42 });
        const audioPath = path.join(os.tmpdir(), `audio_${fileId}.mp3`);
        await execAsync(`ffmpeg -hide_banner -loglevel error -i "${filePath}" -vn -acodec libmp3lame -q:a 2 "${audioPath}" -y`);
        uploadPath = audioPath;
        uploadMime = 'audio/mpeg';
      }

      const activeWorkflow =
      workflow ||
      (model === 'amazon'
        ? 'amazon'
        : model === 'qwen-khmer'
          ? 'qwen-khmer'
          : 'gemini');

    const activeGeminiModel =
      model &&
      !['amazon'].includes(model)
        ? model
        : 'gemini-2.5-flash';

    const activeModel = activeWorkflow;

if (activeModel === 'amazon') {
         jobs.set(jobId, { status: 'uploading to s3', progress: 45 });
         console.log(`Uploading file to S3... ${uploadPath}`);
         
         const region = reqAwsRegion || process.env.AWS_REGION || 'ap-southeast-2';
         const bucket = reqAwsS3Bucket || process.env.AWS_S3_BUCKET || 'elasticbeanstalk-ap-southeast-2-824353504213';
         
         const awsConfig = {
           region,
           credentials: {
             accessKeyId: reqAwsAccessKeyId || process.env.AWS_ACCESS_KEY_ID || '',
             secretAccessKey: reqAwsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || ''
           }
         };
         
         if (!awsConfig.credentials.accessKeyId) {
             throw new Error("ការកំណត់ AWS Credentials មិនទាន់បានបំពេញ (AWS_ACCESS_KEY_ID នៅក្នុងកូដម៉ាស៊ីន)។");
         }
         
         const s3Client = new S3Client(awsConfig);
         const transcribeClient = new TranscribeClient(awsConfig);
         
         const s3Key = `uploads/${jobId}_audio.mp3`;
         const uploadStream = fs.createReadStream(uploadPath);
         
         await s3Client.send(new PutObjectCommand({
             Bucket: bucket,
             Key: s3Key,
             Body: uploadStream
         }));
         
         jobs.set(jobId, { status: 'transcribing with amazon', progress: 50 });
         
         const transcribeJobName = `TranscribeJob_${jobId}`;
         await transcribeClient.send(new StartTranscriptionJobCommand({
             TranscriptionJobName: transcribeJobName,
             IdentifyLanguage: true,
             MediaFormat: "mp3",
             Media: { MediaFileUri: `s3://${bucket}/${s3Key}` },
         }));
         
         let transcribeStatus = 'IN_PROGRESS';
         let transcriptUri = '';
         let retries = 0;
         while (transcribeStatus === 'IN_PROGRESS' || transcribeStatus === 'QUEUED') {
             await new Promise(r => setTimeout(r, 5000));
             const jobRes = await transcribeClient.send(new GetTranscriptionJobCommand({ TranscriptionJobName: transcribeJobName }));
             transcribeStatus = jobRes.TranscriptionJob?.TranscriptionJobStatus || 'FAILED';
             
             if (transcribeStatus === 'COMPLETED') {
                 transcriptUri = jobRes.TranscriptionJob?.Transcript?.TranscriptFileUri || '';
                 break;
             }
             if (transcribeStatus === 'FAILED') {
                 throw new Error("ការបកប្រែតាមរយៈ Amazon ទទួលបរាជ័យ: " + jobRes.TranscriptionJob?.FailureReason);
             }
             retries++;
             jobs.set(jobId, { status: 'transcribing with amazon', progress: 50 + Math.min(retries * 2, 35) });
         }
         
         jobs.set(jobId, { status: 'processing results', progress: 85 });
         
         const resultRes = await fetch(transcriptUri);
         const resultJson: any = await resultRes.json();
         
         // Parse resultJson to {id, start, end, text}
         const items = resultJson.results?.items || [];
         let originalLines = [];
         let currentLine = null;
         
         let wordCount = 0;
         for (const item of items) {
             if (item.type === 'pronunciation') {
                 if (!currentLine) {
                     currentLine = { id: Math.random().toString(), start: item.start_time, end: item.end_time, text: item.alternatives[0].content };
                     wordCount = 1;
                 } else {
                     const gap = parseFloat(item.start_time) - parseFloat(currentLine.end);
                     const duration = parseFloat(item.end_time) - parseFloat(currentLine.start);
                     const isPunctuationEnding = currentLine.text.match(/[.!?]$/);
                     
                     // Tighter chunking for perfect lip sync:
                     // 1. Pause > 0.5s
                     // 2. Line duration > 3.5s (don't make sentences too long)
                     // 3. Word count >= 10 words
                     // 4. Sentence ended (punctuation) + slight pause
                     if (gap > 0.5 || duration > 3.5 || wordCount >= 10 || (isPunctuationEnding && gap > 0.2)) {
                         originalLines.push(currentLine);
                         currentLine = { id: Math.random().toString(), start: item.start_time, end: item.end_time, text: item.alternatives[0].content };
                         wordCount = 1;
                     } else {
                         currentLine.end = item.end_time;
                         currentLine.text += " " + item.alternatives[0].content;
                         wordCount++;
                     }
                 }
             } else if (item.type === 'punctuation' && currentLine) {
                 currentLine.text += item.alternatives[0].content;
             }
         }
         if (currentLine) originalLines.push(currentLine);
         
         // Helper to convert float seconds to M:SS.S
         const formatTimestamp = (secStr) => {
             const secFloat = parseFloat(secStr);
             const mins = Math.floor(secFloat / 60);
             const secs = secFloat % 60;
             return `${mins}:${secs.toFixed(1).padStart(4, '0')}`;
         };
         
         originalLines = originalLines.map(line => ({
             id: line.id,
             start: formatTimestamp(line.start),
             end: formatTimestamp(line.end),
             text: line.text
         }));
         
         if (originalLines.length === 0) {
             throw new Error("AWS Transcribe មិនអាចស្គាល់សំឡេងបានទេ (No speech detected). អាចដោយសារវីដេអូគ្មានសំឡេង ឬប្រើភាសាដែលប្រព័ន្ធមិនស្គាល់។");
         }

         jobs.set(jobId, { status: 'translating to khmer', progress: 90 });
         console.log(`Translating ${originalLines.length} lines to Khmer...`);
         
         // Translate via Gemini in chunks
         const CHUNK_SIZE = 40;
         let translatedLines = [];
         
         for (let i = 0; i < originalLines.length; i += CHUNK_SIZE) {
             const chunk = originalLines.slice(i, i + CHUNK_SIZE);
             let chunkSuccess = false;
             let generateRetries = 0;
             
             while (!chunkSuccess && generateRetries < 3) {
                 try {
                     const response = await currentAi.models.generateContent({
                         model: activeGeminiModel,
                         contents: [{
                             role: 'user',
                             parts: [
                                 { text: 'You are a professional subtitle translator. Translate the "text" fields in the following JSON array from its original language into Khmer (Cambodian). Keep the exact same JSON structure, keep the "id", "start", and "end" fields exactly the same. Only translate the "text" field. Return ONLY a valid JSON array.\n\n' + JSON.stringify(chunk) }
                             ]
                         }],
                         config: {
                             responseMimeType: 'application/json',
                         }
                     });
                     
                     let responseText = response.text || '';
                     const cleanedResponse = responseText.trim();
                      const parsedChunk = JSON.parse(cleanedResponse);

                      if (!Array.isArray(parsedChunk)) {
                        throw new Error("Gemini translation response is not an array.");
                      }

                      if (parsedChunk.length != chunk.length) {
                        throw new Error(`Gemini returned ${parsedChunk.length} lines, expected ${chunk.length}.`);
                      }

                      const validatedChunk = chunk.map((originalLine, index) => {
                        const translated = parsedChunk[index];
                        const translatedText = typeof translated?.text === "string"
                          ? translated.text.trim()
                          : typeof translated?.Text === "string"
                            ? translated.Text.trim()
                            : "";

                        if (!translatedText) {
                          throw new Error(`Empty translation at index ${index}.`);
                        }

                        return {
                          id: originalLine.id,
                          start: originalLine.start,
                          end: originalLine.end,
                          text: translatedText
                        };
                      });

                     translatedLines.push(...validatedChunk);
                     chunkSuccess = true;
                 } catch (err) {
                     console.error(`Translation chunk ${i} error:`, err.message);
                     generateRetries++;
                     if (generateRetries >= 3) throw new Error("Translation via Gemini failed after 3 attempts.");
                     await new Promise(r => setTimeout(r, 3000));
                 }
             }
             
             const translateProgress = 90 + Math.floor((i / originalLines.length) * 10);
             const percent = Math.floor(Math.min(100, ((i + CHUNK_SIZE) / originalLines.length) * 100));
             jobs.set(jobId, { status: `translating (${percent}%)`, progress: Math.min(99, translateProgress) });
         }
         
         // Cleanup S3
         try {
             await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: s3Key }));
         } catch(e) { console.error('Failed to cleanup S3', e); }
         
         if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
         if (uploadPath !== filePath && fs.existsSync(uploadPath)) fs.unlinkSync(uploadPath);
         
         jobs.set(jobId, { status: 'done', progress: 100, lines: translatedLines });
         return; // Exit here for Amazon
      }
      
      // Upload to Gemini
      console.log(`Uploading file to Gemini... ${uploadPath}`);
      jobs.set(jobId, { status: 'uploading to gemini', progress: 45 });
      
      const fileBuffer = fs.readFileSync(uploadPath);
      const fileBlob = new Blob([fileBuffer]);
      
      const uploadResult = await currentAi.files.upload({ file: fileBlob, config: { mimeType: uploadMime } });
      console.log(`Upload complete. Generating content...`);

      // We may need to poll if it's a large video, but wait for active state
      jobs.set(jobId, { status: 'processing video', progress: 50 });
      let fileState = await currentAi.files.get({ name: uploadResult.name });
      let retries = 0;
      while (fileState.state === 'PROCESSING' && retries < 40) {
        console.log('File is processing, waiting...');
        await new Promise(r => setTimeout(r, 3000));
        fileState = await currentAi.files.get({ name: uploadResult.name });
        retries++;
        jobs.set(jobId, { status: 'processing video', progress: 50 + Math.min(retries * 2, 20) });
      }

      if (fileState.state === 'FAILED') {
        throw new Error('Video processing failed on Gemini side.');
      }

      jobs.set(jobId, { status: 'generating subtitles', progress: 75 });
      let response;
      let generateRetries = 0;
      let generateSuccess = false;
      let lastError;

      while (!generateSuccess && generateRetries < 3) {
        try {
          if (generateRetries > 0) {
            console.log(`Retrying generation (Attempt ${generateRetries + 1})...`);
            jobs.set(jobId, { status: `retrying generation (${generateRetries}/3)`, progress: 75 });
            await new Promise(resolve => setTimeout(resolve, 5000 * generateRetries)); // Exponential-ish backoff
          }
          
          response = await currentAi.models.generateContent({
            model: activeGeminiModel,
            contents: [
              {
                role: 'user',
                parts: [
                  { text: `You are an expert professional subtitle transcriber and translator.

TASK:
Listen to and process the ENTIRE audio/video from beginning to end. Do NOT summarize the content.

TRANSCRIPTION AND SEGMENTATION RULES:
1. Capture EVERY spoken dialogue and do not omit, summarize, or paraphrase any speech.
2. Preserve the actual chronological order of all speech.
3. Create MANY short sequential subtitle segments following natural speech phrases.
4. Prefer approximately 1-6 seconds per subtitle segment when speech allows.
5. Split long sentences into multiple subtitle segments at natural pauses or phrase boundaries.
6. Do NOT combine multiple separate sentences or long dialogue into one subtitle.
7. Do NOT create only a small number of large subtitle blocks.
8. Each subtitle must have accurate start and end timestamps based on the actual audio.
9. Timestamps must cover the complete spoken content throughout the video, not just the beginning.
10. Continue processing until the END of the audio/video.
11. If there are pauses or silence, do not invent dialogue during silence.
12. If multiple people speak, preserve the chronological sequence of their speech.
13. ALL subtitle text must be translated into natural Khmer (Cambodian).
14. Do NOT output the original-language transcript.
15. Do NOT summarize.

IMPORTANT:
The video may be several minutes long. Do NOT reduce the entire video to a small number of subtitle entries simply to save tokens. Produce as many accurate subtitle segments as reasonably possible.

OUTPUT:
Return ONLY a valid JSON array.
Each object MUST use exactly this schema:
{ id: string, start: string, end: string, text: string }

Use timestamp format M:SS.S or MM:SS.S.
IDs must be sequential: 1, 2, 3, 4, ...
Do not output markdown or explanations.
Do not output an empty array unless there is absolutely no speech.` },
                  { fileData: { fileUri: uploadResult.uri, mimeType: uploadMime } }
                ]
              }
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    start: { type: Type.STRING },
                    end: { type: Type.STRING },
                    text: { type: Type.STRING }
                  },
                  required: ["id", "start", "end", "text"]
                }
              }
            }
          });
          generateSuccess = true;
        } catch (e: any) {
          lastError = e;
          console.error(`Generation error (Attempt ${generateRetries + 1}):`, e.message);
          if (e.message?.includes('503') || e.message?.includes('429') || e.message?.includes('UNAVAILABLE') || e.message?.includes('RESOURCE_EXHAUSTED')) {
            generateRetries++;
          } else {
            throw e; // Break loop for non-transient errors
          }
        }
      }

      if (!generateSuccess) {
        throw lastError;
      }

      let responseText = response?.text || '';
      responseText = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      
      let lines;
      try {
        lines = JSON.parse(responseText);
      } catch (err) {
        // Fallback: try to match array and fix truncation
        const jsonMatch = responseText.match(/\[\s*\{[\s\S]*/);
        if (jsonMatch) {
          let fixedStr = jsonMatch[0];
          const lastClose = fixedStr.lastIndexOf('}');
          if (lastClose !== -1) {
             fixedStr = fixedStr.substring(0, lastClose + 1) + ']';
             try {
                lines = JSON.parse(fixedStr);
             } catch (e2) {
                throw new Error('Could not parse JSON from Gemini response: ' + responseText);
             }
          } else {
             throw new Error('Could not parse JSON from Gemini response: ' + responseText);
          }
        } else {
          throw new Error('Could not parse JSON from Gemini response: ' + responseText);
        }
      }

      if (lines.length === 0) {
          throw new Error('ការបកប្រែទទួលបានអក្សរទទេ (0 lines) ពីប្រព័ន្ធ។ សូមសាកល្បងកាត់វីដេអូជាចំណែកខ្លីៗ។ Data: ' + responseText.substring(0, 100));
      }
      
      // Clean up
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (uploadPath !== filePath && fs.existsSync(uploadPath)) fs.unlinkSync(uploadPath);
      try {
        await currentAi.files.delete({ name: uploadResult.name });
      } catch(e) {
        console.error('Failed to delete from Gemini', e);
      }

      jobs.set(jobId, { status: 'done', progress: 100, lines });
    } catch (error: any) {
      console.error('Transcription error:', error);
      let errorMessage = error.message;
      if (errorMessage?.includes('429') || errorMessage?.includes('Quota exceeded') || errorMessage?.includes('RESOURCE_EXHAUSTED')) {
        errorMessage = 'ប្រព័ន្ធ AI របស់ Google កំពុងរវល់ ឬអស់ចំនួនប្រើប្រាស់ឥតគិតថ្លៃ។ សូមរង់ចាំប្រហែល 1 នាទីរួចសាកល្បងម្តងទៀត ឬបញ្ចូល API Key ផ្ទាល់ខ្លួនរបស់អ្នក។ (Rate Limit 429)';
      } else if (errorMessage?.includes('503') || errorMessage?.includes('UNAVAILABLE') || errorMessage?.includes('high demand')) {
        errorMessage = 'ប្រព័ន្ធ AI របស់ Google កំពុងមានអ្នកប្រើប្រាស់ច្រើន (High Demand/503) ធ្វើឱ្យការបកប្រែបរាជ័យ។ សូមរង់ចាំបន្តិចរួចចុចសាកល្បងម្តងទៀត។';
      } else if (errorMessage?.includes('504') || errorMessage?.includes('DEADLINE_EXCEEDED')) {
        errorMessage = 'វីដេអូវែងពេកធ្វើឱ្យការបកប្រែចំណាយពេលយូរហួសកំណត់ (Timeout)។ សូមសាកល្បងជាមួយវីដេអូខ្លីជាងនេះ ឬព្យាយាមម្តងទៀតនៅពេលក្រោយ។';
      }
      jobs.set(jobId, { status: 'error', progress: 0, error: errorMessage });
    }
  })();
});

app.post('/api/test-aws', async (req, res) => {
    try {
        const reqAwsAccessKeyId = typeof req.headers['x-aws-access-key-id'] === 'string' ? req.headers['x-aws-access-key-id'] : '';
        const reqAwsSecretAccessKey = typeof req.headers['x-aws-secret-access-key'] === 'string' ? req.headers['x-aws-secret-access-key'] : '';
        const reqAwsRegion = typeof req.headers['x-aws-region'] === 'string' ? req.headers['x-aws-region'] : 'ap-southeast-2';
        const reqAwsS3Bucket = typeof req.headers['x-aws-s3-bucket'] === 'string' ? req.headers['x-aws-s3-bucket'] : '';

        if (!reqAwsAccessKeyId || !reqAwsSecretAccessKey || !reqAwsS3Bucket) {
            return res.status(400).json({ error: 'សូមបំពេញ AWS Keys និង S3 Bucket ឱ្យបានពេញលេញសិន' });
        }

        const awsConfig = {
            region: reqAwsRegion,
            credentials: {
                accessKeyId: reqAwsAccessKeyId,
                secretAccessKey: reqAwsSecretAccessKey
            }
        };

        const s3Client = new S3Client(awsConfig);
        
        // Try to list objects in the bucket to test credentials and bucket access
        const testCommand = new ListObjectsV2Command({ Bucket: reqAwsS3Bucket, MaxKeys: 1 });
        await s3Client.send(testCommand);

        res.json({ success: true, message: 'AWS Keys និង Bucket របស់អ្នកត្រឹមត្រូវ អាចប្រើបាន!' });
    } catch (e) {
        console.error('AWS Test Error:', e);
        res.status(400).json({ error: 'បញ្ហាភ្ជាប់ទៅ AWS: ' + e.message });
    }
});

app.get('/api/debug/jobs', (req, res) => {
    const allJobs = {};
    for (const [k, v] of jobs.entries()) {
        allJobs[k] = { status: v.status, progress: v.progress, error: v.error, linesCount: v.lines ? v.lines.length : 0 };
    }
    res.json(allJobs);
});

app.get('/api/transcribe/status', (req, res) => {
  const jobId = req.query.jobId as string;
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice } = req.body;
    
    // Fallbacks if not provided
    const targetVoice = voice === 'Sreymom' ? 'km-KH-SreymomNeural' : 'km-KH-PisethNeural';
    
    const tts = new EdgeTTS({ voice: targetVoice, lang: 'km-KH' });
    
    const tempFile = path.join(os.tmpdir(), `tts_${Date.now()}.mp3`);
    await tts.ttsPromise(text, tempFile);
    
    const audioBuffer = fs.readFileSync(tempFile);
    fs.unlinkSync(tempFile);
    
    res.set('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (error: any) {
    console.error('TTS Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/export-video', upload.any(), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[] || [];
    const srtFile = files.find(f => f.fieldname === 'srt');
    
    // Hash inputs for caching
    const metadataStr = req.body.metadata || '';
    const videoFileId = req.body.videoFileId || '';
    const srtContent = srtFile && fs.existsSync(srtFile.path) ? fs.readFileSync(srtFile.path, 'utf8') : '';
    
const hash = crypto.createHash('sha256');
    hash.update(videoFileId);
    hash.update(metadataStr);
    hash.update(srtContent);
    // Include audio file sizes to detect if an audio file was regenerated
    const audioFilesForHash = files.filter(f => f.fieldname.startsWith('audio_'));
    audioFilesForHash.sort((a, b) => a.fieldname.localeCompare(b.fieldname));
    for (const af of audioFilesForHash) {
        if (fs.existsSync(af.path)) {
            hash.update(fs.statSync(af.path).size.toString());
        }
    }
    const exportKey = hash.digest('hex');
    
    if (exportCache.has(exportKey)) {
        const existingJobId = exportCache.get(exportKey);
        const job = exportJobs.get(existingJobId!);
        if (job && (job.status === 'completed' || job.status === 'processing') && job.path && fs.existsSync(job.path)) {
            // Cleanup incoming files since we are using cache
            files.forEach(f => {
              try { fs.unlinkSync(f.path); } catch (e) {}
            });
            // Cleanup incoming chunks
            const videoTotalChunks = parseInt(req.body.videoTotalChunks || '0', 10);
            for (let i = 0; i < videoTotalChunks; i++) {
              const chunkPath = path.join(os.tmpdir(), `upload_${videoFileId}_part_${i}`);
              if (fs.existsSync(chunkPath)) fs.unlinkSync(chunkPath);
            }
            return res.json({ jobId: existingJobId, cached: true });
        }
    }
    let videoPath = '';
    const videoTotalChunks = parseInt(req.body.videoTotalChunks || '0', 10);
    
    if (videoFileId && videoTotalChunks > 0) {
      videoPath = path.join(os.tmpdir(), `upload_${videoFileId}`);
      if (fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
      }
      for (let i = 0; i < videoTotalChunks; i++) {
        const chunkPath = path.join(os.tmpdir(), `upload_${videoFileId}_part_${i}`);
        if (!fs.existsSync(chunkPath)) {
          throw new Error(`Missing chunk ${i} for export`);
        }
        const chunkData = fs.readFileSync(chunkPath);
        fs.appendFileSync(videoPath, chunkData);
        fs.unlinkSync(chunkPath);
      }
    } else {
      const videoFile = files.find(f => f.fieldname === 'video');
      if (videoFile) {
        videoPath = videoFile.path;
      } else {
        throw new Error('Missing video file');
      }
    }
    
    let audioMetadata: any[] = [];
    if (metadataStr) {
      audioMetadata = JSON.parse(metadataStr);
    }
    
    const jobId = Date.now().toString();
    exportCache.set(exportKey, jobId);
    const outputVideoPath = path.join(os.tmpdir(), `output_${jobId}.mp4`);
    
    exportJobs.set(jobId, { status: 'processing' });
    res.json({ jobId });
    
    // Process in background
    (async () => {
      let currentCmd = '';
      try {
        let hasOriginalAudio = false;
        try {
          currentCmd = `ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "${videoPath}"`;
          const { stdout } = await execAsync(currentCmd);
          if (stdout.trim().length > 0) hasOriginalAudio = true;
        } catch(e) {
          logFfmpegDiagnostic('ffprobe (check original audio)', currentCmd, e, e.stderr, e.stdout);
        }
        
                let finalMapA = '';
        const tempMixedAudio = path.join(os.tmpdir(), `mixed_${jobId}.m4a`);
        const audioFiles = files.filter(f => f.fieldname.startsWith('audio_') && fs.statSync(f.path).size > 100);
        
        // STEP 1: Mix audio if needed
        if (audioFiles.length > 0) {
           let mixCmd = `ffmpeg -nostdin -hide_banner -loglevel error`;
           let audioFilter = '';
           let mixInputs = '';
           let inputCount = audioFiles.length;
           
           if (hasOriginalAudio) {
               mixCmd += ` -i "${videoPath}"`;
               audioFilter += `[0:a]volume=0.1[a0]; `;
               mixInputs += `[a0]`;
               inputCount += 1;
           }
           
           for (let i = 0; i < audioFiles.length; i++) {
              mixCmd += ` -i "${audioFiles[i].path}"`;
              const af = audioFiles[i];
              const meta = audioMetadata.find(m => m.key === af.fieldname);
              let delayMs = 0;
              if (meta && meta.start) {
                const parts = meta.start.split(':');
                let totalSeconds = 0;
                if (parts.length === 3) {
                   totalSeconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2].replace(',', '.'));
                } else if (parts.length === 2) {
                   totalSeconds = parseInt(parts[0]) * 60 + parseFloat(parts[1].replace(',', '.'));
                }
                delayMs = Math.round(totalSeconds * 1000);
              }
              const inputIndex = hasOriginalAudio ? i + 1 : i;
              audioFilter += `[${inputIndex}:a]adelay=${delayMs}|${delayMs}[a${inputIndex}]; `;
              mixInputs += `[a${inputIndex}]`;
           }
           
           if (inputCount === 1) { 
               audioFilter += `${mixInputs}volume=1[aout]`; 
           } else { 
               audioFilter += `${mixInputs}amix=inputs=${inputCount}:duration=longest:normalize=0[aout]`; 
           }
           
           mixCmd += ` -filter_complex "${audioFilter}" -map "[aout]" -c:a aac -b:a 192k -y "${tempMixedAudio}"`;
           console.log('Running FFmpeg audio mix:', mixCmd);
           let mixResult;
           try {
               currentCmd = mixCmd;
               mixResult = await execAsync(mixCmd);
               if (mixResult.stderr) logFfmpegDiagnostic('ffmpeg (audio mix warning)', mixCmd, null, mixResult.stderr, mixResult.stdout);
           } catch(e) {
               logFfmpegDiagnostic('ffmpeg (audio mix failure)', mixCmd, e, e.stderr, e.stdout);
               throw new Error('FFmpeg mix error: ' + (e.stderr || e.message).substring(0, 500));
           }
           
           finalMapA = hasOriginalAudio ? '1:a' : '0:a';
        } else if (hasOriginalAudio) {
           finalMapA = '0:a';
        }
        // STEP 2: Export Video WITHOUT burned-in subtitles
let needsVideoReencode = false;
let vFilter = '';
let mapV = '0:v';


        let videoCmd = `ffmpeg -nostdin -hide_banner -loglevel info -i "${videoPath}"`;
        if (audioFiles.length > 0) {
            videoCmd += ` -i "${tempMixedAudio}"`;
        }
        
        if (vFilter) {
        }
        
        videoCmd += ` -map "${mapV}"`;
        if (finalMapA) {
            videoCmd += ` -map "${finalMapA}"`;
        }
        
        if (needsVideoReencode) {
           videoCmd += ` -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p`;
        } else {
           videoCmd += ` -c:v copy`;
        }
        
        if (audioFiles.length > 0 || hasOriginalAudio) {
           videoCmd += ` -c:a aac -b:a 192k`;
        }
        
        videoCmd += ` -y "${outputVideoPath}"`;
        

        console.log('Running FFmpeg video export:', videoCmd);
        const tempOutputVideoPath = path.join(os.tmpdir(), `.final_${jobId}.tmp.mp4`);
        videoCmd = videoCmd.replace(`"${outputVideoPath}"`, `"${tempOutputVideoPath}"`);
        
        // Export progress: 50% -> 90% based on real FFmpeg time.
        // Progress is monotonic and can never move backwards.
        exportJobs.set(jobId, { status: 'processing', progress: 50 });

        let exportDuration = 0;
        try {
            const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
            const { stdout: durationOut } = await execAsync(durationCmd);
            exportDuration = Number(durationOut.trim()) || 0;
        } catch (e) {
            exportDuration = 0;
        }

        let lastExportProgress = 50;

        await new Promise((resolve, reject) => {
            const child = spawn(videoCmd, { shell: true });

            let ffmpegOutputBuffer = '';

            child.stderr.on('data', (data) => {
                ffmpegOutputBuffer += data.toString();

                // Keep a bounded buffer so partial stderr chunks are handled safely.
                if (ffmpegOutputBuffer.length > 20000) {
                    ffmpegOutputBuffer = ffmpegOutputBuffer.slice(-10000);
                }

                // Find the latest FFmpeg time=HH:MM:SS.xx value.
                const matches = [
                    ...ffmpegOutputBuffer.matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)
                ];

                if (matches.length > 0 && exportDuration > 0) {
                    const match = matches[matches.length - 1];

                    const currentTime =
                        Number(match[1]) * 3600 +
                        Number(match[2]) * 60 +
                        Number(match[3]);

                    const ffmpegPercent = Math.min(
                        100,
                        (currentTime / exportDuration) * 100
                    );

                    // Map FFmpeg 0-100% to UI 50-90%.
                    const calculatedProgress = Math.min(
                        90,
                        50 + Math.floor(ffmpegPercent * 0.40)
                    );

                    // Progress must NEVER move backwards.
                    if (calculatedProgress > lastExportProgress) {
                        lastExportProgress = calculatedProgress;

                        exportJobs.set(jobId, {
                            status: 'processing',
                            progress: calculatedProgress
                        });
                    }
                }
            });

            child.on('close', (code) => {
                if (code === 0) {
                    exportJobs.set(jobId, {
                        status: 'processing',
                        progress: 90
                    });
                    resolve(true);
                } else {
                    reject(new Error('FFmpeg exited with code ' + code));
                }
            });

            child.on('error', reject);
        });
        
        // Validate with ffprobe
        currentCmd = `ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1:nokey=1 "${tempOutputVideoPath}"`;
        try {
          const { stdout: probeOut } = await execAsync(currentCmd);
          const [duration, size] = probeOut.trim().split('\n').map(Number);
          
          if (!duration || duration <= 0 || !size || size <= 0) {
              throw new Error('Export validation failed: invalid duration or size');
          }
        } catch (e) {
          logFfmpegDiagnostic('ffprobe (validate output)', currentCmd, e, e.stderr, e.stdout);
          throw e;
        }
        
        fs.renameSync(tempOutputVideoPath, outputVideoPath);
        exportJobs.set(jobId, { status: 'completed', path: outputVideoPath, progress: 100 });

        
      } catch (err: any) {
        logFfmpegDiagnostic('ffmpeg (video export or overall failure)', currentCmd, err, err.stderr, err.stdout);
        exportJobs.set(jobId, { status: 'error', error: `FFMPEG_ERROR: ${err.stderr ? err.stderr.toString().substring(0, 200) : err.message}` });
        
        // Try cleanup
        files.forEach(f => {
          try { fs.unlinkSync(f.path); } catch (e) {}
        });
        if (videoFileId) {
          try { fs.unlinkSync(videoPath); } catch (e) {}
        }
      }
    })();
  } catch (err: any) {
    console.error('Export upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/export/status/:jobId', async (req, res) => {
  const jobId = req.params.jobId;
  let job = exportJobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  
  // Long polling: Keep the request open to prevent Cloud Run from throttling CPU
  // during FFmpeg background processing.
  let retries = 0;
  while (job.status === 'processing' && retries < 15) {
    await new Promise(r => setTimeout(r, 1000));
    job = exportJobs.get(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    retries++;
  }
  
  res.json(job);
});

app.get('/api/export/download/:jobId', (req, res) => {
  const job = exportJobs.get(req.params.jobId);
  if (!job || !job.path || !fs.existsSync(job.path)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send(`
      <script>
        alert("រកមិនឃើញឯកសារវីដេអូទេ។ សូមសាកល្បង Export ម្តងទៀត។ (File not found, server restarted)");
        window.close();
      </script>
    `);
  }
  const filename = (req.query.filename as string) || 'exported_video.mp4';
  res.sendFile(job.path, (err) => {
    // We intentionally don't delete immediately to allow multiple downloads/retries.
  });
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
