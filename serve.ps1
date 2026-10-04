# Servidor local simples (sem Node/Python). Uso: .\serve.ps1  ->  http://localhost:8080  | salva os dados em data.json e backups\
$port = 8080
$root = $PSScriptRoot
$dataFile = Join-Path $root 'data.json'
$backupDir = Join-Path $root 'backups'
$types = @{ '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.json'='application/json'; '.svg'='image/svg+xml'; '.png'='image/png'; '.ico'='image/x-icon' }
$l = [System.Net.HttpListener]::new()
$l.Prefixes.Add("http://localhost:$port/")
$l.Start()
Write-Host "Painel rodando em http://localhost:$port  (Ctrl+C para parar)"
try {
  while ($l.IsListening) {
    $ctx = $l.GetContext()
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if (-not $path) { $path = 'index.html' }
    if ($path -eq 'api/data') {
      if ($ctx.Request.HttpMethod -eq 'POST') {
        $body = [IO.StreamReader]::new($ctx.Request.InputStream, [Text.Encoding]::UTF8).ReadToEnd()
        try {
          $null = $body | ConvertFrom-Json
          [IO.File]::WriteAllText($dataFile, $body, [Text.UTF8Encoding]::new($false))
          if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory $backupDir | Out-Null }
          [IO.File]::WriteAllText((Join-Path $backupDir ("data-" + (Get-Date -Format 'yyyy-MM-dd') + ".json")), $body, [Text.UTF8Encoding]::new($false))
          $ctx.Response.StatusCode = 204
        } catch { $ctx.Response.StatusCode = 400 }
      } elseif (Test-Path $dataFile) {
        $bytes = [IO.File]::ReadAllBytes($dataFile)
        $ctx.Response.ContentType = 'application/json'
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else { $ctx.Response.StatusCode = 404 }
      $ctx.Response.Close(); continue
    }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path))
    if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $ctx.Response.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
      $ctx.Response.Headers.Add('Cache-Control', 'no-store')
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $ctx.Response.StatusCode = 404 }
    $ctx.Response.Close()
  }
} finally { $l.Stop() }

