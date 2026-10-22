import React, { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  onCloneComplete?: (blob: Blob) => void;
}

export const VoiceCloningDialog: React.FC<DialogProps> = ({ open, onClose, onCloneComplete }) => {
  const [recording, setRecording] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const handleToggleRecord = useCallback(async () => {
    setError(null);
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      setEnrolled(true);
      if (chunksRef.current.length > 0 && onCloneComplete) {
        const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        onCloneComplete(blob);
      }
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm',
        });
        mediaRecorderRef.current = mediaRecorder;
        chunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        mediaRecorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
        };

        mediaRecorder.onerror = () => {
          setError('Microphone recording failed.');
          setRecording(false);
          stream.getTracks().forEach((t) => t.stop());
        };

        mediaRecorder.start();
        setRecording(true);
      } catch (err: any) {
        setError(err.message || 'Could not access microphone.');
      }
    }
  }, [recording, onCloneComplete]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      {/* M10 Phase 3: was `sm:max-width-[500px] dir-rtl` — neither class exists
          in Tailwind (max-width isn't a utility, dir-rtl isn't a class at
          all), so this dialog never got its intended 500px cap and relied on
          the ambient page direction instead of its own hardcoded-Urdu
          content. `dir="rtl"` is a real DOM attribute here, matching
          ShamelaImportDialog's own convention for a dialog whose content is
          always Urdu regardless of the app's current language. */}
      <DialogContent className="sm:max-w-[500px]" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right font-bold">
            اخلاقی صوتی کلوننگ (Live Voice Enrollment)
          </DialogTitle>
          <DialogDescription className="text-right text-xs text-muted-foreground">
            FR-6.12 کے تحت: صرف مائیکرو فون سے لائیو ریکارڈنگ اجازت یافتہ ہے۔ آڈیو فائل اپ لوڈ کی اجازت نہیں ہے۔
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 text-right">
          {error && (
            <div className="p-3 border rounded-lg bg-destructive/10 text-destructive text-xs">
              {error}
            </div>
          )}

          <div className="p-3 border rounded-lg bg-warning/10 text-warning text-xs">
            ⚠️ <strong>اہم اخلاقی لیبل:</strong> اس انداز سے تیار کردہ تمام صوتی فائلز پر خودکار طور پر{' '}
            <span className="font-bold underline">"نقل شدہ انداز، اصل آواز نہیں"</span> کا واٹر مارک لیبل شامل ہوگا۔
          </div>

          <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl space-y-3">
            <p className="text-sm font-medium">
              {recording ? 'مائیکرو فون سے ریکارڈنگ جاری ہے...' : enrolled ? 'آواز کا نمونہ محفوظ ہو گیا!' : 'ریکارڈنگ کے لیے بٹن دبائیں'}
            </p>
            <Button
              variant={recording ? 'destructive' : enrolled ? 'outline' : 'default'}
              onClick={handleToggleRecord}
            >
              {recording ? 'ریکارڈنگ روکیں' : enrolled ? 'دوبارہ ریکارڈ کریں' : 'لائیو اینرولمنٹ شروع کریں'}
            </Button>
          </div>

          {enrolled && (
            <div className="flex items-center justify-between text-xs text-muted-foreground p-2 border rounded">
              <span>اخلاقی ٹیگ:</span>
              <Badge variant="outline">نقل شدہ انداز، اصل آواز نہیں</Badge>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row-reverse space-x-2">
          <Button onClick={onClose} variant="secondary">
            بند کریں
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
