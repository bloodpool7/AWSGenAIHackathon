"use client";

import type React from "react";

import { useState, useRef, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Wrench } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Chat() {
  // Local input state (useChat no longer manages this)
  const [input, setInput] = useState("");

  const {
    messages,   // UIMessage[]
    status,     // 'ready' | 'submitted' | 'streaming' | 'error'
    error,
    sendMessage,
    // you also get: stop, regenerate, addToolOutput, setMessages, etc.
  } = useChat({
    // We’re talking directly to your Cloudflare Worker
    transport: new DefaultChatTransport({
      api: "http://localhost:3001/api/chat/stream",
      credentials: "omit",
      // if you need CORS credentials or extra headers, you can add them here
      // credentials: "include",
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || status !== "ready") return;

    // v5: sendMessage takes either a string or a CreateUIMessage ({ text: "..." })
    sendMessage({ text: trimmed });
    setInput("");
  };

  // const isThinking = status === "submitted" || status === "streaming";


  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-4xl space-y-4">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center py-12">
              <div className="text-center">
                <h2 className="text-xl font-semibold mb-2">Start Designing</h2>
                <p className="text-muted-foreground mb-6">
                  Describe what you want to build in plain English
                </p>
                <div className="space-y-2 text-left max-w-md mx-auto">
                  <p className="text-sm text-muted-foreground">
                    Try examples like:
                  </p>
                  <div className="space-y-1">
                    <p className="text-sm bg-muted px-3 py-2 rounded-md">
                      "Create a 10x10 meter floor plan with 3 bedrooms"
                    </p>
                    <p className="text-sm bg-muted px-3 py-2 rounded-md">
                      "Design a bracket to mount a 5-inch monitor"
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {messages.map((message) => {
                const isUser = message.role === "user";

                // Combine all text parts for Markdown rendering
                const text =
                  message.parts
                    ?.filter((p) => p.type === "text")
                    .map((p: any) => p.text)
                    .join("") ?? "";

                return (
                  <div
                    key={message.id}
                    className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-4 py-3 ${
                        isUser
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      {message.role === "assistant" ? (
                        <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-pre:bg-background prose-pre:text-foreground prose-code:text-foreground">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {text}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap">{text}</p>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* {isThinking && (
                <div className="flex justify-start">
                  <div className="bg-muted/50 border border-muted-foreground/20 rounded-lg px-4 py-2 flex items-center gap-2">
                    <Wrench className="h-4 w-4 animate-spin text-muted-foreground" />
                    <p className="text-xs text-muted-foreground italic">
                      Thinking / calling tools…
                    </p>
                  </div>
                </div>
              )} */}

              {error && (
                <div className="flex justify-start">
                  <div className="bg-destructive/10 border border-destructive/40 rounded-lg px-4 py-2">
                    <p className="text-xs text-destructive">
                      Something went wrong. Check the console for details.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t border-border bg-background px-4 py-4">
        <form onSubmit={handleSubmit} className="mx-auto max-w-4xl">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe what you want to build..."
              className="min-h-[60px] resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              disabled={status !== "ready"}
            />
            <Button
              type="submit"
              size="icon"
              disabled={status !== "ready" || !input.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Press Enter to send, Shift+Enter for new line
          </p>
        </form>
      </div>
    </div>
  );
}
