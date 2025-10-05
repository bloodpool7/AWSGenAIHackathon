import { Chat } from "@/components/chat"

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-background px-4 py-3">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-lg font-semibold">VibeCAD</h1>
          <p className="text-sm text-muted-foreground">AI-Powered Text-to-CAD</p>
        </div>
      </header>
      <Chat />
    </main>
  )
}
