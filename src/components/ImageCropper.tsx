import { useState, useCallback } from "react";
import Cropper, { Area } from "react-easy-crop";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { RotateCw, Check, X } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface ImageCropperProps {
  imageSrc: string;
  onCropComplete: (croppedDataUrl: string) => void;
  onCancel: () => void;
}

async function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<string> {
  const image = new Image();
  image.src = imageSrc;
  await new Promise((resolve) => (image.onload = resolve));

  const canvas = document.createElement("canvas");
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  const ctx = canvas.getContext("2d")!;

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  );

  return canvas.toDataURL("image/jpeg", 0.9);
}

const ImageCropper = ({ imageSrc, onCropComplete, onCancel }: ImageCropperProps) => {
  const { t } = useLanguage();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const onCropDone = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const handleConfirm = async () => {
    if (!croppedAreaPixels) return;
    // For rotation we re-draw onto a rotated canvas first
    let src = imageSrc;
    if (rotation !== 0) {
      const img = new Image();
      img.src = imageSrc;
      await new Promise((r) => (img.onload = r));
      const canvas = document.createElement("canvas");
      const rad = (rotation * Math.PI) / 180;
      const sin = Math.abs(Math.sin(rad));
      const cos = Math.abs(Math.cos(rad));
      canvas.width = img.width * cos + img.height * sin;
      canvas.height = img.width * sin + img.height * cos;
      const ctx = canvas.getContext("2d")!;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      src = canvas.toDataURL("image/jpeg", 0.9);
    }
    const result = await getCroppedImg(src, croppedAreaPixels);
    onCropComplete(result);
  };

  return (
    <div className="space-y-4">
      <div className="relative h-64 rounded-lg overflow-hidden bg-muted">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={undefined}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropDone}
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground min-w-12">{t("ocr.zoom") || "Zoom"}</span>
        <Slider
          value={[zoom]}
          onValueChange={(v) => setZoom(v[0])}
          min={1}
          max={3}
          step={0.1}
          className="flex-1"
        />
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRotation((r) => (r + 90) % 360)}
        >
          <RotateCw className="h-4 w-4" />
          {t("ocr.rotate") || "Rotate"}
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={onCancel}>
          <X className="h-4 w-4" />
          {t("ocr.cancel") || "Cancel"}
        </Button>
        <Button size="sm" onClick={handleConfirm}>
          <Check className="h-4 w-4" />
          {t("ocr.apply_crop") || "Apply"}
        </Button>
      </div>
    </div>
  );
};

export default ImageCropper;
