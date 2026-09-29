"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  Check,
  ChevronLeft,
  FileText,
  LogOut,
  Menu,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

type Citation = { source: string; section: string };
type CurrentUser = { id: string; email: string };
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
};
type ChatSession = { id: string; title: string; updated_at: string };
type StreamEvent =
  | { type: "session"; sessionId: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; error: string };

async function fetchSessions(): Promise<ChatSession[]> {
  const response = await fetch("/api/chat/sessions");
  if (!response.ok) throw new Error("Chat history could not be loaded.");
  const result = await response.json();
  return result.sessions ?? [];
}

async function fetchCurrentUser(): Promise<CurrentUser> {
  const response = await fetch("/api/auth/me");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Account details could not be loaded.");
  return result.user;
}

const suggestions = [
  "What is our password policy?",
  "How does remote work expense reimbursement work?",
  "What education assistance is available?",
];

function temporaryId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export default function ChatWorkspace() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSessions()
      .then(setSessions)
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Chat history is unavailable."))
      .finally(() => setIsLoadingHistory(false));
    fetchCurrentUser()
      .then(setCurrentUser)
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Account details could not be loaded."));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  function startNewChat() {
    setSessionId(null);
    setMessages([]);
    setNotice("");
    setMobileSidebarOpen(false);
  }

  async function selectSession(session: ChatSession) {
    setNotice("");
    setMobileSidebarOpen(false);
    setSessionId(session.id);
    try {
      const response = await fetch(`/api/chat/sessions/${session.id}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Conversation could not be loaded.");
      setMessages((result.messages ?? []).map((message: ChatMessage & { id: string }) => ({
        ...message,
        citations: message.citations ?? [],
      })));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Conversation could not be loaded.");
    }
  }

  function appendAssistant(update: Partial<ChatMessage>) {
    setMessages((current) => {
      const next = [...current];
      const last = next[next.length - 1];
      if (!last || last.role !== "assistant") return current;
      next[next.length - 1] = { ...last, ...update };
      return next;
    });
  }

  async function submitQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed || isStreaming) return;
    setDraft("");
    setNotice("");
    setIsStreaming(true);
    setMessages((current) => [
      ...current,
      { id: temporaryId(), role: "user", content: trimmed },
      { id: temporaryId(), role: "assistant", content: "", citations: [] },
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, sessionId }),
      });
      if (!response.ok || !response.body) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error ?? "The assistant is unavailable.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const packets = buffer.split("\n\n");
        buffer = packets.pop() ?? "";
        for (const packet of packets) {
          const dataLine = packet.split("\n").find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          const event = JSON.parse(dataLine.slice(6)) as StreamEvent;
          if (event.type === "session") setSessionId(event.sessionId);
          if (event.type === "citations") appendAssistant({ citations: event.citations });
          if (event.type === "delta") {
            setMessages((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content + event.text };
              return next;
            });
          }
          if (event.type === "error") streamError = event.error;
        }
      }
      if (streamError) appendAssistant({ content: streamError });
      setSessions(await fetchSessions());
    } catch (error) {
      const message = error instanceof Error ? error.message : "The assistant is unavailable.";
      appendAssistant({ content: message });
    } finally {
      setIsStreaming(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitQuestion(draft);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitQuestion(draft);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/");
  }

  const isEmpty = messages.length === 0;
  const sidebarClass = [
    "chat-sidebar",
    sidebarOpen ? "" : "is-collapsed",
    mobileSidebarOpen ? "is-mobile-open" : "",
  ].filter(Boolean).join(" ");

  return (
    <main className="workspace-shell">
      {mobileSidebarOpen && <button className="sidebar-scrim" aria-label="Close chat history" onClick={() => setMobileSidebarOpen(false)} />}
      <aside className={sidebarClass}>
        <div className="sidebar-top">
          <button className="icon-button sidebar-collapse" title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"} aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"} onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </button>
          <button className="icon-button mobile-sidebar-close" title="Close history" aria-label="Close history" onClick={() => setMobileSidebarOpen(false)}><ChevronLeft size={18} /></button>
        </div>

        <button className="new-chat-button" onClick={startNewChat} title="Start a new conversation">
          <MessageSquarePlus size={16} />
          <span>New conversation</span>
          <Plus className="new-chat-plus" size={15} />
        </button>

        <div className="history-label">YOUR HISTORY <span>{sessions.length.toString().padStart(2, "0")}</span></div>
        <div className="history-list">
          {isLoadingHistory && <p className="history-empty">Loading conversations...</p>}
          {!isLoadingHistory && sessions.length === 0 && <p className="history-empty">Your conversations will appear here.</p>}
          {sessions.map((session) => (
            <button
              className={`history-item ${session.id === sessionId ? "is-active" : ""}`}
              key={session.id}
              title={session.title}
              onClick={() => void selectSession(session)}
            >
              <span className="history-item-mark"><span /></span>
              <span className="history-item-title">{session.title}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className="workspace-status"><span className="status-dot" /><span>Workspace secure</span><ShieldCheck size={14} /></div>
          <button className="account-row" onClick={() => void signOut()} title="Sign out">
            <span className="account-avatar">{currentUser?.email.charAt(0).toUpperCase() ?? "?"}</span>
            <span className="account-details"><strong>{currentUser?.email ?? "Loading account..."}</strong><small>Signed in</small></span>
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      <section className="chat-main">
        <header className="chat-topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu-button" aria-label="Open chat history" onClick={() => setMobileSidebarOpen(true)}><Menu size={18} /></button>
            <span className="topbar-section">Policy assistant</span>
            <span className="topbar-divider">/</span>
            <span className="topbar-current">{sessionId ? sessions.find((item) => item.id === sessionId)?.title ?? "Conversation" : "New conversation"}</span>
          </div>
        </header>

        <div className={`conversation ${isEmpty ? "is-empty" : ""}`}>
          {isEmpty ? (
            <div className="welcome-block">
              <div className="welcome-icon"><Sparkles size={19} /></div>
              <p className="eyebrow">COMPANY POLICY ASSISTANT</p>
              <h1>What do you need<br />to know?</h1>
              <p className="welcome-subtitle">Ask a question. Answers are validated from COMPANY internal policies.</p>
              <div className="suggestion-list">
                {suggestions.map((suggestion, index) => (
                  <button key={suggestion} className="suggestion-button" onClick={() => void submitQuestion(suggestion)}>
                    <span className="suggestion-index">0{index + 1}</span>
                    <span>{suggestion}</span>
                    <ArrowUp className="suggestion-arrow" size={14} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message) => (
                <article className={`message-row ${message.role}`} key={message.id}>
                  <div className={`message-avatar ${message.role === "assistant" ? "assistant-avatar" : "user-avatar"}`}>
                    {message.role === "assistant" ? <span>P<span>.</span></span> : "A"}
                  </div>
                  <div className="message-body">
                    <div className="message-author">{message.role === "assistant" ? "COMPANY" : "You"}<span>{message.role === "assistant" && <Check size={12} />}</span></div>
                    {message.role === "assistant" ? (
                      <div className="markdown-content">
                        {message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : isStreaming ? <span className="typing-indicator"><i /><i /><i /></span> : null}
                      </div>
                    ) : <p className="user-message-text">{message.content}</p>}
                    {message.role === "assistant" && Boolean(message.citations?.length) && (
                      <div className="citation-list" aria-label="Sources used">
                        <div className="citation-heading"><FileText size={13} /> SOURCES</div>
                        {message.citations?.map((citation, index) => (
                          <div className="citation-item" key={`${citation.source}-${citation.section}-${index}`}>
                            <span className="citation-number">{index + 1}</span>
                            <span className="citation-source">{citation.source}</span>
                            <span className="citation-separator">/</span>
                            <span className="citation-section">{citation.section}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="composer-wrap">
          {notice && <p className="workspace-notice" role="status">{notice}</p>}
          <form className="composer" onSubmit={handleSubmit}>
            <textarea
              aria-label="Ask about company policy"
              placeholder="Ask a policy question..."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              rows={1}
              disabled={isStreaming}
            />
            <div className="composer-footer">
              <span><span className="composer-purple-dot" /> Policy-validated answers</span>
              <button className="send-button" type="submit" aria-label="Send message" disabled={!draft.trim() || isStreaming}>
                <ArrowUp size={17} />
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}