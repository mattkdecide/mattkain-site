"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Check, ChevronLeft, ChevronRight, Cloud, Heart, ImagePlus, KeyRound, LoaderCircle, Sparkles, Trash2, X } from "lucide-react";

import { appPath } from "@/lib/paths";

type Dad = { id: string; title: string; relationship: string; colour: string; note: string };
type Photo = { key: string; dad: string; caption: string; url: string };
type Candidate = { id: string; filename: string; caption: string; capturedAt: string | null; width: number | null; height: number | null; url: string; similarShot: boolean; suggestedBest: boolean };
type GoogleStatus = { connected: boolean; configured: boolean };

const dads: Dad[] = [
  { id: "father-in-law", title: "John", relationship: "A father and grandfather", colour: "#1f5962", note: "The stories, laughs, and small moments that stay with us." },
  { id: "dad", title: "Ron", relationship: "A father and grandfather", colour: "#b55236", note: "A life seen through the people who know and love him best." },
  { id: "me", title: "Matt", relationship: "A dad", colour: "#85633b", note: "The ordinary days that became the memories worth keeping." },
  { id: "brother-in-law", title: "Ed", relationship: "A dad", colour: "#5d6351", note: "The love between a dad, his children, and the family around him." },
  { id: "cam", title: "Cam", relationship: "A dad", colour: "#7c4d5f", note: "Family life, captured in the moments everyone remembers differently." },
  { id: "mark", title: "Mark", relationship: "A dad", colour: "#496879", note: "The moments shared with family that deserve to be kept together." },
  { id: "tim", title: "Tim", relationship: "A dad", colour: "#6b7048", note: "A family story told through the people, places, and days around him." },
];

export default function Home() {
  const [active, setActive] = useState(dads[0]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [importing, setImporting] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [showGoogleSetup, setShowGoogleSetup] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [savingGoogleSetup, setSavingGoogleSetup] = useState(false);
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeId = useRef(dads[0].id);
  const generation = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [candidateCursor, setCandidateCursor] = useState<string | null>(null);
  const [retrySession, setRetrySession] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const storageKey = (dadId: string) => `fathers-picker:${dadId}`;
  const saveSession = (dadId: string, id: string | null) => {
    try { if (id) sessionStorage.setItem(storageKey(dadId), id); else sessionStorage.removeItem(storageKey(dadId)); } catch { /* retry remains available in this tab */ }
  };
  const savedSession = (dadId: string) => {
    try { return sessionStorage.getItem(storageKey(dadId)); } catch { return null; }
  };

  function selectDad(dad: Dad) {
    generation.current++;
    if (pollTimer.current) clearTimeout(pollTimer.current);
    activeId.current = dad.id;
    setActive(dad);
    setPhotos([]); setCandidates([]); setCandidateCursor(null);
    setImporting(false); setNotice(""); setLightbox(null);
    setRetrySession(savedSession(dad.id));
  }

  async function loadPhotos(dadId = active.id) {
    const version = generation.current;
    setLoading(true);
    try {
      let next: { source: string; cursor: string } | null = { source: "imports", cursor: "" };
      const all = new Map<string, Photo>();
      while (next) {
        const params = new URLSearchParams({ dad: dadId, ...next });
        const response = await fetch(appPath(`/api/photos?${params}`));
        const data = await response.json() as { photos?: Photo[]; next?: { source: string; cursor: string } | null; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Photos could not be loaded.");
        if (activeId.current !== dadId || generation.current !== version) return;
        for (const photo of data.photos ?? []) all.set(photo.key, photo);
        setPhotos([...all.values()]);
        next = data.next ?? null;
      }
    } catch (error) {
      if (activeId.current === dadId && generation.current === version) setNotice(error instanceof Error ? error.message : "Photos could not be loaded.");
    } finally { if (activeId.current === dadId && generation.current === version) setLoading(false); }
  }

  async function loadCandidates(dadId = active.id, cursor: string | null = null) {
    const version = generation.current;
    const params = new URLSearchParams({ dad: dadId });
    if (cursor) params.set("cursor", cursor);
    try {
      const response = await fetch(appPath(`/api/candidates?${params}`));
      if (response.status === 401) return;
      const data = await response.json() as { candidates?: Candidate[]; nextCursor?: string | null; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Review queue could not be loaded.");
      if (activeId.current !== dadId || generation.current !== version) return;
      setCandidates((current) => cursor
        ? [...new Map([...current, ...(data.candidates ?? [])].map((item) => [item.id, item])).values()]
        : data.candidates ?? []);
      setCandidateCursor(data.nextCursor ?? null);
    } catch (error) {
      if (activeId.current === dadId && generation.current === version) setNotice(error instanceof Error ? error.message : "Review queue could not be loaded.");
    }
  }

  // Album changes start a fresh fetch cycle; generation guards discard old responses.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { loadPhotos(active.id); loadCandidates(active.id); }, [active.id]);

  useEffect(() => {
    fetch(appPath("/api/google/status")).then(async (response) => {
      if (!response.ok) return;
      setIsOwner(true);
      setGoogleStatus(await response.json() as GoogleStatus);
    }).catch(() => setGoogleStatus({ connected: false, configured: false }));
    // This counter invalidates async work; it is not a DOM element reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { generation.current++; if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dad = dads.find((item) => item.id === params.get("dad")) ?? dads[0];
    const messages: Record<string, string> = {
      connected: "Google Photos connected. Choose photos to import.",
      cancelled: "Google connection was cancelled. You can try again.",
      "signin-required": "Sign in as the owner before connecting Google Photos.",
      "invalid-state": "That connection attempt expired or was already used. Connect again.",
      failed: "Google connection failed. Check your settings and reconnect.",
    };
    if (dad.id !== activeId.current) selectDad(dad);
    else setRetrySession(savedSession(dad.id));
    // Read the external OAuth callback once after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotice(messages[params.get("google") ?? ""] ?? "");
    // Initial callback parameters only; album selection afterwards is user-controlled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pollPicker(id: string, dadId: string, version: number) {
    if (generation.current !== version || activeId.current !== dadId) return;
    const response = await fetch(appPath("/api/google/picker"), {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }),
    });
    const data = await response.json() as { error?: string; complete?: boolean; imported?: number; importing?: boolean; pollAfterMs?: number };
    if (generation.current !== version || activeId.current !== dadId) return;
    if (!response.ok) {
      if (response.status === 410 || response.status === 404) { saveSession(dadId, null); setRetrySession(null); }
      throw new Error(data.error ?? "Import interrupted. Retry this selection.");
    }
    if (data.complete) {
      saveSession(dadId, null); setRetrySession(null); setImporting(false);
      setNotice(`${data.imported ?? 0} photos imported. Review them below.`);
      await loadCandidates(dadId);
      return;
    }
    setNotice(data.importing ? `${data.imported ?? 0} photos imported so far…` : "Choose photos in the Google Photos window.");
    pollTimer.current = setTimeout(() => pollPicker(id, dadId, version).catch((error) => handleImportError(error, dadId, version)),
      Math.min(60_000, Math.max(500, data.pollAfterMs ?? 3000)));
  }

  function handleImportError(error: unknown, dadId: string, version: number) {
    if (generation.current !== version || activeId.current !== dadId) return;
    setImporting(false);
    setNotice(error instanceof Error ? error.message : "The import could not be completed.");
  }

  function retryImport() {
    const id = retrySession;
    if (!id) return;
    setImporting(true);
    const version = generation.current;
    pollPicker(id, active.id, version).catch((error) => handleImportError(error, active.id, version));
  }

  async function openGoogleSetup() {
    try {
      const response = await fetch(appPath("/api/google/settings"));
      if (!response.ok) throw new Error("Sign in as the owner to manage Google settings.");
      const data = await response.json() as { clientId?: string; redirectUri?: string };
      setClientId(data.clientId ?? ""); setClientSecret("");
      setRedirectUri(data.redirectUri ?? ""); setShowGoogleSetup(true);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Settings could not be loaded."); }
  }

  async function importFromGoogle() {
    const dadId = active.id;
    const version = generation.current;
    if (!googleStatus?.configured) { await openGoogleSetup(); return; }
    if (!googleStatus.connected) {
      try {
        const response = await fetch(appPath("/api/google/start"), {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dad: dadId }),
        });
        const data = await response.json() as { error?: string; url?: string };
        if (!response.ok || !data.url) throw new Error(data.error ?? "Google Photos connection could not be started.");
        window.location.href = data.url;
      } catch (error) { handleImportError(error, dadId, version); }
      return;
    }
    const pickerWindow = window.open("about:blank", "google-photos-picker", "popup,width=1080,height=760");
    setImporting(true); setNotice("Opening Google Photos…");
    try {
      const response = await fetch(appPath("/api/google/picker"), {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dad: dadId }),
      });
      const data = await response.json() as { error?: string; pickerUri: string; id: string };
      if (!response.ok) throw new Error(data.error ?? "Google Photos could not be opened.");
      saveSession(dadId, data.id);
      if (activeId.current === dadId && generation.current === version) setRetrySession(data.id);
      if (pickerWindow) pickerWindow.location.href = data.pickerUri;
      else { throw new Error("Allow pop-ups, then start a new Google selection."); }
      await pollPicker(data.id, dadId, version);
    } catch (error) {
      pickerWindow?.close();
      handleImportError(error, dadId, version);
    }
  }

  async function saveGoogleSetup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSavingGoogleSetup(true); setNotice("");
    try {
      const response = await fetch(appPath("/api/google/settings"), {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, clientSecret }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The Google settings could not be saved.");
      setGoogleStatus({ configured: true, connected: false }); setClientSecret(""); setShowGoogleSetup(false);
      setNotice("Google details saved securely. Reconnect Google Photos to continue.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "The Google settings could not be saved."); }
    finally { setSavingGoogleSetup(false); }
  }

  async function review(candidate: Candidate, action: "approve" | "reject") {
    const dadId = active.id;
    const version = generation.current;
    setReviewing(candidate.id);
    try {
      const response = await fetch(appPath("/api/candidates"), {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: candidate.id, action, caption: candidate.caption }),
      });
      if (!response.ok) throw new Error("Review action failed.");
      if (activeId.current !== dadId || generation.current !== version) return;
      await loadCandidates(dadId);
      if (action === "approve") await loadPhotos(dadId);
    } catch {
      if (activeId.current === dadId && generation.current === version) setNotice("That photo could not be updated. Retry or reload the queue.");
    } finally { setReviewing(null); }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const dadId = active.id;
    const version = generation.current;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append("photo", file); body.append("dad", dadId);
        body.append("caption", file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "));
        const response = await fetch(appPath("/api/photos"), { method: "POST", body });
        if (!response.ok) {
          const data = await response.json() as { error?: string };
          throw new Error(data.error ?? "Upload failed. Completed photos have been kept.");
        }
      }
      if (activeId.current === dadId && generation.current === version) await loadPhotos(dadId);
    } catch (error) {
      if (activeId.current === dadId && generation.current === version) setNotice(error instanceof Error ? error.message : "Upload failed.");
    } finally { setUploading(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  const currentIndex = dads.findIndex((dad) => dad.id === active.id);
  const shift = (n: number) => selectDad(dads[(currentIndex + n + dads.length) % dads.length]);

  return (
    <main className="min-h-screen overflow-hidden bg-[#f2efe8] text-[#172a2d]">
      <header className="border-b border-[#172a2d]/20 px-5 py-5 sm:px-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <p className="text-sm font-semibold uppercase tracking-[0.22em]">Father’s Day · Our family</p>
          <Heart className="h-5 w-5 fill-[#b55236] text-[#b55236]" aria-hidden="true" />
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 pb-14 pt-12 sm:px-10 sm:pt-20">
        <div className="grid gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:items-end">
          <div>
            <p className="mb-5 font-serif text-lg italic text-[#b55236]">Seven dads, one family</p>
            <h1 className="font-serif text-[clamp(3.4rem,10vw,8.5rem)] leading-[0.8] tracking-[-0.055em]">The men<br/>we call Dad.</h1>
          </div>
          <div className="border-l-2 border-[#b55236] pl-6 sm:pl-9">
            <p className="max-w-xl font-serif text-2xl leading-snug sm:text-3xl">A collection of the faces, places, and moments that made us a family.</p>
            <p className="mt-6 max-w-lg text-base leading-7 text-[#4b5a5b]">Some are here with us, and some live on in every story we tell. This Father’s Day, we’re keeping those stories together.</p>
          </div>
        </div>
      </section>

      <nav aria-label="Choose a dad" className="border-y border-[#172a2d]/20 bg-[#172a2d] px-5 text-[#f8f4eb] sm:px-10">
        <div className="mx-auto grid max-w-7xl grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
          {dads.map((dad, i) => <button key={dad.id} onClick={() => selectDad(dad)} className={`min-h-24 border-[#f8f4eb]/20 px-4 py-5 text-left transition sm:border-l ${i === dads.length - 1 ? "sm:border-r" : ""} ${active.id === dad.id ? "bg-[#f8f4eb] text-[#172a2d]" : "hover:bg-white/10"}`}><span className="block text-xs tracking-[0.18em] opacity-60">0{i + 1}</span><span className="mt-2 block font-serif text-xl">{dad.title}</span></button>)}
        </div>
      </nav>

      <section className="mx-auto max-w-7xl px-5 py-12 sm:px-10 sm:py-16">
        <div className="mb-10 flex flex-col gap-7 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-4 h-2 w-20" style={{ background: active.colour }} />
            <p className="text-sm uppercase tracking-[0.2em] text-[#5b6666]">{active.relationship}</p>
            <h2 className="mt-2 font-serif text-5xl tracking-tight sm:text-7xl">{active.title}</h2>
            <p className="mt-4 max-w-xl text-lg leading-7 text-[#526061]">{active.note}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => shift(-1)} className="grid h-12 w-12 place-items-center border border-[#172a2d] hover:bg-[#172a2d] hover:text-white" aria-label="Previous dad"><ChevronLeft /></button>
            <button onClick={() => shift(1)} className="grid h-12 w-12 place-items-center border border-[#172a2d] hover:bg-[#172a2d] hover:text-white" aria-label="Next dad"><ChevronRight /></button>
            {isOwner ? <>
            <input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple onChange={(e) => upload(e.target.files)} />
            <button onClick={importFromGoogle} disabled={importing} className="flex h-12 items-center gap-2 border border-[#172a2d] px-5 font-semibold hover:bg-[#172a2d] hover:text-white disabled:cursor-not-allowed disabled:opacity-45">
              {importing ? <LoaderCircle className="animate-spin" /> : googleStatus?.configured === false ? <KeyRound /> : <Cloud />} {googleStatus?.configured === false ? "Set up Google Photos" : googleStatus?.connected ? "Choose from Google" : "Connect Google Photos"}
            </button>
            <button onClick={() => inputRef.current?.click()} disabled={uploading} className="flex h-12 items-center gap-2 bg-[#b55236] px-5 font-semibold text-white hover:bg-[#8f3f2a] disabled:opacity-60">
              {uploading ? <LoaderCircle className="animate-spin" /> : <ImagePlus />} {uploading ? "Adding…" : "Add photos"}
            </button>
            <button onClick={openGoogleSetup} className="h-12 border border-[#172a2d] px-4">Google settings</button>
            </> : <a href={appPath("/admin")} className="h-12 border border-[#172a2d] px-4 py-3">Owner sign in</a>}
          </div>
        </div>

        {showGoogleSetup && (
          <aside className="mb-12 border border-[#172a2d]/25 bg-[#172a2d] p-5 text-[#f8f4eb] sm:p-8" aria-labelledby="google-setup-title">
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d9ab83]">Owner setup</p>
                <h3 id="google-setup-title" className="mt-1 font-serif text-3xl">Connect the Google Photos Picker</h3>
              </div>
              <button type="button" onClick={() => setShowGoogleSetup(false)} className="grid h-10 w-10 shrink-0 place-items-center border border-white/35" aria-label="Close Google setup"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-6 grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
              <div className="text-sm leading-6 text-white/75">
                <p>In Google Cloud, enable the Google Photos Picker API, then create an OAuth client with application type <strong className="text-white">Web application</strong>.</p>
                <p className="mt-4">Add this exact authorised redirect URI:</p>
                <code className="mt-2 block break-all border border-white/20 bg-black/20 p-3 text-xs text-white">{redirectUri || "Loading callback address…"}</code>
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="mt-4 inline-block font-semibold text-[#e7bd96] underline underline-offset-4">Open Google Cloud credentials</a>
              </div>
              <form onSubmit={saveGoogleSetup} className="grid gap-4">
                <label className="grid gap-2 text-sm font-semibold">OAuth client ID
                  <input value={clientId} onChange={(event) => setClientId(event.target.value)} required autoComplete="off" placeholder="…apps.googleusercontent.com" className="h-12 border border-white/30 bg-white px-4 font-normal text-[#172a2d] outline-none focus:border-[#d9ab83]" />
                </label>
                <label className="grid gap-2 text-sm font-semibold">OAuth client secret
                  <input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} required autoComplete="new-password" placeholder="Enter the secret once" className="h-12 border border-white/30 bg-white px-4 font-normal text-[#172a2d] outline-none focus:border-[#d9ab83]" />
                </label>
                <p className="text-xs leading-5 text-white/60">The secret is encrypted before storage and is never displayed again.</p>
                <button disabled={savingGoogleSetup} className="mt-1 flex h-12 items-center justify-center gap-2 bg-[#d9ab83] px-5 font-semibold text-[#172a2d] hover:bg-[#e7bd96] disabled:opacity-60">{savingGoogleSetup ? <LoaderCircle className="animate-spin" /> : <KeyRound />} {savingGoogleSetup ? "Saving…" : "Save securely"}</button>
              </form>
            </div>
          </aside>
        )}

        {(notice || candidates.length > 0 || retrySession) && (
          <aside className="mb-12 border border-[#172a2d]/25 bg-[#fbfaf6] p-5 sm:p-7" aria-live="polite">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b55236]">Private review</p>
                <h3 className="mt-1 font-serif text-3xl">Choose what joins {active.title}’s album</h3>
              </div>
              <p className="max-w-lg text-sm leading-6 text-[#586668]">Choose photos that include {active.title}. Approve only photos where everyone shown is part of your family. Identity is checked by you.</p>
            </div>
            {notice && <p className="mt-5 border-l-2 border-[#b55236] pl-4 text-sm text-[#4b5a5b]">{notice}</p>}
            {retrySession && !importing && <button onClick={retryImport} className="mt-4 border border-[#172a2d] px-4 py-2">Resume / retry selection</button>}
            {candidateCursor && <button onClick={() => loadCandidates(active.id, candidateCursor)} className="mt-4 ml-3 border border-[#172a2d] px-4 py-2">Load more to review</button>}
            {candidates.length > 0 && (
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {candidates.map((candidate) => (
                  <article key={candidate.id} className="overflow-hidden border border-[#172a2d]/20 bg-white">
                    <div className="relative aspect-[4/3] bg-[#e7e1d6]"><img src={candidate.url} alt={candidate.caption} className="h-full w-full object-cover" />
                      {candidate.suggestedBest && <span className="absolute left-2 top-2 flex items-center gap-1 bg-[#172a2d] px-2 py-1 text-xs font-semibold text-white"><Sparkles className="h-3.5 w-3.5" /> Highest resolution nearby</span>}
                      {candidate.similarShot && !candidate.suggestedBest && <span className="absolute left-2 top-2 bg-white/90 px-2 py-1 text-xs font-semibold">Taken within 3 seconds</span>}
                    </div>
                    <div className="p-3">
                      <p className="truncate text-sm" title={candidate.filename}>{candidate.filename}</p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button onClick={() => review(candidate, "reject")} disabled={reviewing === candidate.id} className="flex h-10 items-center justify-center gap-1.5 border border-[#172a2d]/35 text-sm font-semibold hover:bg-[#eee9df]"><Trash2 className="h-4 w-4" /> Skip</button>
                        <button onClick={() => review(candidate, "approve")} disabled={reviewing === candidate.id} className="flex h-10 items-center justify-center gap-1.5 bg-[#172a2d] text-sm font-semibold text-white hover:bg-[#284145]"><Check className="h-4 w-4" /> Keep</button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </aside>
        )}

        {loading ? <div className="grid min-h-56 place-items-center border border-dashed border-[#172a2d]/30"><LoaderCircle className="animate-spin" /></div> : photos.length === 0 ? (
          <button onClick={() => { if (isOwner) inputRef.current?.click(); }} className="group grid min-h-72 w-full place-items-center border border-dashed border-[#172a2d]/35 bg-[#fbfaf6] p-8 text-center hover:border-[#b55236]">
            <span><Camera className="mx-auto mb-5 h-10 w-10 text-[#b55236]" /><span className="block font-serif text-3xl">Begin {active.title}’s story</span><span className="mt-3 block text-[#5b6666]">{isOwner ? "Choose photos from your phone or computer" : "Family photos will appear here soon."}</span></span>
          </button>
        ) : (
          <div className="columns-1 gap-5 sm:columns-2 lg:columns-3">
            {photos.map((photo, i) => <button key={photo.key} onClick={() => setLightbox(photo)} className="group relative mb-5 block w-full break-inside-avoid overflow-hidden bg-[#172a2d] text-left"><img src={photo.url} alt={photo.caption || `Family memory ${i + 1}`} className="w-full object-cover transition duration-500 group-hover:scale-[1.02]" /><span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-5 pb-4 pt-16 text-white opacity-0 transition group-hover:opacity-100">{photo.caption}</span></button>)}
          </div>
        )}
      </section>

      <footer className="border-t border-[#172a2d]/20 px-5 py-8 text-center text-sm text-[#667273]">Made with love for Father’s Day · 2026</footer>

      {lightbox && <div className="fixed inset-0 z-50 grid place-items-center bg-[#101b1d]/95 p-4" role="dialog" aria-modal="true" aria-label="Photo view"><button onClick={() => setLightbox(null)} className="absolute right-5 top-5 grid h-12 w-12 place-items-center border border-white/40 text-white" aria-label="Close photo"><X /></button><div className="max-h-[88vh] max-w-5xl"><img src={lightbox.url} alt={lightbox.caption} className="max-h-[80vh] max-w-full object-contain" /><p className="mt-4 text-center font-serif text-xl text-white">{lightbox.caption}</p></div></div>}
    </main>
  );
}
