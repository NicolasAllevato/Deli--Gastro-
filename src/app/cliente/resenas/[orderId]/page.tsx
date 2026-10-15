"use client";

import { use, useState } from "react";
import { Star, Send, ExternalLink, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { buttonClasses } from "@/lib/buttonClasses";
import { formatOrderId } from "@/lib/orders";

export default function ResenaPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const [rating, setRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [feedback, setFeedback] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitReview = async (ratingValue: number, feedbackValue?: string) => {
    const res = await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, rating: ratingValue, feedback: feedbackValue }),
    });
    if (!res.ok) throw new Error("Error al guardar");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await submitReview(rating, feedback);
      setSubmitted(true);
    } catch {
      setError("No se pudo enviar la reseña. Intentá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="max-w-md mx-auto mt-10 text-center space-y-6">
        <div className="neumorphic p-6 sm:p-8 rounded-3xl">
          <div className="w-16 h-16 mx-auto bg-green-100 rounded-full neumorphic-inset flex items-center justify-center mb-4">
            <Star className="w-8 h-8 text-green-500 fill-green-500" />
          </div>
          <h2 className="font-headline font-black text-2xl text-gray-800">¡Gracias por tu reseña!</h2>
          <p className="text-gray-500 text-sm mt-2">Valoramos mucho tus comentarios para seguir mejorando.</p>
          <Link href="/cliente" className={`mt-8 inline-flex ${buttonClasses("secondary", "md")}`}>
            Volver al inicio
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6 pb-10">
      <div className="flex items-center gap-4">
        <Link
          href="/cliente"
          aria-label="Volver al inicio"
          className={buttonClasses("icon", "sm")}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="font-headline font-black text-xl text-gray-800 tracking-tight">Calificá tu pedido</h1>
          <p className="text-gray-500 text-xs mt-0.5">Pedido {formatOrderId(orderId)}</p>
        </div>
      </div>

      <div className="neumorphic p-5 sm:p-8 rounded-3xl text-center">
        <h2 className="font-headline font-bold text-base text-gray-700 mb-6">¿Cómo estuvo tu experiencia?</h2>

        <div className="flex justify-center gap-1.5 sm:gap-3 mb-8">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              aria-label={`Calificar con ${star} estrella${star !== 1 ? "s" : ""}`}
              aria-pressed={rating === star}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
              onClick={() => setRating(star)}
              className="p-1.5 sm:p-2 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/60 rounded-lg"
            >
              <Star
                className={`w-10 h-10 sm:w-12 sm:h-12 transition-colors duration-200 ${
                  star <= (hoverRating || rating)
                    ? "text-yellow-400 fill-yellow-400 drop-shadow-md"
                    : "text-gray-300"
                }`}
              />
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="mb-4 text-sm font-bold text-red-500">{error}</p>
        )}

        {rating > 0 && rating <= 3 && (
          <form onSubmit={handleSubmit} className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-4">
            <div className="text-left">
              <label htmlFor="resena-feedback" className="block text-xs font-bold text-gray-500 mb-2 ml-1 uppercase tracking-widest">
                ¿Qué podemos mejorar?
              </label>
              <textarea
                id="resena-feedback"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Escribe tus comentarios aquí..."
                rows={4}
                required
                className="w-full px-4 py-3 rounded-xl neumorphic-inset text-sm text-gray-700 placeholder-gray-500 outline-none focus:ring-2 focus:ring-brand-orange/40 transition-all resize-none"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm text-gray-700 neumorphic neumorphic-hover transition-all disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {submitting ? "Enviando..." : "Enviar Comentarios"}
            </button>
          </form>
        )}

        {rating >= 4 && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-5">
            <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 text-blue-800 text-sm">
              <p className="font-bold">¡Nos alegra que te haya gustado!</p>
              <p className="mt-1 text-blue-600">¿Nos ayudarías dejando una reseña en Google Maps?</p>
            </div>

            <a
              href="https://maps.google.com/?q=Deli+Gastro"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm text-white btn-glow transition-all"
              onClick={() => {
                // Fire-and-forget: usuario va a Google Maps mientras guardamos la reseña en background
                fetch("/api/reviews", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ orderId, rating }),
                }).catch(() => {/* best-effort */});
                setSubmitted(true);
              }}
            >
              <ExternalLink className="w-4 h-4" />
              Dejar Reseña en Google
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
