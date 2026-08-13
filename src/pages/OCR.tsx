import { useSeo } from "@/hooks/useSeo";
import { Link } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Upload, Camera, Copy, Volume2, Loader2, ImageIcon, X, Crop, SpellCheck, Languages, MessageSquarePlus, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import TokenCostBadge from "@/components/TokenCostBadge";
import AppLayout from "@/components/AppLayout";
import ImageCropper from "@/components/ImageCropper";
import { cn } from "@/lib/utils";
import { isRtlText } from "@/utils/textUtils";
import { getUpgradeLabelKey } from "@/lib/tierUpgrade";
import { ACCEPTED_OCR } from "@/lib/ocr/documentFormats";
import { SaveToLibraryButton } from "@/components/workspace/SaveToLibraryButton";
import { editorRoute } from "@/lib/routes";
import { useOcrWorkflow } from "./ocr/useOcrWorkflow";

const OCR = () => {
  useSeo({ title: "Urdu & Arabic OCR — Islamic Text Digitization", description: "Extract Urdu, Arabic and English text from images and scanned Islamic books with high accuracy. Free Quran-friendly OCR.", path: "/ocr", noindex: true });

  const { t } = useLanguage();

  const {
    imagePreview, isDragOver, isCropping,
    handleFileInput, handleDragOver, handleDragLeave, handleDrop,
    handleCropComplete, clearImage, setIsCropping,
    isPdfMode, pdfFile, pdfPageCount, currentPdfPage, pdfProcessing,
    extractedText, isProcessing, handleExtract,
    isRefining, activeRefineAction, handleRefine,
    autoCopy, toggleAutoCopy, handleCopy, handleListenNow,
    ocrLimitReached, subscription, navigate,
    setExtractedText, pdfAbortRef,
    fileInputRef, cameraInputRef,
  } = useOcrWorkflow();

  const upgradeKey = getUpgradeLabelKey(subscription?.tier);

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
            <div className="flex items-center gap-1.5">
              <TokenCostBadge action="ocr" quantity={1} />
            </div>
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
            {upgradeKey && (
              <Link to="/pricing">
                <Badge variant="destructive" className="cursor-pointer">{t(upgradeKey as import("@/lib/i18n").TranslationKey)}</Badge>
              </Link>
            )}
          </div>
        )}

        {/* PDF Preview Card */}
        {isPdfMode && pdfFile && (
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-muted p-3">
                    <FileText className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-sm truncate max-w-[200px]">{pdfFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("ocr.pdf_loaded").replace("{n}", String(pdfPageCount))}
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="icon"
                  className="h-10 w-10"
                  onClick={clearImage}
                  aria-label={t("ocr.remove_image") || "Remove"}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* PDF processing progress */}
              {pdfProcessing && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">
                      {t("ocr.processing_page")
                        .replace("{current}", String(currentPdfPage))
                        .replace("{total}", String(pdfPageCount))}
                    </span>
                  </div>
                  <Progress value={(currentPdfPage / pdfPageCount) * 100} className="h-2" />
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => pdfAbortRef.current?.abort()}
                      className="gap-1.5"
                    >
                      <X className="h-3.5 w-3.5" />
                      {t("stt.cancel")}
                    </Button>
                  </div>
                </div>
              )}

              {!pdfProcessing && (
                <div className="flex flex-col gap-2">
                  <Button
                    onClick={handleExtract}
                    disabled={isProcessing || ocrLimitReached}
                    className="w-full"
                  >
                    {t("ocr.extract")} ({pdfPageCount} {t("ocr.page_label") || "pages"})
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => navigate("/ocr/review")}
                    className="w-full gap-2"
                  >
                    <FileText className="h-4 w-4" />
                    {t("ocr_review.page_review_btn")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Image Upload / Drag-Drop Area */}
        {!imagePreview && !isPdfMode ? (
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
                accept={ACCEPTED_OCR}
                onChange={handleFileInput}
                className="hidden"
                aria-label={t("ocr.upload")}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileInput}
                className="hidden"
                aria-label={t("ocr.camera")}
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
                  src={imagePreview ?? undefined}
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
              aria-label={t("ocr.result")}
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
            <div className="flex gap-3 flex-wrap">
              <Button onClick={handleCopy} variant="outline" className="flex-1 sm:flex-none">
                <Copy className="h-4 w-4" />
                {t("ocr.copy")}
              </Button>
              <Button onClick={() => navigate(editorRoute(), { state: { content: extractedText, source: "ocr" } })} variant="outline" className="flex-1 sm:flex-none">
                <FileText className="h-4 w-4" />
                {t("editor.open_in_editor")}
              </Button>
              <Button onClick={handleListenNow} className="flex-1 sm:flex-none">
                <Volume2 className="h-4 w-4" />
                {t("ocr.listen_now")}
              </Button>
              {/* SPEC-M4 FR-2.8: the scanned page joins the searchable corpus. */}
              <SaveToLibraryButton
                text={extractedText}
                title={extractedText.slice(0, 60)}
                kind="ocr"
                className="flex-1 sm:flex-none"
              />
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default OCR;
