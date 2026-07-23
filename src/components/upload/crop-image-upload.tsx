"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { ZoomIn, ZoomOut, RotateCcw, RotateCw, RefreshCw, Upload as UploadIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";

export type CropPreset = { label: string; aspect: number; width: number; height: number };
export type CropConfig = { presets: CropPreset[]; format?: "png" | "jpeg"; title?: string };

type State = { offsetX: number; offsetY: number; scale: number; rotation: number };
const START: State = { offsetX: 0, offsetY: 0, scale: 1, rotation: 0 };

// Shared in-page Crop Image workflow used by every image upload (logo, seal, signature, item image,
// client/vendor logo, employee photo). The user picks a file → crops/zooms/rotates in a modal → only
// the final cropped canvas image is uploaded (the original is never sent). Transparent PNG is
// preserved (canvas keeps alpha). The modal never navigates away, so unsaved form data is kept.
export function CropImageUpload({
  locale,
  config,
  onUpload,
  trigger,
}: {
  locale: Locale;
  config: CropConfig;
  onUpload: (file: File) => Promise<{ error?: string } | void>;
  trigger: React.ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<CropPreset>(config.presets[0]);
  const [state, setState] = useState<State>(START);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  // Preview box: fixed width, height from the chosen aspect.
  const BOX_W = 320;
  const boxH = Math.round(BOX_W / preset.aspect);

  const fitScale = useCallback((image: HTMLImageElement) => {
    // Contain with a little padding so seals/signatures are centred, never stretched.
    return Math.min(BOX_W / image.width, boxH / image.height) * 0.92;
  }, [boxH]);

  function pickFile() {
    fileRef.current?.click();
  }
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\/(png|jpeg)$/.test(f.type)) { toast.error(t(locale, "PNG or JPG only.")); return; }
    const image = new Image();
    image.onload = () => {
      setImg(image);
      const p = config.presets[0];
      setPreset(p);
      setState({ ...START, scale: Math.min(BOX_W / image.width, boxH / image.height) * 0.92 });
      setOpen(true);
    };
    image.onerror = () => toast.error(t(locale, "Could not read the image."));
    image.src = URL.createObjectURL(f);
    e.target.value = "";
  }

  // Draw the transform onto a canvas. Box coords scale up to canvas coords by k = cw/BOX_W.
  const draw = useCallback((canvas: HTMLCanvasElement | null, cw: number, ch: number, s: State, image: HTMLImageElement) => {
    if (!canvas) return;
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cw, ch); // transparent background (PNG keeps alpha)
    const k = cw / BOX_W;
    ctx.save();
    ctx.translate(cw / 2 + s.offsetX * k, ch / 2 + s.offsetY * k);
    ctx.rotate((s.rotation * Math.PI) / 180);
    ctx.scale(s.scale * k, s.scale * k);
    ctx.drawImage(image, -image.width / 2, -image.height / 2);
    ctx.restore();
  }, []);

  // Live preview redraw.
  useEffect(() => {
    if (open && img) draw(canvasRef.current, BOX_W, boxH, state, img);
  }, [open, img, state, boxH, draw]);

  function changePreset(p: CropPreset) {
    setPreset(p);
    if (img) setState((s) => ({ ...s, offsetX: 0, offsetY: 0, scale: Math.min(BOX_W / img.width, Math.round(BOX_W / p.aspect) / img.height) * 0.92 }));
  }
  function reset() {
    if (img) setState({ ...START, scale: fitScale(img) });
  }
  const onPointerDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY }; (e.target as Element).setPointerCapture(e.pointerId); };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setState((s) => ({ ...s, offsetX: s.offsetX + dx, offsetY: s.offsetY + dy }));
  };
  const onPointerUp = () => { drag.current = null; };

  async function confirm() {
    if (!img) return;
    setBusy(true);
    try {
      const out = document.createElement("canvas");
      draw(out, preset.width, preset.height, state, img);
      const format = config.format ?? "png";
      const mime = format === "jpeg" ? "image/jpeg" : "image/png";
      const blob: Blob | null = await new Promise((res) => out.toBlob((b) => res(b), mime, 0.92));
      if (!blob) { toast.error(t(locale, "Could not process the image.")); setBusy(false); return; }
      const file = new File([blob], `crop.${format === "jpeg" ? "jpg" : "png"}`, { type: mime });
      const r = await onUpload(file);
      if (r && "error" in r && r.error) { toast.error(r.error); setBusy(false); return; }
      toast.success(t(locale, "Saved"));
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={onFile} />
      <span onClick={pickFile} className="contents">{trigger}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{config.title ? t(locale, config.title) : t(locale, "Crop Image")}</DialogTitle>
          </DialogHeader>
          {config.presets.length > 1 && (
            <div className="flex gap-2">
              {config.presets.map((p) => (
                <button key={p.label} type="button" onClick={() => changePreset(p)}
                  className={`btn ${preset.label === p.label ? "btn-primary" : "btn-glass"} text-[12px]`}>
                  {t(locale, p.label)}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-col items-center gap-3">
            <div
              className="cc-crop-box"
              style={{ width: BOX_W, height: boxH }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <canvas ref={canvasRef} width={BOX_W} height={boxH} className="cc-crop-canvas" />
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" className="btn btn-glass px-2.5" onClick={() => setState((s) => ({ ...s, scale: Math.max(0.02, s.scale * 0.9) }))} title={t(locale, "Zoom out")} aria-label={t(locale, "Zoom out")}><ZoomOut className="size-4" /></button>
              <button type="button" className="btn btn-glass px-2.5" onClick={() => setState((s) => ({ ...s, scale: Math.min(30, s.scale * 1.1) }))} title={t(locale, "Zoom in")} aria-label={t(locale, "Zoom in")}><ZoomIn className="size-4" /></button>
              <button type="button" className="btn btn-glass px-2.5" onClick={() => setState((s) => ({ ...s, rotation: s.rotation - 90 }))} title={t(locale, "Rotate left")} aria-label={t(locale, "Rotate left")}><RotateCcw className="size-4" /></button>
              <button type="button" className="btn btn-glass px-2.5" onClick={() => setState((s) => ({ ...s, rotation: s.rotation + 90 }))} title={t(locale, "Rotate right")} aria-label={t(locale, "Rotate right")}><RotateCw className="size-4" /></button>
              <button type="button" className="btn btn-glass px-2.5" onClick={reset} title={t(locale, "Reset")} aria-label={t(locale, "Reset")}><RefreshCw className="size-4" /></button>
            </div>
            <p className="text-[11px] text-ink-faint">{t(locale, "Drag to reposition. Output")}: {preset.width}×{preset.height}px</p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <button type="button" className="btn btn-glass" disabled={busy}>{t(locale, "Cancel")}</button>
            </DialogClose>
            <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy}>
              <UploadIcon className="size-3.5" /> {busy ? t(locale, "Saving…") : t(locale, "Confirm Crop")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
