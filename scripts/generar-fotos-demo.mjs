// Genera las fotos de muestra de la carta demo con Gemini y las guarda en public/demo/productos/.
// Uso: GEMINI_API_KEY=... node scripts/generar-fotos-demo.mjs [--forzar]
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";
const OUT_DIR = path.join(process.cwd(), "public", "demo", "productos");
const FORCE = process.argv.includes("--forzar");

const STYLE =
  "Professional food photography for a delivery app menu, 3:2 landscape, appetizing, " +
  "warm natural light, shallow depth of field, rustic dark wood table, top 3/4 angle, " +
  "no text, no logos, no hands, no people.";

const PRODUCTS = [
  ["burger-clasica", "a classic beef burger with cheddar, lettuce and tomato on a brioche bun"],
  ["burger-bbq", "a double beef burger with crispy bacon and glossy BBQ sauce"],
  ["burger-veggie", "a chickpea patty veggie burger with avocado slices and arugula"],
  ["pizza-margarita", "a Neapolitan margherita pizza with tomato sauce, mozzarella and fresh basil"],
  ["pizza-napo", "an Argentine napolitana pizza with mozzarella, fresh tomato slices, garlic and oregano"],
  ["pizza-pepperoni", "a pepperoni pizza with melted mozzarella and spicy pepperoni"],
  ["papas-cheddar", "a large portion of french fries covered in melted cheddar cheese"],
  ["aros-cebolla", "golden crispy battered onion rings with a small bowl of ranch dip"],
  ["limonada", "a tall glass of fresh lemonade with mint leaves and ice"],
  ["cerveza-ipa", "a pint glass of amber craft IPA beer with foam"],
  ["volcan-cacao", "a chocolate lava cake with a scoop of vanilla ice cream"],
  ["cheesecake", "a slice of cheesecake topped with red berries"],
];

const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
if (!key) {
  console.error("Falta GEMINI_API_KEY.");
  process.exit(1);
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function generate(prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${prompt}. ${STYLE}` }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:2" } },
      }),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error("Gemini no devolvió imagen.");
  return { buffer: Buffer.from(part.inlineData.data, "base64"), mime: part.inlineData.mimeType };
}

await mkdir(OUT_DIR, { recursive: true });
let failed = 0;
for (const [seed, prompt] of PRODUCTS) {
  const file = path.join(OUT_DIR, `${seed}.jpg`);
  if (!FORCE && (await exists(file))) { console.log(`= ${seed} (ya existe)`); continue; }
  try {
    const { buffer } = await generate(prompt);
    // Gemini devuelve PNG de ~1,6 MB: se achica a JPG de ~70 KB para la carta.
    const jpg = await sharp(buffer).resize(900).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    await writeFile(file, jpg);
    console.log(`✓ ${seed} (${Math.round(jpg.length / 1024)} KB)`);
  } catch (error) {
    failed++;
    console.error(`✗ ${seed}: ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);
