import type { TtsEngine, SttEngine, TranscriptSegment } from './types';
import { supabase } from '@/integrations/supabase/client';
import { callEdgeFunction } from '@/core/ai/aiAdapter';

const LANG_TO_DEFAULT_PERSONA: Record<string, string> = {
  'ur-PK': 'hamza',
  'ur': 'hamza',
  'ar': 'omar',
  'ar-SA': 'omar',
  'en': 'fatima',
  'en-US': 'fatima',
};

export class CloudTtsEngine implements TtsEngine {
  id = 'cloud';
  name = 'Cloud Speech Synthesis';
  isOnline = true;
  langs = ['ur-PK', 'ur', 'ar', 'en'];

  async synthesize(text: string, lang: string, voiceId?: string): Promise<ArrayBuffer> {
    const personaId = voiceId || LANG_TO_DEFAULT_PERSONA[lang] || 'fatima';

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('Authentication required for cloud TTS');
    }

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-tts`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ text, personaId }),
      },
    );

    if (!response.ok) {
      throw new Error(`Cloud TTS failed: ${response.status} ${response.statusText}`);
    }

    return response.arrayBuffer();
  }
}

export class CloudSttEngine implements SttEngine {
  id = 'cloud';
  name = 'Cloud Speech Recognition';
  isOnline = true;
  langs = ['ur-PK', 'ur', 'ar', 'en'];
  supportsTimestamps = true;

  async transcribe(audioPath: string, lang: string): Promise<TranscriptSegment[]> {
    const { data, error } = await callEdgeFunction('transcribe', { audioPath, lang });
    if (error) {
      throw new Error(`Cloud STT failed: ${error.message}`);
    }
    return (data as TranscriptSegment[]) || [];
  }
}
