import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Upload, Camera, Copy, Volume2, Loader2, ImageIcon, X } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { cn } from "@/lib/utils";

const OCR = () => {
  const { session } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string>("image/jpeg");
  const [extractedText, setExtractedText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(t("ocr.invalid_file"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("ocr.file_too_large"));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setImagePreview(dataUrl);
      // Extract base64 from data URL
      const base64 = dataUrl.split(",")[1];
      setImageBase64(base64);
      setImageMimeType(file.type);
      setExtractedText("");
    };
    reader.readAsDataURL(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const clearImage = () => {
    setImagePreview(null);
    setImageBase64(null);
    setExtractedText("");
  };

  const handleExtract = async () => {
    if (!imageBase64 || !session?.access_token) return;
    setIsProcessing(true);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-ocr`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            imageBase64,
            mimeType: imageMimeType,
          }),
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Unknown error" }));
        if (response.status === 429) {
          toast.error(t("ocr.limit_reached"));
        } else {
          toast.error(errData.error || t("ocr.error"));
        }
        return;
      }

      const data = await response.json();
      setExtractedText(data.text || "");

      if (!data.text?.trim()) {
        toast.info(t("ocr.no_text_found"));
      } else {
        toast.success(t("ocr.success"));
      }
    } catch {
      toast.error(t("ocr.error"));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(extractedText);
      toast.success(t("ocr.copied"));
    } catch {
      toast.error(t("ocr.copy_failed"));
    }
  };

  const handleListenNow = () => {
    // Navigate to /speak with the extracted text as state
    navigate("/speak", { state: { text: extractedText } });
  };

  // Detect if extracted text is primarily RTL
  const isRtlText = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(
    extractedText.slice(0, 100)
  );

  return (
    <AppLayout>
      <div className="p-4 md:p-8 space-y-6 max-w-4xl mx-auto">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">{t("ocr.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("ocr.subtitle")}</p>
        </div>

        {/* Image Upload Area */}
        {!imagePreview ? (
          <Card className="border-dashed border-2">
            <CardContent className="p-8 flex flex-col items-center gap-4">
              <div className="rounded-full bg-muted p-4">
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground text-center">{t("ocr.upload_hint")}</p>
              <div className="flex gap-3">
                <Button onClick={() => fileInputRef.current?.click()} variant="outline">
                  <Upload className="h-4 w-4" />
                  {t("ocr.upload")}
                </Button>
                <Button onClick={() => cameraInputRef.current?.click()} variant="outline">
                  <Camera className="h-4 w-4" />
                  {t("ocr.camera")}
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileInput}
                className="hidden"
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileInput}
                className="hidden"
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="relative">
                <img
                  src={imagePreview}
                  alt="Uploaded"
                  className="w-full max-h-64 object-contain rounded-lg bg-muted"
                />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 end-2 h-8 w-8"
                  onClick={clearImage}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <Button
                onClick={handleExtract}
                disabled={isProcessing}
                className="w-full"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("ocr.processing")}
                  </>
                ) : (
                  t("ocr.extract")
                )}
              </Button>
              {isProcessing && <Progress className="h-2" />}
            </CardContent>
          </Card>
        )}

        {/* Extracted Text */}
        {extractedText && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">{t("ocr.result")}</h2>
            <Textarea
              value={extractedText}
              onChange={(e) => setExtractedText(e.target.value)}
              dir={isRtlText ? "rtl" : "ltr"}
              className={cn("min-h-[200px] resize-y", isRtlText && "text-right")}
            />
            <div className="flex gap-3">
              <Button onClick={handleCopy} variant="outline" className="flex-1 sm:flex-none">
                <Copy className="h-4 w-4" />
                {t("ocr.copy")}
              </Button>
              <Button onClick={handleListenNow} className="flex-1 sm:flex-none">
                <Volume2 className="h-4 w-4" />
                {t("ocr.listen_now")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default OCR;
