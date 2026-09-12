/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import Home from './components/Home';
import Editor from './components/Editor';
import Settings from './components/Settings';
import { ViewState } from './types';

export default function App() {
  const [currentView, setCurrentView] = useState<ViewState>('home');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_api_key') || '');
  const [awsAccessKeyId, setAwsAccessKeyId] = useState(localStorage.getItem('aws_access_key_id') || '');
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState(localStorage.getItem('aws_secret_access_key') || '');
  const [awsRegion, setAwsRegion] = useState(localStorage.getItem('aws_region') || 'ap-southeast-2');
  const [awsS3Bucket, setAwsS3Bucket] = useState(localStorage.getItem('aws_s3_bucket') || '');
  const [workflow, setWorkflow] = useState(localStorage.getItem('transcribe_workflow') || 'gemini');
  const [model, setModel] = useState(localStorage.getItem('gemini_model') || 'gemini-2.5-flash');
  const [voice, setVoice] = useState<'Piseth' | 'Sreymom' | 'VoxCPM2'>(
    (localStorage.getItem('tts_voice') as 'Piseth' | 'Sreymom' | 'VoxCPM2') || 'Piseth'
  );
  const [volume, setVolume] = useState(90);

  const saveVoice = (v: 'Piseth' | 'Sreymom' | 'VoxCPM2') => {
    setVoice(v);
    localStorage.setItem('tts_voice', v);
  };

  const saveApiKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('gemini_api_key', key);
  };

  const saveAwsAccessKeyId = (key: string) => {
    setAwsAccessKeyId(key);
    localStorage.setItem('aws_access_key_id', key);
  };

  const saveAwsSecretAccessKey = (key: string) => {
    setAwsSecretAccessKey(key);
    localStorage.setItem('aws_secret_access_key', key);
  };
  
  const saveAwsRegion = (val: string) => {
    setAwsRegion(val);
    localStorage.setItem('aws_region', val);
  };
  
  const saveAwsS3Bucket = (val: string) => {
    setAwsS3Bucket(val);
    localStorage.setItem('aws_s3_bucket', val);
  };

  const saveWorkflow = (w: string) => {
    setWorkflow(w);
    localStorage.setItem('transcribe_workflow', w);
  };
  const saveModel = (m: string) => {
    setModel(m);
    localStorage.setItem('gemini_model', m);
  };

  return (
    <div className="h-[100dvh] bg-black flex justify-center selection:bg-pink-500/30">
      <div className="w-full max-w-md bg-[#0a0a0e] h-full relative shadow-2xl overflow-hidden flex flex-col font-sans">
        {currentView === 'home' && (
          <Home
            onNavigate={(view) => setCurrentView(view)}
            videoFile={videoFile}
            setVideoFile={setVideoFile}
          />
        )}
        {currentView === 'editor' && (
          <Editor
            onNavigate={(view) => setCurrentView(view)}
            videoFile={videoFile}
            apiKey={apiKey}
            awsAccessKeyId={awsAccessKeyId}
            awsSecretAccessKey={awsSecretAccessKey}
            awsRegion={awsRegion}
            awsS3Bucket={awsS3Bucket}
            voice={voice}
            workflow={workflow}
            model={model}
          />
        )}
        {currentView === 'settings' && (
          <Settings 
            onNavigate={(view) => setCurrentView(view)}
            apiKey={apiKey}
            setApiKey={saveApiKey}
            awsAccessKeyId={awsAccessKeyId}
            setAwsAccessKeyId={saveAwsAccessKeyId}
            awsSecretAccessKey={awsSecretAccessKey}
            setAwsSecretAccessKey={saveAwsSecretAccessKey}
            awsRegion={awsRegion}
            setAwsRegion={saveAwsRegion}
            awsS3Bucket={awsS3Bucket}
            setAwsS3Bucket={saveAwsS3Bucket}
            workflow={workflow}
            setWorkflow={saveWorkflow}
            model={model}
            setModel={saveModel}
            voice={voice}
            setVoice={saveVoice}
            volume={volume}
            setVolume={setVolume}
          />
        )}
      </div>
    </div>
  );
}

