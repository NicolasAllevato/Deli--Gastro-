"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

export function CourierSignOut() {
  const router = useRouter();

  const signOut = async () => {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={signOut}
      aria-label="Cerrar sesión"
      title="Cerrar sesión"
      className="p-2.5 rounded-xl neumorphic-hover text-gray-500 hover:text-red-500 transition-colors"
    >
      <LogOut size={18} aria-hidden />
    </button>
  );
}
