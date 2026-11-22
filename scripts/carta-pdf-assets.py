"""
Genera src/lib/carta-pdf/assets.generated.ts a partir de la carta impresa del dueño y de las fuentes Lora.

Uso (PyMuPDF instalado):
  python -I scripts/carta-pdf-assets.py <carta_original.pdf> <carpeta_con_Lora-Regular/Bold/Italic.ttf>

Extrae las imágenes de la carta original (marco fileteado, logo, jugador, marco de la hoja 2 y su pie),
las achica, separa color (JPEG, DCTDecode) y transparencia (escala de grises comprimida, FlateDecode) y deja
todo en base64 para que el PDF se arme sin leer archivos (corre igual en Workers). Las fuentes se embeben
comprimidas con sus anchos WinAnsi (32..255) para alinear precios exactos.
"""
import base64
import sys
import zlib
from pathlib import Path

import fitz

OUT = Path(__file__).resolve().parent.parent / "src" / "lib" / "carta-pdf" / "assets.generated.ts"

# xref de la imagen, xref de su máscara (0 = sin máscara), nombre, ancho máximo en píxeles
IMAGES = [
    (58, 57, "marco", 900),      # hoja 1: marco completo con la pelota abajo
    (41, 49, "logo", 520),       # "La Gambeta" en rojo
    (48, 47, "jugador", 400),    # jugador de fondo a la derecha
    (8, 7, "marcoSuperior", 900),  # hojas 2+: esquinas de arriba y laterales
    (9, 0, "pie", 600),          # hojas 2+: fileteado rojo de abajo (JPEG sin transparencia: se recorta el fondo)
]


def keyed_alpha(pix: fitz.Pixmap) -> bytes:
    """Transparencia por distancia al color de fondo (esquina superior izquierda)."""
    bg = pix.pixel(2, 2)[:3]
    s = pix.samples
    w, h = pix.width, pix.height
    out = bytearray(w * h)
    for i in range(w * h):
        x, y = i % w, i // w
        # El centro del pie trae un texto de historia que en la carta original no se ve: solo quedan las
        # esquinas y la guarda de abajo.
        if 0.09 * w < x < 0.91 * w and y < 0.86 * h:
            continue
        r, g, b = s[i * 3], s[i * 3 + 1], s[i * 3 + 2]
        d = abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])
        out[i] = 0 if d < 18 else min(255, (d - 18) * 6)
    return bytes(out)


# Restos de la carta original pegados en la imagen del jugador (en píxeles de la imagen de 389x601): la pelota
# clara a su izquierda y la firma suelta abajo. Se borran de la transparencia.
JUGADOR_RESTOS = [
    (0, 250, 82, 342),   # pelota fantasma
    (0, 425, 88, 446),   # firma (parte de arriba, sin tocar la media)
    (0, 446, 118, 452),  # firma (resto)
    (0, 452, 145, 505),  # firma (trazo final, antes del botín)
]


def clear_regions(alpha: bytes, w: int, regions: list[tuple[int, int, int, int]]) -> bytes:
    out = bytearray(alpha)
    for x0, y0, x1, y1 in regions:
        for y in range(y0, y1):
            out[y * w + x0 : y * w + x1] = bytes(x1 - x0)
    return bytes(out)


def image_entry(doc: fitz.Document, xref: int, mask: int, max_w: int, name: str = "") -> dict:
    pix = fitz.Pixmap(doc, xref)
    if mask:
        pix = fitz.Pixmap(pix, fitz.Pixmap(doc, mask))
    if pix.width > max_w:
        factor = 1
        while pix.width // factor > max_w:
            factor *= 2
        if factor > 1:
            pix.shrink(factor.bit_length() - 1)
    rgb = fitz.Pixmap(pix, 0) if pix.alpha else pix
    alpha = pix.samples[pix.n - 1 :: pix.n] if pix.alpha else keyed_alpha(rgb)
    if name == "jugador":
        alpha = clear_regions(bytes(alpha), rgb.width, JUGADOR_RESTOS)
    jpeg = rgb.tobytes("jpeg", jpg_quality=78)
    return {
        "w": rgb.width,
        "h": rgb.height,
        "jpeg": base64.b64encode(jpeg).decode(),
        "alpha": base64.b64encode(zlib.compress(bytes(alpha), 9)).decode(),
    }


def font_entry(path: Path) -> dict:
    data = path.read_bytes()
    font = fitz.Font(fontfile=str(path))
    widths = []
    for code in range(32, 256):
        try:
            ch = bytes([code]).decode("cp1252")
            widths.append(round(font.glyph_advance(ord(ch)) * 1000))
        except UnicodeDecodeError:
            widths.append(0)
    return {
        "file": base64.b64encode(zlib.compress(data, 9)).decode(),
        "length": len(data),
        "widths": widths,
        "ascent": round(font.ascender * 1000),
        "descent": round(font.descender * 1000),
    }


def main() -> None:
    pdf, fonts_dir = Path(sys.argv[1]), Path(sys.argv[2])
    doc = fitz.open(str(pdf))
    lines = [
        "// Generado por scripts/carta-pdf-assets.py: imágenes de la carta original del local y fuentes Lora (OFL).",
        "// No editar a mano.",
        "export interface CartaImageAsset { w: number; h: number; jpeg: string; alpha: string }",
        "export interface CartaFontAsset { file: string; length: number; widths: number[]; ascent: number; descent: number }",
    ]
    for xref, mask, name, max_w in IMAGES:
        e = image_entry(doc, xref, mask, max_w, name)
        lines.append(
            f'export const {name}: CartaImageAsset = {{ w: {e["w"]}, h: {e["h"]}, jpeg: "{e["jpeg"]}", alpha: "{e["alpha"]}" }};'
        )
    for style in ("Regular", "Bold", "Italic"):
        e = font_entry(fonts_dir / f"Lora-{style}.ttf")
        lines.append(
            f'export const lora{style}: CartaFontAsset = {{ file: "{e["file"]}", length: {e["length"]}, '
            f'widths: {e["widths"]}, ascent: {e["ascent"]}, descent: {e["descent"]} }};'
        )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(OUT, OUT.stat().st_size)


if __name__ == "__main__":
    main()
