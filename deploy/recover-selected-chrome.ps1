# Files-only recovery for an already installed Windows VPS.
# Run in an elevated Windows PowerShell session. Does not execute any installer,
# change licensing, register tasks, reboot, or report a fabricated dashboard result.
param(
  [ValidatePattern('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')]
  [string]$RunId = '06b6faaf-88cd-be78-a4d4-6b8f1945d397'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http
$expectedHash = '2684f9be514e035224363ed120077dfbe09975a90c35126d188aeec4aff42d1e'
$expectedBytes = [int64]13283768
$url = 'https://testing.d3m0nbox.online/api/installer/assets/chrome/' + $expectedHash + '/ChromeSetup.exe'
$folder = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) ('Win11Desk Installers\' + $RunId)
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$destination = Join-Path $folder 'ChromeSetup.exe'
$partial = Join-Path $folder ('ChromeSetup-' + [guid]::NewGuid().ToString('N') + '.partial.exe')
function Assert-ExactChrome([string]$path) {
  if ((Get-Item -LiteralPath $path).Length -ne $expectedBytes) { throw 'SIZE_MISMATCH' }
  if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'SHA256_MISMATCH' }
  $signature = Get-AuthenticodeSignature -FilePath $path
  if ($signature.Status -ne 'Valid') { throw 'SIGNATURE_INVALID: check Windows clock/certificate trust; do not disable verification.' }
  if ($signature.SignerCertificate.Subject -notmatch '(^|,)\s*CN=Google LLC(?:,|$)') { throw 'PUBLISHER_MISMATCH' }
}
if (Test-Path -LiteralPath $destination -PathType Leaf) {
  try { Assert-ExactChrome $destination; Write-Output ('ChromeSetup.exe already verified in: ' + $folder); return } catch { }
}
$handler = New-Object Net.Http.HttpClientHandler
$handler.AllowAutoRedirect = $false
$client = New-Object Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromSeconds(30)
$response = $null; $stream = $null; $output = $null
try {
  Write-Output 'Downloading the exact selected Chrome file (download only)...'
  $response = $client.GetAsync($url, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
  if (-not $response.IsSuccessStatusCode) { throw 'HTTP_STATUS' }
  if ($response.Content.Headers.ContentLength -and [int64]$response.Content.Headers.ContentLength -ne $expectedBytes) { throw 'SIZE_MISMATCH' }
  $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
  $output = New-Object IO.FileStream($partial,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  $buffer = New-Object byte[] 65536
  $timer = [Diagnostics.Stopwatch]::StartNew()
  [int64]$total = 0
  while ($true) {
    if ($timer.Elapsed.TotalSeconds -gt 300) { throw 'DOWNLOAD_DEADLINE' }
    $cts = New-Object Threading.CancellationTokenSource
    $cts.CancelAfter(15000)
    try { $n = $stream.ReadAsync($buffer,0,$buffer.Length,$cts.Token).GetAwaiter().GetResult() } finally { $cts.Dispose() }
    if ($n -le 0) { break }
    $total += $n
    if ($total -gt $expectedBytes) { throw 'SIZE_LIMIT' }
    $output.Write($buffer,0,$n)
  }
  $output.Dispose(); $output = $null
  $stream.Dispose(); $stream = $null
  Assert-ExactChrome $partial
  Move-Item -LiteralPath $partial -Destination $destination -Force
  Write-Output ('Verified ChromeSetup.exe saved in: ' + $folder)
  Write-Output 'No program or licensing script was executed. No reboot or installation was performed.'
} finally {
  if ($null -ne $output) { $output.Dispose() }
  if ($null -ne $stream) { $stream.Dispose() }
  if ($null -ne $response) { $response.Dispose() }
  $client.Dispose()
  Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
}
