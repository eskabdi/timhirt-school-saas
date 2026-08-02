// Staff inbox: direct messages grouped into threads by thread_id. RLS
// already scopes every row to "I am the sender or the recipient" (see
// 20260802000005_staff_messages.sql), so this page never filters by user
// itself -- it just groups and renders what comes back.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { EthDate } from "@/components/EthDate";
import { useMessages } from "@/features/dashboard/useDashboardData";

export function MessagesPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const { data: threads } = useMessages(profile?.id);

  const active = threads?.find((th) => th.threadId === activeThread) ?? null;

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
    mutationFn: async () => {
      if (!active || !reply.trim()) return;
      const iAmSender = active.last.sender_id === profile!.id;
      const recipientId = iAmSender ? active.last.recipient_id : active.last.sender_id;
      const { error } = await supabase.from("messages").insert({
        tenant_id: profile!.tenant_id,
        thread_id: active.threadId,
        sender_id: profile!.id,
        recipient_id: recipientId,
        title: `Re: ${active.last.title.replace(/^Re:\s*/, "")}`,
        body: reply.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => { setReply(""); qc.invalidateQueries({ queryKey: ["messages"] }); },
  });

  const openThread = (threadId: string) => {
    setActiveThread(threadId);
    const th = threads?.find((t) => t.threadId === threadId);
    if (th?.unread) markRead.mutate(threadId);
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("messages.title")}</h1>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-1">
          <PanelHeader title={t("messages.inbox")} />
          {!threads?.length ? (
            <p className="p-6 text-center text-sm text-ink-faint">{t("messages.empty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {threads.map((th) => (
                <li key={th.threadId}>
                  <button type="button" onClick={() => openThread(th.threadId)}
                    className={`w-full px-4 py-3 text-left hover:bg-sidebar ${activeThread === th.threadId ? "bg-navy-wash" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className={`truncate text-sm ${th.unread ? "font-bold text-ink" : "font-medium text-ink-soft"}`}>{th.otherName}</p>
                      {th.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-navy" />}
                    </div>
                    <p className="truncate text-xs text-ink-faint">{th.last.title}</p>
                    <p className="mt-0.5 text-[11px] text-ink-faint"><EthDate value={th.last.created_at} /></p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="lg:col-span-2">
          {!active ? (
            <Card className="flex h-full min-h-[240px] items-center justify-center text-sm text-ink-faint">
              {t("messages.selectThread")}
            </Card>
          ) : (
            <Panel>
              <PanelHeader title={active.otherName} subtitle={active.last.title} />
              <div className="max-h-[50vh] space-y-3 overflow-y-auto p-4">
                {active.msgs.map((m) => {
                  const mine = m.sender_id === profile?.id;
                  return (
                    <div key={m.id} className={`max-w-[80%] rounded-lg p-3 text-sm ${mine ? "ml-auto bg-navy-wash text-ink" : "bg-sidebar text-ink"}`}>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      <p className="mt-1 text-[11px] text-ink-faint"><EthDate value={m.created_at} /></p>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2 border-t border-line p-3">
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} maxLength={4000}
                  placeholder={t("messages.replyPlaceholder")}
                  className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
                <Button onClick={() => sendReply.mutate()} disabled={sendReply.isPending || !reply.trim()}>
                  {t("messages.reply")}
                </Button>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
