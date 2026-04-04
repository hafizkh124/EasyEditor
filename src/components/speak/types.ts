export interface Persona {
  id: string;
  name: string;
  nameUr: string;
  gender: "male" | "female";
  lang: string;
  voiceLang: string;
  geminiVoice: string;
}

export type VoiceMode = "standard" | "cloned";
