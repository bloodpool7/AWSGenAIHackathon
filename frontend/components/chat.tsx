"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Send, Wrench } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

interface Message {
  role: "user" | "assistant"
  content: string
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState("")
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, streamingContent])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage = input.trim()
    setInput("")
    setMessages((prev) => [...prev, { role: "user", content: userMessage }])
    setIsLoading(true)
    setStreamingContent("")
    setToolStatus(null)

    try {
      const response = await fetch("http://localhost:3001/api/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userMessage,
          conversationHistory: messages,
        }),
      })

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error("No response body")
      }

      let accumulatedContent = ""

      while (true) {
        const { done, value } = await reader.read()
        
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split("\n")

              for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6))

              if (data.type === "text") {
                // Clear tool status when we start getting text response
                if (toolStatus) {
                  setToolStatus(null)
                }
                accumulatedContent += data.content
                setStreamingContent(accumulatedContent)
              } else if (data.type === "tool_use") {
                if (data.status === "calling") {
                  setToolStatus(`Using tool: ${data.tool}...`)
                } else if (data.status === "completed") {
                  setToolStatus(`Tool ${data.tool} completed`)
                }
              } else if (data.type === "done") {
                // Finalize the message
                if (accumulatedContent) {
                  setMessages((prev) => [
                    ...prev,
                    { role: "assistant", content: accumulatedContent },
                  ])
                }
                setStreamingContent("")
                setToolStatus(null)
              } else if (data.type === "error") {
                throw new Error(data.error)
              }
            } catch (parseError) {
              console.error("Error parsing SSE data:", parseError)
            }
          }
        }
      }
    } catch (error) {
      console.error("Error calling API:", error)
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, there was an error processing your request. Please try again.",
        },
      ])
      setStreamingContent("")
      setToolStatus(null)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-4xl space-y-4">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center py-12">
              <div className="text-center">
                <h2 className="text-xl font-semibold mb-2">Start Designing</h2>
                <p className="text-muted-foreground mb-6">Describe what you want to build in plain English</p>
                <div className="space-y-2 text-left max-w-md mx-auto">
                  <p className="text-sm text-muted-foreground">Try examples like:</p>
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
              {messages.map((message, index) => (
                <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-3 ${
                      message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                    }`}
                  >
                    {message.role === "assistant" ? (
                      <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-pre:bg-background prose-pre:text-foreground prose-code:text-foreground">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    )}
                  </div>
                </div>
              ))}
              {streamingContent && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] bg-muted text-foreground rounded-lg px-4 py-3">
                    <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-pre:bg-background prose-pre:text-foreground prose-code:text-foreground inline-block">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {streamingContent}
                      </ReactMarkdown>
                    </div>
                    <span className="inline-block w-2 h-4 bg-foreground animate-pulse ml-1 align-bottom" />
                  </div>
                </div>
              )}
              {toolStatus && (
                <div className="flex justify-start">
                  <div className="bg-muted/50 border border-muted-foreground/20 rounded-lg px-4 py-2 flex items-center gap-2">
                    <Wrench className="h-4 w-4 animate-spin text-muted-foreground" />
                    <p className="text-xs text-muted-foreground italic">{toolStatus}</p>
                  </div>
                </div>
              )}
              {isLoading && !streamingContent && !toolStatus && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg px-4 py-3">
                    <p className="text-sm text-muted-foreground">Generating...</p>
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
                  e.preventDefault()
                  handleSubmit(e)
                }
              }}
            />
            <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Press Enter to send, Shift+Enter for new line</p>
        </form>
      </div>
    </div>
  )
}
