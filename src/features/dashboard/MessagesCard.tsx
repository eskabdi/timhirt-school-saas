// Dashboard "Messages" card -- separate from the Notice Board panel next to
// it: a notice is a scheduled broadcast anyone in the audience can see, a
// message is a private thread between two people, with its own read state
// and a reply box right here so a quick "thanks, got it" doesn't need a trip
// to the full /messages inbox.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { EthDate } from "@/components/EthDate";
import { useMessages } from "./useDashboardData";
import { LinkedHeader } from "./LinkedHeader";

const PREVIEW_COUNT = 4;

export function MessagesCard() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const { data: threads } = useMessages(profile?.id);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const markRead = useMutation({
    mutationFn: async (threadId: string) => {
      const { error } = await supabase.from("messages")
        .update({ read_at: new Date().toISOString() })
        .eq("thread_id", threadId).eq("recipient_id", profile!.id).is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messages"] }),
  });

  const sendReply = useMutation({
    mutationFn: async (threadId: string) => {
      const active = threads?.find((th) => th.threadId === threadId);
      if (!active || !reply.trim()) return;
      const iAmSender = active.last.sender_id === profile!.id;
      const recipientId = iAmSender ? active.last.recipient_id : active.last.sender_id;
      const { error } = await supabase.from("messages").insert({
        tenant_id: profile!.tenant_id,
        thread_id: threadId,
        sender_id: profile!.id,
        recipient_id: recipientId,
        title: `Re: ${active.last.title.replace(/^Re:\s*/, "")}`,
        body: reply.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => { setReply(""); setOpenThread(null); qc.invalidateQueries({ queryKey: ["messages"] }); },
  });

  const toggle = (threadId: string) => {
    const opening = openThread !== threadId;
    setOpenThread(opening ? threadId : null);
    setReply("");
    const th = threads?.find((t) => t.threadId === threadId);
    if (opening && th?.unread) markRead.mutate(threadId);
  };

  const preview = (threads ?? []).slice(0, PREVIEW_COUNT);

  return (
    <Panel>
      <LinkedHeader title={t("messages.title")} to="/messages" />
      <div className="p-4">
        {!preview.length ? (
          <p className="py-6 text-center text-sm text-ink-faint">{t("messages.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {preview.map((th) => (
              <li key={th.threadId} className="rounded-control border border-line">
                <button type="button" onClick={() => toggle(th.threadId)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
                  <div className="min-w-0">
                    <p className={`truncate text-sm ${th.unread ? "font-bold text-ink" : "font-medium text-ink-soft"}`}>
                      {th.otherName} — {th.last.title}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-faint"><EthDate value={th.last.created_at} /></p>
                  </div>
                  {th.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-navy" />}
                </button>
                {openThread === th.threadId && (
                  <div className="space-y-2 border-t border-line px-3 py-2">
                    <p className="whitespace-pre-wrap text-sm text-ink-soft">{th.last.body}</p>
                    <div className="flex gap-2">
                      <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} maxLength={4000}
                        placeholder={t("messages.replyPlaceholder")}
                        className="w-full rounded-control border border-line bg-card px-2 py-1.5 text-sm text-ink" />
                      <Button onClick={() => sendReply.mutate(th.threadId)} disabled={sendReply.isPending || !reply.trim()}>
                        {t("messages.reply")}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
