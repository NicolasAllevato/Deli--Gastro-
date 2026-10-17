import { Bike } from "lucide-react";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { courierDisplayName } from "@/lib/auth/courier";
import { getUserRole } from "@/lib/auth/roles";
import { SignOutButton } from "@/components/ui/SignOutButton";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export default async function RepartidorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (getUserRole(user) !== "repartidor") redirect("/");

  return (
    <div className="bg-surface text-on-surface font-body min-h-screen">
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-gray-100/80">
        <div className="max-w-2xl mx-auto flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl neumorphic-inset flex items-center justify-center text-brand-orange">
              <Bike size={18} aria-hidden />
            </span>
            <div>
              <h1 className="font-headline text-base font-black text-gray-900 leading-tight">
                Opsyn <span className="text-brand-orange">Dely</span> · Reparto
              </h1>
              <p className="text-[11px] text-gray-500">{courierDisplayName(user)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle compact />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6 pb-16">{children}</main>
    </div>
  );
}
