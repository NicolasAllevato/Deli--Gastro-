-- Etapa 3 del corte: la marca de Términos y Privacidad aceptados pasa de
-- auth.users.app_metadata.legal_version a una columna de "user" que solo
-- escribe el servidor (campo adicional de Better Auth con input:false).
ALTER TABLE "user" ADD COLUMN legal_version TEXT;
