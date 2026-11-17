param(
  [int]$Port = 8765,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)

$mimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.pdf'  = 'application/pdf'
  '.ico'  = 'image/x-icon'
}

$listener = $null
$boundPort = $Port
for ($attempt = 0; $attempt -lt 10; $attempt++) {
  $tryPort = $Port + $attempt
  $candidate = New-Object System.Net.HttpListener
  $candidate.Prefixes.Add("http://localhost:$tryPort/")
  try {
    $candidate.Start()
    $listener = $candidate
    $boundPort = $tryPort
    break
  } catch {
    $candidate.Close()
  }
}

if (-not $listener) {
  Write-Error "No se pudo iniciar el servidor local en los puertos $Port..$($Port + 9)."
  exit 1
}

$url = "http://localhost:$boundPort/"
Write-Host ""
Write-Host "  Servidor local activo en: $url" -ForegroundColor Green
Write-Host "  Carpeta: $root" -ForegroundColor DarkGray
Write-Host "  Presiona Ctrl+C o cierra esta ventana para detenerlo." -ForegroundColor Yellow
Write-Host ""

if (-not $NoBrowser) {
  Start-Process $url
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    try {
      $relPath = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath.TrimStart('/'))
      if ([string]::IsNullOrWhiteSpace($relPath)) {
        $relPath = 'index.html'
      }

      $candidatePath = [System.IO.Path]::GetFullPath((Join-Path $root $relPath))
      if (-not $candidatePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        $response.StatusCode = 403
        $response.Close()
        continue
      }

      if (-not (Test-Path -LiteralPath $candidatePath -PathType Leaf)) {
        $response.StatusCode = 404
        $notFound = [System.Text.Encoding]::UTF8.GetBytes('404 - No encontrado')
        $response.OutputStream.Write($notFound, 0, $notFound.Length)
        $response.Close()
        continue
      }

      $ext = [System.IO.Path]::GetExtension($candidatePath).ToLowerInvariant()
      $response.ContentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }
      $response.Headers.Add('Cache-Control', 'no-cache')

      $bytes = [System.IO.File]::ReadAllBytes($candidatePath)
      $response.ContentLength64 = $bytes.Length
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
      $response.Close()
    } catch {
      try {
        $response.StatusCode = 500
        $response.Close()
      } catch {}
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
