"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { listCameras, openCamera, stopStream, type CameraDevice } from "@/engine/camera/camera";
import { useHydratedSettings, useSettings, type PoseModelSetting, type QualitySetting } from "@/engine/settings/store";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="glass mt-6 rounded-3xl p-5 sm:p-6">
      <h2 className="font-display text-xl font-extrabold">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  );
}

function Switch({ label, hint, checked, onChange, id }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; id: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <label htmlFor={id} className="font-semibold">
          {label}
        </label>
        {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      </div>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-8 w-14 shrink-0 rounded-full border border-line transition-colors ${checked ? "bg-brand" : "bg-solid"}`}
      >
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? "left-[1.7rem]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, name }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; name: string }) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.v}
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={`min-h-12 rounded-2xl border px-5 py-2 font-semibold transition-colors ${value === o.v ? "border-brand bg-brand text-brand-fg" : "border-line bg-solid hover:border-brand"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const QUALITY: { v: QualitySetting; label: string }[] = [
  { v: "auto", label: "Avto" },
  { v: "high", label: "Yuqori" },
  { v: "medium", label: "O‘rta" },
  { v: "low", label: "Past" },
];
const POSE: { v: PoseModelSetting; label: string }[] = [
  { v: "auto", label: "Avto" },
  { v: "lite", label: "Tez (yengil)" },
  { v: "full", label: "Aniq (og‘irroq)" },
];

export default function SettingsForm() {
  const ready = useHydratedSettings();
  const s = useSettings();
  const [cams, setCams] = useState<CameraDevice[]>([]);
  const [camMsg, setCamMsg] = useState("");
  const [preview, setPreview] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => {
    // labels are available when the permission was already granted
    void listCameras().then((l) => setCams(l.filter((c) => c.deviceId)));
  }, []);

  useEffect(
    () => () => {
      stopStream(stream.current);
    },
    [],
  );

  async function detect() {
    setCamMsg("Kamera so‘ralmoqda…");
    try {
      const cam = await openCamera();
      stopStream(cam.stream);
      const l = await listCameras();
      setCams(l);
      setCamMsg(l.length ? "" : "Kamera topilmadi.");
    } catch {
      setCamMsg("Kameraga ruxsat berilmadi. Manzil satridagi belgi orqali ruxsat bering va qayta urinib ko‘ring.");
    }
  }

  async function togglePreview() {
    if (preview) {
      stopStream(stream.current);
      stream.current = null;
      setPreview(false);
      return;
    }
    try {
      const cam = await openCamera(s.cameraId || undefined);
      stream.current = cam.stream;
      setPreview(true);
      requestAnimationFrame(() => {
        if (video.current) {
          video.current.srcObject = cam.stream;
          void video.current.play().catch(() => undefined);
        }
      });
    } catch {
      setCamMsg("Kamerani yoqib bo‘lmadi.");
    }
  }

  return (
    <div className={ready ? "" : "opacity-60"} aria-busy={!ready}>
      <Section title="Kamera" hint="Bir nechta kamera bo‘lsa, kerakligini tanlang.">
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Kamera"
            value={s.cameraId}
            onChange={(e) => s.set({ cameraId: e.target.value })}
            className="min-w-0 flex-1 rounded-xl border border-line bg-solid px-3 py-2.5"
          >
            <option value="">Avtomatik (old kamera)</option>
            {cams.map((c) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label}
              </option>
            ))}
          </select>
          <button onClick={() => void detect()} className="rounded-xl border border-line bg-solid px-4 py-2.5 font-semibold hover:border-brand">
            Kameralarni aniqlash
          </button>
          <button onClick={() => void togglePreview()} className="rounded-xl border border-line bg-solid px-4 py-2.5 font-semibold hover:border-brand">
            {preview ? "Sinashni to‘xtatish" : "Kamerani sinash"}
          </button>
        </div>
        {camMsg ? <p className="text-sm text-hot">{camMsg}</p> : null}
        {preview ? <video ref={video} playsInline muted className="aspect-video w-full max-w-md -scale-x-100 rounded-2xl border border-line bg-black object-cover" /> : null}
      </Section>

      <Section title="Ovoz">
        <Switch id="s-sound" label="Ovoz effektlari" checked={s.sound} onChange={(v) => s.set({ sound: v })} />
        <Switch id="s-music" label="Musiqa" checked={s.music} onChange={(v) => s.set({ music: v })} />
      </Section>

      <Section title="Grafika sifati" hint="«Avto» qurilma kuchiga va kadr tezligiga qarab o‘zi sozlanadi.">
        <Segmented name="Grafika sifati" value={s.quality} options={QUALITY} onChange={(v) => s.set({ quality: v })} />
        <div>
          <p className="mb-2 font-semibold">Tana modeli</p>
          <Segmented name="Tana modeli" value={s.poseModel} options={POSE} onChange={(v) => s.set({ poseModel: v })} />
          <p className="mt-2 text-sm text-muted">Kuchli kompyuterda «Aniq» yaxshiroq kuzatadi, kuchsiz qurilmada «Tez» silliqroq ishlaydi.</p>
        </div>
      </Section>

      <Section title="Boshqaruv">
        <Switch id="s-left" label="Chapaqay rejimi" hint="Qo‘llarning vazifasi almashadi." checked={s.leftHanded} onChange={(v) => s.set({ leftHanded: v })} />
        <Switch id="s-kids" label="Bolalar rejimi" hint="O‘yinlar osonroq va sekinroq, bombalarsiz." checked={s.kids} onChange={(v) => s.set({ kids: v })} />
        <Switch id="s-skel" label="Skeletni ko‘rsatish" hint="O‘yin paytida tana chiziqlari ko‘rinadi." checked={s.skeleton} onChange={(v) => s.set({ skeleton: v })} />
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="s-sens" className="font-semibold">
              Sezgirlik
            </label>
            <span className="tabular-nums text-sm text-muted">{s.sensitivity.toFixed(1)}×</span>
          </div>
          <input
            id="s-sens"
            type="range"
            min={0.5}
            max={1.5}
            step={0.1}
            value={s.sensitivity}
            onChange={(e) => s.set({ sensitivity: Number(e.target.value) })}
            className="mt-2 w-full accent-[var(--brand)]"
          />
          <p className="mt-1 text-sm text-muted">Yuqori sezgirlikda yengil harakat ham sanaladi; qo‘li titrayotganlar uchun pastroq qiling.</p>
        </div>
      </Section>

      <div className="mt-6 flex justify-end">
        <button onClick={() => s.reset()} className="rounded-xl border border-line px-4 py-2.5 font-semibold text-muted hover:border-brand hover:text-fg">
          Standart qiymatlarga qaytarish
        </button>
      </div>
    </div>
  );
}
