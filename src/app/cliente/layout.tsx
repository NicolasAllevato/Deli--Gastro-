import Link from "next/link";
import Image from "next/image";
import { Menu, MessageCircle } from "lucide-react";
import { ClienteBottomNav } from "./_components/ClienteBottomNav";
import { CartProvider } from "./_components/CartProvider";
import { CartBar } from "./_components/CartBar";

export default function ClienteLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
    <div className="bg-surface text-on-surface font-body min-h-screen">

      {/* TopBar */}
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-gray-100/80">
        <div className="flex items-center justify-between px-5 py-3">
          <button aria-label="Menú" className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 transition-colors">
            <Menu size={20} />
          </button>
          <h1 className="font-headline text-lg font-black text-gray-900">
            Deli<span className="text-brand-orange">-</span>Gastro
          </h1>
          <div className="w-8 h-8 rounded-full overflow-hidden relative ring-2 ring-gray-100">
            <Image alt="Avatar" fill sizes="32px" className="object-cover" src="https://picsum.photos/seed/user-avatar/64/64" />
          </div>
        </div>
      </header>

      {/* Page content — padding-bottom para que no quede debajo del nav */}
      <main className="pb-28">
        <div className="max-w-2xl mx-auto">
          {children}
        </div>
      </main>

      {/* Chat button flotante */}
      <Link
        href="/cliente/chat"
        aria-label="Asistente virtual"
        className="fixed bottom-20 right-5 w-12 h-12 bg-white/90 backdrop-blur-md rounded-full shadow-[0_4px_16px_rgba(163,177,198,0.35)] border border-white/50 flex items-center justify-center z-40 hover:scale-110 active:scale-95 transition-transform duration-200"
      >
        <MessageCircle size={20} className="text-brand-orange" />
      </Link>

      <CartBar />
      <ClienteBottomNav />
    </div>
    </CartProvider>
  );
}
