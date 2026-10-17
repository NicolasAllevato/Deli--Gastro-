"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { buttonClasses } from "@/lib/buttonClasses";

type Message = {
  id: string;
  text: string;
  sender: "bot" | "user";
  isError?: boolean;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    { id: crypto.randomUUID(), text: "¡Hola! Soy tu asistente de Opsyn Dely. ¿En qué te puedo ayudar hoy? (Ej: '¿Dónde está mi pedido?' o 'Quiero ver el menú')", sender: "bot" },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");

    const withUser: Message[] = [
      ...messages,
      { id: crypto.randomUUID(), text: userMessage, sender: "user" },
    ];
    setMessages(withUser);
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage }),
      });

      const data = await res.json() as { reply?: string; error?: string };

      const replyText = data.reply
        ?? (data.error ? `Error del servicio: ${data.error}` : null)
        ?? (res.ok ? "No pude procesar tu mensaje. Intentá de nuevo." : `Error ${res.status}. Intentá más tarde.`);

      setMessages([
        ...withUser,
        { id: crypto.randomUUID(), text: replyText, sender: "bot", isError: !res.ok },
      ]);
    } catch {
      setMessages([
        ...withUser,
        { id: crypto.randomUUID(), text: "Sin conexión. Verificá tu red e intentá de nuevo.", sender: "bot", isError: true },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto h-[calc(100vh-6rem)] pb-6 flex flex-col">
      <div className="flex items-center gap-4 mb-6 flex-shrink-0">
        <Link
          href="/cliente"
          aria-label="Volver al inicio"
          className={buttonClasses("icon", "sm")}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">Soporte IA</h1>
          <p className="text-gray-500 text-xs mt-0.5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" aria-hidden />
            En línea
          </p>
        </div>
      </div>

      <div className="flex-1 neumorphic rounded-2xl overflow-hidden flex flex-col p-4 md:p-5">

        {/* Chat History */}
        <div
          role="log"
          aria-live="polite"
          aria-label="Conversación con el asistente"
          className="flex-1 overflow-y-auto space-y-5 pr-1"
        >
          {messages.map((msg) => (
            <div key={msg.id} className={`flex w-full ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`flex gap-2.5 max-w-[80%] ${msg.sender === "user" ? "flex-row-reverse" : "flex-row"}`}>

                <div className={`w-8 h-8 rounded-full neumorphic-inset flex items-center justify-center flex-shrink-0 ${msg.sender === "user" ? "text-brand-orange" : "text-brand-orange"}`} aria-hidden>
                  {msg.sender === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>

                <div className={`px-4 py-3 rounded-2xl text-sm ${
                  msg.sender === "user"
                    ? "bg-[#ede9fe] text-[#2e1065] rounded-tr-none"
                    : msg.isError
                      ? "bg-red-50 text-red-700 rounded-tl-none"
                      : "neumorphic-inset text-gray-700 rounded-tl-none"
                }`}>
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                </div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex w-full justify-start" aria-label="El asistente está escribiendo">
              <div className="flex gap-2.5 flex-row">
                <div className="w-8 h-8 rounded-full neumorphic-inset flex items-center justify-center flex-shrink-0 text-brand-orange" aria-hidden>
                  <Bot className="w-4 h-4" />
                </div>
                <div className="px-4 py-3 rounded-2xl neumorphic-inset rounded-tl-none">
                  <div className="flex gap-1" aria-hidden>
                    <span className="w-2 h-2 bg-gray-500 rounded-full motion-safe:animate-pulse" />
                    <span className="w-2 h-2 bg-gray-500 rounded-full motion-safe:animate-pulse" style={{ animationDelay: "0.2s" }} />
                    <span className="w-2 h-2 bg-gray-500 rounded-full motion-safe:animate-pulse" style={{ animationDelay: "0.4s" }} />
                  </div>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="mt-5 pt-4 border-t border-gray-200/60">
          <form onSubmit={handleSend} className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu mensaje..."
              disabled={isLoading}
              aria-label="Mensaje al asistente"
              autoComplete="off"
              className="w-full pl-4 pr-12 py-3 rounded-xl neumorphic-inset text-sm text-gray-700 placeholder-gray-500 outline-none focus:ring-2 focus:ring-brand-orange/40 transition-all disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              aria-label="Enviar mensaje"
              className="absolute right-2 p-2 btn-glow text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}
