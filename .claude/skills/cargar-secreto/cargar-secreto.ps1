# Abre una ventana aparte para pegar un secreto y lo escribe en el .env indicado.
# El valor nunca se imprime: la salida solo dice si se guardó y cuántos caracteres tiene.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File cargar-secreto.ps1 -Nombre CLOUDFLARE_ZONE_TOKEN [-Archivo .env.local] [-Ayuda "texto"]
param(
  [Parameter(Mandatory = $true)][string]$Nombre,
  [string]$Archivo = ".env.local",
  [string]$Ayuda = ""
)
$ErrorActionPreference = "Stop"

if ($Nombre -notmatch '^[A-Z][A-Z0-9_]{1,63}$') {
  Write-Output "ERROR: nombre inválido (solo MAYÚSCULAS, números y _)."
  exit 2
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "Cargar secreto - $Nombre"
$form.Size = New-Object System.Drawing.Size(520, 230)
$form.StartPosition = "CenterScreen"
$form.TopMost = $true
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false

$label = New-Object System.Windows.Forms.Label
$label.Location = New-Object System.Drawing.Point(15, 15)
$label.Size = New-Object System.Drawing.Size(480, 50)
$label.Text = "Pegá el valor de $Nombre. Se guarda en $Archivo y no se muestra en ningún lado.`n$Ayuda"
$form.Controls.Add($label)

$box = New-Object System.Windows.Forms.TextBox
$box.Location = New-Object System.Drawing.Point(15, 75)
$box.Size = New-Object System.Drawing.Size(475, 25)
$box.UseSystemPasswordChar = $true
$form.Controls.Add($box)

$show = New-Object System.Windows.Forms.CheckBox
$show.Location = New-Object System.Drawing.Point(15, 108)
$show.Size = New-Object System.Drawing.Size(200, 22)
$show.Text = "Mostrar mientras escribo"
$show.Add_CheckedChanged({ $box.UseSystemPasswordChar = -not $show.Checked })
$form.Controls.Add($show)

$ok = New-Object System.Windows.Forms.Button
$ok.Location = New-Object System.Drawing.Point(300, 140)
$ok.Size = New-Object System.Drawing.Size(90, 30)
$ok.Text = "Guardar"
$ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.AcceptButton = $ok
$form.Controls.Add($ok)

$cancel = New-Object System.Windows.Forms.Button
$cancel.Location = New-Object System.Drawing.Point(400, 140)
$cancel.Size = New-Object System.Drawing.Size(90, 30)
$cancel.Text = "Cancelar"
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.CancelButton = $cancel
$form.Controls.Add($cancel)

$form.Add_Shown({ $form.Activate(); $box.Focus() })
$result = $form.ShowDialog()

if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
  Write-Output "CANCELADO: no se cambió nada."
  exit 1
}
$valor = $box.Text.Trim()
if ([string]::IsNullOrEmpty($valor)) {
  Write-Output "CANCELADO: valor vacío, no se cambió nada."
  exit 1
}
if ($valor -match '[\r\n]') {
  Write-Output "ERROR: el valor tiene saltos de línea."
  exit 2
}

$ruta = if ([System.IO.Path]::IsPathRooted($Archivo)) { $Archivo } else { Join-Path (Get-Location) $Archivo }
$lineas = @()
if (Test-Path $ruta) { $lineas = [System.IO.File]::ReadAllLines($ruta) }
$nueva = "$Nombre=`"$valor`""
$reemplazada = $false
$salida = foreach ($l in $lineas) {
  if ($l -match "^\s*$Nombre\s*=") {
    if (-not $reemplazada) { $reemplazada = $true; $nueva }
  } else { $l }
}
if (-not $reemplazada) { $salida = @($salida) + $nueva }
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($ruta, [string[]]$salida, $utf8)

$accion = if ($reemplazada) { "reemplazado" } else { "agregado" }
Write-Output "GUARDADO: $Nombre $accion en $Archivo ($($valor.Length) caracteres)."
exit 0
