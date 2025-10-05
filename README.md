# 🚀 VibeCAD

> **Text-to-CAD generation made effortless.**  
> Turning imagination into 3D reality with natural language.

---

## 🧠 Overview

**VibeCAD** reimagines how designers, engineers, and beginners interact with CAD.  
Built in **24 hours** at a hackathon, our project transforms plain English into **parametric 3D models**, bridging creativity and engineering with a single prompt.

We combine the power of:
- **Claude (via Amazon Bedrock)** for natural language understanding  
- **Onshape API** for real-time CAD generation  
- **MCP server** for model orchestration and data flow  
- **Next.js + OPENSCAD** for a clean, intuitive front-end and fast rendering  

---

## 💡 Why VibeCAD?

CAD design is **intimidating**—especially for beginners.  
Complex software, steep learning curves, and countless constraints can discourage early learners and innovators.

VibeCAD **lowers the barrier to entry** by:
- Converting **simple text prompts** into editable CAD models  
- Automating repetitive design steps with **AI-driven precision**  
- Providing a **web-based interface** that’s modern, responsive, and open-source  
- Enabling **instant iteration**, letting users refine models with natural feedback loops (“make it taller,” “add holes,” “round the edges”)  

---

## ⚙️ How It Works

1. **User Input** – You describe what you want (e.g., “a wheel with spokes and a hollow center”).  
2. **Language Processing (Claude)** – Claude parses your intent and extracts geometric parameters.  
3. **MCP Server** – Acts as the bridge, translating structured JSON into CAD instructions.  
4. **Onshape API + OPENSCAD** – Builds the model dynamically, generating and rendering your design in seconds.  
5. **Next.js Frontend** – Displays the model, allowing export, rotation, and refinement directly in the browser.

---

## 🧰 Getting Started

Run VibeCAD locally in just a few steps:

### 1️⃣ Start the backend
```bash
cd backend
npm run build
./start-backend.sh
```

### 2️⃣ Start the frontend
```bash
cd frontend
pnpm dev
```

Once both services are running, open **http://localhost:3000** in your browser to start creating CAD models from natural language prompts.

---

## 🔄 System Architecture

```plaintext
┌────────────────────────────┐
│        User Prompt         │
│ "Create a gear with 8 teeth"│
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ Claude (via Bedrock)       │
│ Parses natural language → JSON │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ MCP Server                 │
│ Orchestrates data flow,    │
│ validates parameters        │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ Onshape API + OPENSCAD     │
│ Generates CAD geometry     │
│ & renders the model        │
└──────────────┬─────────────┘
               │
               ▼
┌────────────────────────────┐
│ Next.js Frontend           │
│ Displays 3D model preview  │
│ Allows live adjustments    │
└────────────────────────────┘
```

---

## 🌍 Key Features

✅ **Natural Language to CAD** — No CAD experience needed.  
✅ **Onshape Integration** — Real-time model generation and cloud rendering.  
✅ **Interactive Preview** — View and edit your model right in the browser.  
✅ **Open-source and Extensible** — Built for developers, makers, and educators.  
✅ **Hackathon Ready** — Developed from concept to prototype in under 24 hours.

---

## 🧩 Tech Stack

| Layer | Tools Used |
|-------|-------------|
| Frontend | Next.js, Express.js, TailwindCSS |
| CAD Engine | OPENSCAD, Onshape API |
| Backend | MCP Server, npm, pnpm, Node.js |
| AI Processing | Claude (via Amazon Bedrock) |
| Hosting | Vercel |

---

## 🚀 The Vision

We built VibeCAD to make **3D design accessible to everyone** — from first-time makers to seasoned engineers.  
Our long-term vision is to **democratize CAD creation**, enabling anyone to build, iterate, and learn through language.

> *If you can describe it, you can design it.*

---

## 🧑‍💻 Team

Created by a passionate team of three builders, engineers, and designers at a 36-hour hackathon.  
Fueled by caffeine and the belief that AI can make creation more human.

---

## 🧱 Try It Yourself (Coming Soon)

We’re working to make VibeCAD publicly accessible!  
Stay tuned for deployment updates and open beta access.

---

> Made with ❤️ by Team Bcs  
