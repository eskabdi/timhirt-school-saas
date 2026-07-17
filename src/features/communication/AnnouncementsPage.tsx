import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";

export function AnnouncementsPage() {
  const { profile } = useSession();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all" | "staff" | "parents">("all");

  const { data: announcements } = useQuery({
    queryKey: ["announcements"],
    queryFn: async () => {
      const { data, error } = await supabase.from("announcements")
        .select("id, title_i18n, body_i18n, audience, published_at").order("published_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const publish = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("announcements").insert({
        tenant_id: profile!.tenant_id, title_i18n: { en: title }, body_i18n: { en: body },
        audience, created_by: profile!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["announcements"] }); setTitle(""); setBody(""); },
  });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Communication Hub</h1>
      <Card className="max-w-xl space-y-3">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} /></Field>
        <Field label="Message">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={3000}
            className="w-full rounded-control border border-line px-3 py-2 text-sm" />
        </Field>
        <Field label="Audience">
          <select value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)}
            className="w-full rounded-control border border-line px-3 py-2 text-sm">
            <option value="all">All</option><option value="staff">Staff</option><option value="parents">Parents</option>
          </select>
        </Field>
        <Button onClick={() => publish.mutate()} disabled={!title || !body}>Publish</Button>
      </Card>
      <div className="space-y-2">
        {announcements?.map((a) => (
          <Card key={a.id}>
            <p className="font-medium">{a.title_i18n?.en}</p>
            <p className="text-sm text-ink-faint">{a.body_i18n?.en}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
