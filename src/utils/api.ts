export async function sendToDispatcher(action: string, payload: Record<string, unknown>) {
  const response = await fetch("/api/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, data: payload }),
  });

  if (!response.ok) {
    throw new Error(`Dispatcher error: ${response.statusText}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error("Dispatcher returned non-JSON response");
  }
}
