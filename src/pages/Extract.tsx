import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Camera, Copy, FileAudio, FileDown, FilePlus2, FileText, ImageIcon, Loader2, Mic, RotateCcw, Square, Upload,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { useSeo } from "@/hooks/useSeo";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import TokenCostBadge from "@/components/TokenCostBadge";
import { SaveToLibraryButton } from "@/components/workspace/SaveToLibraryButton";
import { STT_LANGUAGES } from "@/pages/transcribe/sttLanguages";
import { toSrt } from "@/lib/subtitles/toSrt";
import { toVtt } from "@/lib/subtitles/toVtt";
import { editorRoute } from "@/lib/routes";
import { isRtlText } from "@/utils/textUtils";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/lib/i18n";
import { useExtract } from "./extract/useExtract";
import { takeSharedFile } from "@/lib/extract/sharedFile";
import { AudioReadAlong } from "@/components/extract/AudioReadAlong";
import { PageCompare } from "@/components/extract/PageCompare";
import { countUncertain } from "@/lib/extract/uncertain";

/**
 * "Extract text" (SYSTEM-2026 §5) — the one screen behind "+ → audio to text"
 * and "+ → image/PDF to text". Drop or pick any file, record, or take a
 * photo; the app works out what it is. The result has "Copy all" on top and
 * becomes a document in one tap, where the `/` skills (spelling, harakat,
 * summary) and the chat take over.
 */

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const Extract = () => {
  useSeo({ title: "Extract text — Easy Editor", description: "Turn recordings, scans and PDFs into editable text.", path: "/extract", noindex: true });
  const { t, direction } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const hint = searchParams.get("kind");
  const x = useExtract();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  // Audio with its recording opens as a read-along, and a scan or PDF beside
  // its page images; "Edit" shows the plain text.
  const [editing, setEditing] = useState(false);
  const canReadAlong = x.phase === "done" && Boolean(x.mediaUrl && x.paragraphs?.length);
  const canCompare = x.phase === "done" && x.kind !== "audio" && Boolean(x.pageImages?.length);
  const readAlong = canReadAlong && !editing;
  const comparing = canCompare && !editing;
  const uncertainCount = x.kind === "audio" ? 0 : countUncertain(x.text);
  const projectId = (location.state as { projectId?: string } | null)?.projectId;

  // A file shared into the app ("Share → Easy Editor") starts right away.
  const shared = searchParams.get("shared") === "1";
  const startRef = useRef(x.start);
  startRef.current = x.start;
  useEffect(() => {
    if (!shared) return;
    void takeSharedFile().then((file) => {
      if (file) void startRef.current(file);
    });
  }, [shared]);

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) {
      setEditing(false);
      void x.start(file);
    }
  };

  const makeDocument = () =>
    navigate(editorRoute(), {
      state: { content: x.text, source: x.kind === "audio" ? "transcribe" : "ocr", projectId },
    });

  const busy = x.phase === "running" || x.phase === "recording";
  const dir = isRtlText(x.text) ? "rtl" : "ltr";
  const baseName = (x.fileName || "text").replace(/\.[^.]+$/, "");

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-8">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="flex-1 text-2xl font-bold text-foreground">{t("extract.title", "متن نکالیں")}</h1>
          {x.phase === "idle" && x.audioAvailable && (x.sttRoute === "local" ? (
            <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs text-success">{t("extract.local_free", "مقامی Whisper — مفت")}</span>
          ) : (
            <TokenCostBadge action={hint === "image" ? "ocr" : "stt"} quantity={1} />
          ))}
        </header>

        {x.phase !== "done" && (
          <>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (!busy) pick(e.dataTransfer.files);
              }}
              className={cn(
                "flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed bg-card p-8 text-center transition-colors",
                dragOver ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              <Upload className="h-8 w-8 text-primary" aria-hidden="true" />
              <p className="font-semibold text-foreground">{t("extract.drop", "فائل یہاں چھوڑیں، یا چنیں")}</p>
              <p className="text-sm text-muted-foreground">
                {[
                  x.audioAvailable && t("extract.kinds_audio", "آڈیو یا ویڈیو"),
                  x.pagesAvailable && t("extract.kinds_pages", "تصویر یا PDF"),
                ].filter(Boolean).join(" · ")}
              </p>
              <input ref={fileRef} type="file" hidden accept={x.accept} onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
              <input ref={cameraRef} type="file" hidden accept="image/*" capture="environment" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
              <div className="grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-3">
                <Button className="gap-2" disabled={busy} onClick={() => fileRef.current?.click()}>
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  {t("extract.pick_file", "فائل چنیں")}
                </Button>
                {x.audioAvailable && (x.phase === "recording" ? (
                  <Button variant="destructive" className="gap-2" onClick={x.stopRecording}>
                    <Square className="h-4 w-4" aria-hidden="true" />
                    {t("extract.stop_recording", "ریکارڈنگ روکیں")}
                  </Button>
                ) : (
                  <Button variant="outline" className="gap-2" disabled={busy} onClick={() => void x.startRecording()}>
                    <Mic className="h-4 w-4" aria-hidden="true" />
                    {t("extract.record", "ریکارڈ کریں")}
                  </Button>
                ))}
                {x.pagesAvailable && (
                  <Button variant="outline" className="gap-2" disabled={busy} onClick={() => cameraRef.current?.click()}>
                    <Camera className="h-4 w-4" aria-hidden="true" />
                    {t("extract.camera", "تصویر کھینچیں")}
                  </Button>
                )}
              </div>
            </div>

            {x.audioAvailable && x.phase === "idle" && (
              <div className="flex flex-wrap items-center gap-3">
                <Label htmlFor="extract-language" className="text-sm">{t("extract.language", "آڈیو کی زبان")}</Label>
                <Select value={x.language} onValueChange={(v) => x.setLanguage(v as typeof x.language)} dir={direction}>
                  <SelectTrigger id="extract-language" className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STT_LANGUAGES.map((l) => (
                      <SelectItem key={l.code} value={l.code}>{t(l.labelKey as TranslationKey)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </>
        )}

        {x.phase === "running" && x.progress && (
          <div role="status" className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{x.fileName}</span>
              <Button variant="ghost" size="sm" onClick={x.cancel}>{t("common.cancel", "منسوخ")}</Button>
            </div>
            <Progress value={x.progress.total ? (x.progress.current / x.progress.total) * 100 : undefined} />
            <p className="text-xs text-muted-foreground">
              {t(x.progress.labelKey)
                .replace("{current}", String(x.progress.current))
                .replace("{total}", String(x.progress.total || "…"))}
            </p>
          </div>
        )}

        {(x.phase === "done" || (x.phase === "running" && x.text)) && (
          <section aria-labelledby="extract-result" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="extract-result" className="flex min-w-0 basis-full items-center gap-2 text-sm font-semibold text-muted-foreground sm:flex-1 sm:basis-0">
                {x.kind === "audio" ? <FileAudio className="h-4 w-4" aria-hidden="true" /> : x.kind === "pdf" ? <FileText className="h-4 w-4" aria-hidden="true" /> : <ImageIcon className="h-4 w-4" aria-hidden="true" />}
                <span className="truncate">{x.fileName || t("extract.result", "نتیجہ")}</span>
              </h2>
              {x.phase === "done" && (
                <>
                  <Button size="lg" className="gap-2" onClick={() => void x.copyAll()} disabled={!x.text.trim()}>
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    {t("extract.copy_all", "سب کاپی کریں")}
                  </Button>
                  <Button size="lg" variant="outline" className="gap-2" onClick={makeDocument} disabled={!x.text.trim()}>
                    <FilePlus2 className="h-4 w-4" aria-hidden="true" />
                    {t("extract.to_document", "دستاویز بنائیں")}
                  </Button>
                </>
              )}
            </div>
            {canReadAlong || canCompare ? (
              <div role="tablist" aria-label={t("extract.view", "منظر")} className="inline-flex rounded-lg bg-muted p-0.5 text-sm">
                {([false, true] as const).map((edit) => (
                  <button
                    key={String(edit)}
                    type="button"
                    role="tab"
                    aria-selected={editing === edit}
                    onClick={() => setEditing(edit)}
                    className={cn("min-h-touch rounded-md px-3", editing === edit ? "bg-background font-semibold shadow-xs" : "text-muted-foreground")}
                  >
                    {edit
                      ? t("extract.view_edit", "ترمیم")
                      : canCompare ? t("extract.view_compare", "تصویر کے ساتھ") : t("extract.view_listen", "سنیں اور پڑھیں")}
                  </button>
                ))}
              </div>
            ) : null}
            {readAlong ? (
              <AudioReadAlong src={x.mediaUrl!} paragraphs={x.paragraphs!} exact={x.timesExact} dir={dir} />
            ) : comparing ? (
              <PageCompare images={x.pageImages!} text={x.text} dir={dir} />
            ) : (
              <>
              {x.phase === "done" && uncertainCount > 0 && (
                <p className="rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-sm text-foreground">
                  {t("extract.uncertain_note", "{n} جگہ OCR کو یقین نہیں تھا، وہاں [?] لگا ہے۔").replace("{n}", String(uncertainCount))}
                  {canCompare && (
                    <>
                      {" "}
                      <button type="button" className="font-semibold text-primary underline-offset-2 hover:underline" onClick={() => setEditing(false)}>
                        {t("extract.uncertain_check", "تصویر سے ملائیں")}
                      </button>
                    </>
                  )}
                </p>
              )}
              <Textarea
                value={x.text}
                onChange={(e) => x.setText(e.target.value)}
                readOnly={x.phase !== "done"}
                dir={dir}
                aria-label={t("extract.result", "نتیجہ")}
                className="min-h-[18rem] text-base leading-loose"
              />
              </>
            )}
            {x.phase === "done" && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2">
                  <Switch id="extract-autocopy" checked={x.autoCopy} onCheckedChange={x.setAutoCopy} />
                  <Label htmlFor="extract-autocopy" className="text-sm">{t("extract.auto_copy", "مکمل ہوتے ہی خود کاپی ہو")}</Label>
                </div>
                <div className="flex-1" />
                {x.segments && x.segments.length > 0 && (
                  <>
                    <Button variant="ghost" size="sm" className="gap-1" onClick={() => download(`${baseName}.srt`, toSrt(x.segments!), "application/x-subrip")}>
                      <FileDown className="h-4 w-4" aria-hidden="true" /> SRT
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1" onClick={() => download(`${baseName}.vtt`, toVtt(x.segments!), "text/vtt")}>
                      <FileDown className="h-4 w-4" aria-hidden="true" /> VTT
                    </Button>
                  </>
                )}
                {x.kind === "pdf" && (
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/ocr/review">{t("extract.review_pages", "صفحہ وار جائزہ")}</Link>
                  </Button>
                )}
                {x.text.trim() && <SaveToLibraryButton text={x.text} title={baseName} kind={x.kind === "audio" ? "audio" : "ocr"} />}
                <Button variant="ghost" size="sm" className="gap-1" onClick={x.startOver}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  {t("extract.new", "نیا")}
                </Button>
              </div>
            )}
          </section>
        )}
      </div>
    </AppLayout>
  );
};

export default Extract;
