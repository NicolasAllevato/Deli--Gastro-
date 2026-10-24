import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayLabel,
  filterConversations,
  formatRemaining,
  groupByDay,
  isWindowOpen,
  windowRemainingMs,
  type ConversationItem,
  type ThreadMessage,
} from "../src/app/admin/conversaciones/_components/conversation-utils.ts";
import { parseMessageBody } from "../src/lib/whatsapp/message-format.ts";

const NOW = Date.parse("2026-10-21T15:00:00-03:00");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const conv = (over: Partial<ConversationItem>): ConversationItem => ({
  id: "1",
  phone: "5491155550000",
  name: "Ana",
  humanTakeover: false,
  lastInboundAt: hoursAgo(1),
  last: { direction: "in", text: "Quiero una pizza", at: hoursAgo(1) },
  ...over,
});

test("ventana de 24 h: abierta, cerrada y sin mensajes del cliente", () => {
  assert.equal(isWindowOpen(hoursAgo(23), NOW), true);
  assert.equal(isWindowOpen(hoursAgo(25), NOW), false);
  assert.equal(isWindowOpen(null, NOW), false);
  assert.equal(windowRemainingMs("no-es-fecha", NOW), 0);
  assert.equal(formatRemaining(windowRemainingMs(hoursAgo(6), NOW)), "18 h");
  assert.equal(formatRemaining(45 * 60_000), "45 min");
  assert.equal(formatRemaining(10_000), "menos de 1 min");
});

test("filtros y búsqueda de conversaciones", () => {
  const list = [
    conv({ id: "a" }),
    conv({ id: "b", name: "Bruno", phone: "5491166660000", humanTakeover: true, lastInboundAt: hoursAgo(30) }),
  ];
  assert.deepEqual(filterConversations(list, "agente", "", NOW).map((c) => c.id), ["a"]);
  assert.deepEqual(filterConversations(list, "persona", "", NOW).map((c) => c.id), ["b"]);
  assert.deepEqual(filterConversations(list, "abiertas", "", NOW).map((c) => c.id), ["a"]);
  assert.deepEqual(filterConversations(list, "todas", "bru", NOW).map((c) => c.id), ["b"]);
  assert.deepEqual(filterConversations(list, "todas", "+54 9 11 6666", NOW).map((c) => c.id), ["b"]);
  assert.deepEqual(filterConversations(list, "todas", "pizza", NOW).map((c) => c.id), ["a", "b"]);
});

test("agrupa por día de Buenos Aires y rotula Hoy/Ayer", () => {
  const msg = (id: string, at: string): ThreadMessage => ({ id, direction: "in", type: "text", body: "x", status: null, tokens: null, created_at: at });
  const groups = groupByDay([msg("1", "2026-10-20T23:30:00-03:00"), msg("2", "2026-10-21T00:10:00-03:00"), msg("3", "2026-10-21T09:00:00-03:00")]);
  assert.deepEqual(groups.map((g) => g.messages.length), [1, 2]);
  assert.equal(dayLabel(groups[1].day, NOW), "Hoy");
  assert.equal(dayLabel(groups[0].day, NOW), "Ayer");
});

test("formato de WhatsApp portado de OpenWA", () => {
  assert.deepEqual(parseMessageBody("hola *mundo*"), [
    { type: "text", value: "hola " },
    { type: "bold", children: [{ type: "text", value: "mundo" }] },
  ]);
  assert.deepEqual(parseMessageBody("2*3*4"), [{ type: "text", value: "2*3*4" }]);
});
