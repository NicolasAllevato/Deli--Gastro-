import { Fragment, type ReactNode } from "react";
import { parseMessageBody, type MessageNode } from "@/lib/whatsapp/message-format";

function renderNodes(nodes: MessageNode[]): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
      case "mention":
        return <Fragment key={i}>{node.value}</Fragment>;
      case "bold":
        return <strong key={i}>{renderNodes(node.children)}</strong>;
      case "italic":
        return <em key={i}>{renderNodes(node.children)}</em>;
      case "strike":
        return <s key={i}>{renderNodes(node.children)}</s>;
      case "code":
        return <code key={i} className="font-mono text-[0.85em] px-1 rounded bg-black/10">{node.value}</code>;
      case "codeblock":
        return <pre key={i} className="font-mono text-[0.85em] p-2 my-1 rounded bg-black/10 whitespace-pre-wrap">{node.value}</pre>;
    }
  });
}

/** Texto con el formato de WhatsApp (*negrita*, _cursiva_, ~tachado~, `código`). React escapa todo el contenido. */
export function FormattedText({ text }: { text: string }) {
  return <>{renderNodes(parseMessageBody(text))}</>;
}
