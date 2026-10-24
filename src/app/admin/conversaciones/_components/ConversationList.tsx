"use client";

import { useMemo, useState } from "react";
import { Clock, Hand, Search } from "lucide-react";
import {
  CONVERSATION_FILTERS,
  filterConversations,
  isWindowOpen,
  type ConversationFilter,
  type ConversationItem,
} from "./conversation-utils";

interface ConversationListProps {
  list: ConversationItem[];
  loaded: boolean;
  selected: string | null;
  now: number;
  onSelect: (id: string) => void;
}

const shortTime = (iso: string, now: number) => {
  const d = new Date(iso);
  return now - d.getTime() < 24 * 3_600_000
    ? d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
};

export function ConversationList({ list, loaded, selected, now, onSelect }: ConversationListProps) {
  const [filter, setFilter] = useState<ConversationFilter>("todas");
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterConversations(list, filter, query, now), [list, filter, query, now]);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 px-3 py-2 rounded-xl neumorphic-inset">
        <Search size={14} className="text-gray-500 shrink-0" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar nombre, teléfono o mensaje"
          aria-label="Buscar conversaciones"
          className="flex-1 min-w-0 bg-transparent text-sm text-gray-700 placeholder-gray-500 outline-none"
        />
      </label>

      <div role="group" aria-label="Filtrar conversaciones" className="flex flex-wrap gap-1.5">
        {CONVERSATION_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${filter === f.id ? "bg-brand-orange text-white" : "neumorphic text-gray-600"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loaded && visible.length === 0 && (
        <div className="neumorphic-inset rounded-xl p-6 text-center text-sm text-gray-500">
          {list.length === 0 ? "Todavía no hay conversaciones." : "Ninguna conversación coincide."}
        </div>
      )}

      <ul className="space-y-2">
        {visible.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              aria-current={selected === c.id}
              className={`w-full text-left rounded-xl p-3 ${selected === c.id ? "neumorphic-inset" : "neumorphic neumorphic-hover"}`}
            >
              <span className="flex items-center gap-2">
                <span className="flex-1 font-bold text-sm text-gray-800 truncate">{c.name}</span>
                {c.humanTakeover && <Hand size={13} className="text-brand-orange shrink-0" aria-label="Atiende una persona" />}
                {isWindowOpen(c.lastInboundAt, now) && <Clock size={13} className="text-green-600 shrink-0" aria-label="Ventana de 24 h abierta" />}
                {c.last && <span className="text-[10px] text-gray-500 shrink-0">{shortTime(c.last.at, now)}</span>}
              </span>
              <span className="block text-xs text-gray-500 truncate mt-0.5">
                {c.last ? `${c.last.direction === "out" ? "Vos: " : ""}${c.last.text}` : "Sin mensajes"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
