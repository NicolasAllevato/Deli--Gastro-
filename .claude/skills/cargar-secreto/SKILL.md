---
name: cargar-secreto
description: Abre una ventana aparte para que el usuario pegue un token, API key o contraseña y lo escribe directo en .env.local (o el .env indicado) sin que el valor pase por el chat. Usar SIEMPRE que haga falta cargar o rotar un secreto, en vez de pedir que lo peguen en el chat.
---

# Cargar secreto

El valor nunca pasa por el chat ni por la salida de comandos. Claude solo ve "GUARDADO", "CANCELADO" o "ERROR".

## Uso

`/cargar-secreto NOMBRE [archivo] [ayuda]`

1. Validá que `NOMBRE` sea MAYÚSCULAS, números y `_`. El archivo por defecto es `.env.local` en la raíz del proyecto.
2. Avisale al usuario en una línea qué secreto va a pegar y de dónde lo saca (por ejemplo el link del dashboard).
3. Corré con la herramienta PowerShell, desde la raíz del proyecto (se abre una ventana y espera):

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .claude/skills/cargar-secreto/cargar-secreto.ps1 -Nombre NOMBRE -Archivo .env.local -Ayuda "De dónde sacarlo"
   ```

   Usá un timeout largo (por ejemplo 600000 ms): la ventana queda abierta hasta que el usuario guarda o cancela.
4. Respondé según la salida:
   - `GUARDADO`: confirmá el nombre y el archivo, nunca el valor.
   - `CANCELADO`: no se cambió nada; preguntá si quiere reintentar.
   - `ERROR`: explicá el motivo.

## Reglas

- Nunca leas, imprimas ni muestres el valor después (`cat`, `grep` del valor, `echo`). Para usarlo en un comando, leelo dentro del mismo comando sin imprimirlo.
- Si ya hay una línea activa `NOMBRE=` se reemplaza; las comentadas (`# NOMBRE=`) no se tocan. El resto del archivo queda igual (UTF-8 sin BOM).
- Para Worker secrets de Cloudflare, después de guardarlo podés subirlo con `wrangler secret put` leyendo el valor desde el archivo dentro del mismo comando.
