import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

// Invokes the issue-id-card Edge Function (the same two-page front/back PDF that
// gets printed for real), then loads it as a same-origin blob so Print and Save
// work directly on the embedded preview (a cross-origin storage URL can't be
// driven by iframe.print()).
export function PrintIDCardModal({ studentId, studentName, open, onClose }: {
  studentId: string; studentName: string; open: boolean; onClose: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!open) return;
    let revoke: string | null = null;
    (async () => {
      setLoading(true); setError(null); setBlobUrl(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/issue-id-card`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ student_id: studentId }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to generate ID card");
        const { url } = await res.json();
        const pdf = await (await fetch(url)).blob();
        revoke = URL.createObjectURL(pdf);
        setBlobUrl(revoke);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      } finally { setLoading(false); }
    })();
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [open, studentId]);

  const print = () => { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print(); };
  const save = () => {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl; a.download = `id-card-${studentName.replace(/\s+/g, "-").toLowerCase()}.pdf`; a.click();
  };

  return (
    <Modal open={open} onClose={onClose} title={`ID Card — ${studentName}`} size="lg">
      {loading && <p className="py-12 text-center text-ink-faint">Generating front &amp; back…</p>}
      {error && <p className="py-6 text-center text-sm text-danger">{error}</p>}
      {blobUrl && (
        <>
          <p className="mb-2 text-xs text-ink-faint">Preview — page 1 is the front, page 2 is the back.</p>
          <iframe ref={frame} src={blobUrl} title="ID card preview" className="h-[460px] w-full rounded-lg border border-line" />
          <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="ghost" className="border border-line" onClick={save}>⬇ Save PDF</Button>
            <Button onClick={print}>🖨 Print</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
