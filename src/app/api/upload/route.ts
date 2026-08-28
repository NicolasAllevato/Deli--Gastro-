import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { rateLimit, getClientIp } from "@/utils/rate-limit";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

const uploadResponseSchema = z.object({
  success: z.literal(true),
  url: z.string().url(),
});
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

function getR2Client(): S3Client {
  const accountEndpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountEndpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 no configurado: falta R2_ENDPOINT, R2_ACCESS_KEY_ID o R2_SECRET_ACCESS_KEY en las variables de entorno.",
    );
  }

  return new S3Client({
    region: "auto",
    endpoint: accountEndpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function extensionFor(mimeType: string): string {
  const subtype = mimeType.split("/")[1];
  return subtype === "jpeg" ? "jpg" : subtype;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await rateLimit(getClientIp(request), 20, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireRole("admin");
  if (isAuthorizationError(auth)) return auth.error;

  let file: File;
  try {
    const formData = await request.formData();
    const candidate = formData.get("file");
    if (!(candidate instanceof File)) {
      return NextResponse.json({ error: "Archivo requerido." }, { status: 400 });
    }
    file = candidate;
  } catch {
    return NextResponse.json({ error: "No se pudo leer el formulario." }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) {
    return NextResponse.json(
      { error: "Tipo de archivo no permitido. Usá JPG, PNG o WEBP." },
      { status: 400 },
    );
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "El archivo supera el límite de 5MB." }, { status: 400 });
  }

  const bucketName = process.env.R2_BUCKET_NAME;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;

  if (!bucketName || !publicBaseUrl) {
    return NextResponse.json({ error: "R2 no configurado en el servidor." }, { status: 500 });
  }

  try {
    const key = `productos/${crypto.randomUUID()}.${extensionFor(file.type)}`;
    const arrayBuffer = await file.arrayBuffer();

    const client = getR2Client();
    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: new Uint8Array(arrayBuffer),
        ContentType: file.type,
      }),
    );

    const url = `${publicBaseUrl.replace(/\/$/, "")}/${key}`;
    const payload = uploadResponseSchema.parse({ success: true, url });
    return NextResponse.json(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error desconocido subiendo el archivo.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
