import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';

interface ConsentProps {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export const OnlineEngineConsentDialog: React.FC<ConsentProps> = ({ open, onAccept, onDecline }) => {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-right font-bold">
            آن لائن صوتی سروس کی اجازت (Microsoft Edge TTS)
          </AlertDialogTitle>
          <AlertDialogDescription className="text-right space-y-2 dir-rtl">
            یہ انجن منتخب کرنے پر آپ کا متن <strong>Microsoft</strong> کی کلاؤڈ سروس کو پروسیسنگ کے لیے بھیجا جائے گا۔
            <br />
            اگر آپ مکمل پرائیویسی اور آف لائن استعمال چاہتے ہیں تو <strong>Piper (مقامی)</strong> انجن استعمال کریں۔
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row-reverse space-x-2">
          <AlertDialogAction onClick={onAccept}>قبول ہے (آن لائن)</AlertDialogAction>
          <AlertDialogCancel onClick={onDecline}>منسوخ (آف لائن رہیں)</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
