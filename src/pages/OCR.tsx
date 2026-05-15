import { useState, useRef, useCallback } from "react";
import { useSeo } from "@/hooks/useSeo";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useLimitReached } from "@/hooks/useLimitReached";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Upload, Camera, Copy, Volume2, Loader2, ImageIcon, X, Crop, ScanLine, SpellCheck, Languages, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import AppLayout from "@/components/AppLayout";
import ImageCropper from "@/components/ImageCropper";
import { cn } from "@/lib/utils";
import { logActivity } from "@/lib/activityLog";
import { usePageSession } from "@/hooks/usePageSession";
import { isRtlText } from "@/utils/textUtils";

const OCR = () => {
  useSeo({ title: "Urdu & Arabic OCR — Islamic Text Digitization", description: "Extract Urdu, Arabic and English text from images and scanned Islamic books with high accuracy. Free Quran-friendly OCR.", path: "/ocr" });

  const { user, session } = useAuth();
  const { t } = useLanguage();
  const { refetch } = useSubscription();
  const navigate = useNavigate();

  const { used: ocrPagesUsed, limit: ocrPagesLimitRaw, reached: ocrLimitReached } = useLimitReached("ocr");
  const ocrPagesLimit = ocrPagesLimitRaw || 5; // legacy default when tier has no explicit limit
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string>("image/jpeg");
  const [extractedText, setExtractedText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [activeRefineAction, setActiveRefineAction] = useState<"spelling_check" | "normalize_script" | null>(null);
  const [isCropping, setIsCropping] = useState(false);
  const [autoCopy, setAutoCopy] = useState(() => localStorage.getItem("ocr-autocopy") === "true");
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleRestoreSession = useCallback((metadata: { extractedText?: string }) => {
    if (typeof metadata.extractedText === "string") setExtractedText(metadata.extractedText);
  }, []);
  const { save: saveSession } = usePageSession<{ extractedText: string }>({
    section: "ocr",
    onRestore: handleRestoreSession,
  });

  const setImageFromDataUrl = useCallback((dataUrl: string, mimeType?: string) => {
    setImagePreview(dataUrl);
    const base64 = dataUrl.split(",")[1];
    setImageBase64(base64);
    if (mimeType) setImageMimeType(mimeType);
    setExtractedText("");
    setIsCropping(false);
  }, []);

  const handleFile = useCallback((file: File) => {
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
      setImageFromDataUrl(dataUrl, file.type);
    };
    reader.readAsDataURL(file);
  }, [t, setImageFromDataUrl]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  // Drag & Drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const clearImage = () => {
    setImagePreview(null);
    setImageBase64(null);
    setExtractedText("");
    setIsCropping(false);
  };

  const handleCropComplete = (croppedDataUrl: string) => {
    setImageFromDataUrl(croppedDataUrl, "image/jpeg");
  };

  const handleExtract = async () => {
    if (!imageBase64 || !session?.access_token) return;
    if (ocrLimitReached) {
      toast.error(t("ocr.limit_reached"));
      return;
    }
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
      const text = data.text || "";
      setExtractedText(text);

      if (!text.trim()) {
        toast.info(t("ocr.no_text_found"));
      } else {
        toast.success(t("ocr.success"));
        logActivity("ocr", text.slice(0, 60));
        saveSession({ title: text.slice(0, 80), metadata: { extractedText: text } });
        if (autoCopy) {
          await navigator.clipboard.writeText(text);
          toast.info(t("ocr.auto_copied"));
        }
      }

      // Increment usage counter and sync context regardless of whether text was found
      if (user) {
        console.log("[OCR] Incrementing ocr_pages_used for user:", user.id);
        const { error } = await supabase
          .from("subscriptions")
          .update({ ocr_pages_used: ocrPagesUsed + 1 })
          .eq("user_id", user.id);
        if (!error) refetch();
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
    navigate("/speak", { state: { text: extractedText } });
  };

  const handleRefine = async (action: "spelling_check" | "normalize_script") => {
    if (!extractedText.trim() || !session?.access_token) return;
    setIsRefining(true);
    setActiveRefineAction(action);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refine-text`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ text: extractedText, action }),
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Unknown error" }));
        toast.error(errData.error || t("ocr.refine_error"));
        return;
      }

      const data = await response.json();
      if (data.text) {
        setExtractedText(data.text);
        saveSession({ title: data.text.slice(0, 80), metadata: { extractedText: data.text } });
        toast.success(t(`ocr.${action}_done`));
      }
    } catch {
      toast.error(t("ocr.refine_error"));
    } finally {
      setIsRefining(false);
      setActiveRefineAction(null);
    }
  };

  const toggleAutoCopy = (checked: boolean) => {
    setAutoCopy(checked);
    localStorage.setItem("ocr-autocopy", String(checked));
  };

  const rtl = isRtlText(extractedText);

  return (
    <AppLayout>
      <div className="p-4 md:p-8 space-y-6 max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">{t("ocr.title")}</h1>
            <p className="text-muted-foreground mt-1">{t("ocr.subtitle")}</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {ocrPagesLimit > 0 && (
              <div className="flex items-center gap-1.5">
                <ScanLine className="h-4 w-4 text-muted-foreground" />
                <Badge variant={ocrLimitReached ? "destructive" : "secondary"} className="text-xs">
                  {ocrPagesUsed} / {ocrPagesLimit} {t("ocr.pages_used")}
                </Badge>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Label htmlFor="auto-copy" className="text-xs text-muted-foreground">
                {t("ocr.auto_copy")}
              </Label>
              <Switch id="auto-copy" checked={autoCopy} onCheckedChange={toggleAutoCopy} />
            </div>
            {(imagePreview || extractedText) && (
              <Button variant="outline" size="sm" onClick={clearImage} className="gap-1.5">
                <MessageSquarePlus className="h-3.5 w-3.5" />
                {t("common.new_chat")}
              </Button>
            )}
          </div>
        </div>

        {ocrLimitReached && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center justify-between">
            <span>{t("ocr.limit_reached")}</span>
            <Link to="/pricing">
              <Badge variant="destructive" className="cursor-pointer">{t("dashboard.upgrade")}</Badge>
            </Link>
          </div>
        )}

        {/* Image Upload / Drag-Drop Area */}
        {!imagePreview ? (
          <Card
            className={cn(
              "border-dashed border-2 transition-colors",
              isDragOver && "border-primary bg-primary/5"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <CardContent className="p-8 flex flex-col items-center gap-4">
              <div className="rounded-full bg-muted p-4">
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                {isDragOver ? (t("ocr.drop_here") || "Drop image here") : t("ocr.upload_hint")}
              </p>
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
        ) : isCropping && imagePreview ? (
          <Card>
            <CardContent className="p-4">
              <ImageCropper
                imageSrc={imagePreview}
                onCropComplete={handleCropComplete}
                onCancel={() => setIsCropping(false)}
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="relative">
                <img
                  src={imagePreview}
                  alt={t("ocr.uploaded_alt") || "Uploaded document for text extraction"}
                  className="w-full max-h-64 object-contain rounded-lg bg-muted"
                />
                <div className="absolute top-2 end-2 flex gap-1.5">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-10 w-10"
                    onClick={() => setIsCropping(true)}
                    aria-label={t("ocr.crop_image") || "Crop image"}
                  >
                    <Crop className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    className="h-10 w-10"
                    onClick={clearImage}
                    aria-label={t("ocr.remove_image") || "Remove image"}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <Button
                onClick={handleExtract}
                disabled={isProcessing || ocrLimitReached}
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
              dir={rtl ? "rtl" : "ltr"}
              className={cn("min-h-[200px] resize-y", rtl && "text-right")}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => handleRefine("spelling_check")}
                variant="outline"
                size="sm"
                disabled={isRefining}
                className="gap-1.5"
              >
                {isRefining && activeRefineAction === "spelling_check" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <SpellCheck className="h-3.5 w-3.5" />
                )}
                {t("ocr.spelling_check")}
              </Button>
              <Button
                onClick={() => handleRefine("normalize_script")}
                variant="outline"
                size="sm"
                disabled={isRefining}
                className="gap-1.5"
              >
                {isRefining && activeRefineAction === "normalize_script" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Languages className="h-3.5 w-3.5" />
                )}
                {t("ocr.normalize_script")}
              </Button>
            </div>
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
