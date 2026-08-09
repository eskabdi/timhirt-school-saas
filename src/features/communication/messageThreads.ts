// Shared thread-grouping for the two places that render `messages` rows:
// MessagesPage.tsx (full inbox) and the Dashboard's Messages card. RLS
// already scopes every row to "I am the sender or the recipient", so this
// just groups by thread_id and figures out who "the other party" is.
export interface MessageRow {
  id: string; thread_id: string; sender_id: string; recipient_id: string;
  title: string; body: string; read_at: string | null; created_at: string;
  sender: { full_name: string } | null; recipient: { full_name: string } | null;
}

export interface MessageThread {
  threadId: string; msgs: MessageRow[]; last: MessageRow; otherName: string; unread: boolean;
}

export function groupIntoThreads(rows: MessageRow[], myUserId: string | undefined): MessageThread[] {
  const byThread = new Map<string, MessageRow[]>();
  for (const m of rows) {
    const arr = byThread.get(m.thread_id) ?? [];
    arr.push(m);
    byThread.set(m.thread_id, arr);
  }
  return [...byThread.entries()]
    .map(([threadId, msgs]) => {
      const last = msgs[msgs.length - 1]!;
      const iAmSender = last.sender_id === myUserId;
      const otherName = (iAmSender ? last.recipient?.full_name : last.sender?.full_name) ?? "—";
      const unread = msgs.some((m) => m.recipient_id === myUserId && !m.read_at);
      return { threadId, msgs, last, otherName, unread };
    })
    .sort((a, b) => b.last.created_at.localeCompare(a.last.created_at));
}
