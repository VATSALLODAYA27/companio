'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { RequireAuth } from '../../../components/require-auth';
import { useAuth } from '../../../contexts/auth-context';
import { api, ApiError } from '../../../lib/api';
import { getSocket } from '../../../lib/socket';
import type { MessageView } from '../../../lib/types';
import { Alert, Button, Input, Spinner } from '../../../components/ui';

export default function ChatPage() {
  return (
    <RequireAuth>
      <Chat />
    </RequireAuth>
  );
}

function Chat() {
  const params = useParams<{ conversationId: string }>();
  const conversationId = params.conversationId;
  const { userId } = useAuth();

  const [messages, setMessages] = useState<MessageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const history = await api.get<MessageView[]>(`/conversations/${conversationId}/messages`);
        if (!cancelled) setMessages(history);
        await api.post(`/conversations/${conversationId}/messages/read`).catch(() => {});
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load this conversation.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    function join() {
      socket.emit('join', { conversationId });
    }
    if (socket.connected) join();
    socket.on('connect', join);

    function onMessage(message: MessageView) {
      if (message.conversationId !== conversationId) return;
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    }
    socket.on('message', onMessage);

    return () => {
      socket.emit('leave', { conversationId });
      socket.off('connect', join);
      socket.off('message', onMessage);
    };
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      const message = await api.post<MessageView>(`/conversations/${conversationId}/messages`, {
        body,
      });
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      setDraft('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that message.');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="mx-auto flex h-[calc(100vh-56px)] max-w-2xl flex-col px-4 py-4">
      <h1 className="mb-3 text-lg font-semibold text-gray-900">Chat</h1>

      {error && (
        <div className="mb-3">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="flex-1 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-gray-400">Say hello 👋</p>
        ) : (
          <div className="flex flex-col gap-2">
            {messages.map((m) => {
              const mine = m.senderId === userId;
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                      mine ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-900'
                    }`}
                  >
                    {m.body}
                    <div className={`mt-0.5 text-[10px] ${mine ? 'text-brand-100' : 'text-gray-400'}`}>
                      {new Date(m.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <form onSubmit={handleSend} className="mt-3 flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message…"
          maxLength={2000}
        />
        <Button type="submit" disabled={sending || !draft.trim()}>
          Send
        </Button>
      </form>
    </main>
  );
}
