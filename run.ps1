# HoloAirDesk AI launcher for Windows PowerShell.
#
#   .\run.ps1
#   $env:HOLO_LLM_MODEL = 'models\my-small-lfm.gguf'; .\run.ps1
#   .\run.ps1 -Lan
#
# Override executable locations when they are not on PATH:
#   $env:HOLO_LLAMA_SERVER = (Resolve-Path .\tools\llama\llama-server.exe).Path
#   $env:HOLO_WHISPER_SERVER = (Resolve-Path .\third_party\whisper.cpp\build\bin\Release\whisper-server.exe).Path

[CmdletBinding()]
param(
    [switch]$Lan
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Get-CommandPath([string]$Name, [string]$EnvironmentVariable) {
    $override = [Environment]::GetEnvironmentVariable($EnvironmentVariable)
    if ($override) {
        if (-not (Test-Path -LiteralPath $override -PathType Leaf)) {
            throw "$EnvironmentVariable points to a file that does not exist: $override"
        }
        return (Resolve-Path -LiteralPath $override).Path
    }

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "$Name was not found. Add its folder to PATH or set `$env:$EnvironmentVariable to its full path."
    }
    return $command.Source
}

function Get-ModelPath([string]$EnvironmentVariable, [string]$DefaultPath) {
    $path = [Environment]::GetEnvironmentVariable($EnvironmentVariable)
    if (-not $path) {
        $path = $DefaultPath
    }
    if (-not [System.IO.Path]::IsPathRooted($path)) {
        $path = Join-Path $PSScriptRoot $path
    }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Model not found: $path`nSet `$env:$EnvironmentVariable to the model file you downloaded."
    }
    return (Resolve-Path -LiteralPath $path).Path
}

function Quote-Argument([string]$Value) {
    '"' + $Value.Replace('"', '\"') + '"'
}

$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    throw "No .venv found. Create it with:`n  py -3.12 -m venv .venv`n  .\.venv\Scripts\python.exe -m pip install -r requirements.txt"
}

$appPort = if ($env:HOLO_PORT) { $env:HOLO_PORT } else { '8000' }
$llamaPort = '8080'
$whisperPort = '8091'
if ($env:HOLO_MODEL -eq 'qwen') {
    $defaultLlm = 'models\Qwen3.5-4B-Q8_0.gguf'
}
elseif (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'models\LFM2.5-2.6B-Q8_0.gguf') -PathType Leaf) {
    $defaultLlm = 'models\LFM2.5-2.6B-Q8_0.gguf'
}
elseif (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'models\LFM2.5-1.2B-Thinking-Q8_0.gguf') -PathType Leaf) {
    # Useful lower-memory fallback when the original 2.6B model is not present.
    $defaultLlm = 'models\LFM2.5-1.2B-Thinking-Q8_0.gguf'
}
else {
    $defaultLlm = 'models\LFM2.5-2.6B-Q8_0.gguf'
}
$llmModel = Get-ModelPath 'HOLO_LLM_MODEL' $defaultLlm
$whisperModel = Get-ModelPath 'HOLO_WHISPER_MODEL' 'models\ggml-large-v3-turbo-q5_0.bin'
$llamaServer = Get-CommandPath 'llama-server.exe' 'HOLO_LLAMA_SERVER'
$whisperServer = Get-CommandPath 'whisper-server.exe' 'HOLO_WHISPER_SERVER'
# Pass an absolute path to the Python process so transcription does not depend
# on how a package manager updated PATH in a particular PowerShell window.
$env:HOLO_FFMPEG = Get-CommandPath 'ffmpeg.exe' 'HOLO_FFMPEG'
$gpuLayers = if ($null -ne $env:HOLO_GPU_LAYERS) { $env:HOLO_GPU_LAYERS } else { '0' }
$whisperThreads = if ($env:HOLO_WHISPER_THREADS) { $env:HOLO_WHISPER_THREADS } else { [Math]::Max(1, [Environment]::ProcessorCount - 1).ToString() }
$whisperUseGpu = $env:HOLO_WHISPER_GPU -eq '1'

New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot 'logs') -Force | Out-Null

Write-Host "[holoairdesk] starting llama-server ($llmModel) on :$llamaPort"
$llamaArgs = @('-m', (Quote-Argument $llmModel), '--host', '127.0.0.1', '--port', $llamaPort, '-c', '16384', '-ngl', $gpuLayers, '--jinja')
$llamaProcess = Start-Process -FilePath $llamaServer -ArgumentList $llamaArgs -WorkingDirectory $PSScriptRoot -NoNewWindow -PassThru `
    -RedirectStandardOutput (Join-Path $PSScriptRoot 'logs\llama.log') `
    -RedirectStandardError (Join-Path $PSScriptRoot 'logs\llama-error.log')

try {
    Write-Host "[holoairdesk] starting whisper-server ($whisperModel) on :$whisperPort"
    $whisperArgs = @('-m', (Quote-Argument $whisperModel), '--host', '127.0.0.1', '--port', $whisperPort, '-t', $whisperThreads)
    if (-not $whisperUseGpu) { $whisperArgs += '-ng' }
    $whisperProcess = Start-Process -FilePath $whisperServer -ArgumentList $whisperArgs -WorkingDirectory $PSScriptRoot -NoNewWindow -PassThru `
        -RedirectStandardOutput (Join-Path $PSScriptRoot 'logs\whisper.log') `
        -RedirectStandardError (Join-Path $PSScriptRoot 'logs\whisper-error.log')

    if ($Lan) {
        New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot 'certs') -Force | Out-Null
        $cert = Join-Path $PSScriptRoot 'certs\holo.crt'
        $key = Join-Path $PSScriptRoot 'certs\holo.key'
        if (-not (Test-Path -LiteralPath $cert) -or -not (Test-Path -LiteralPath $key)) {
            $openssl = Get-Command openssl.exe -ErrorAction SilentlyContinue
            if (-not $openssl) {
                throw "-Lan needs OpenSSL to create certs\holo.crt. Install OpenSSL, then run this command again."
            }
            & $openssl.Source req -x509 -newkey rsa:2048 -nodes -days 365 -keyout $key -out $cert -subj '/CN=holoairdesk.local'
            if ($LASTEXITCODE -ne 0) { throw 'OpenSSL could not create the development certificate.' }
        }
        $lanIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.AddressState -eq 'Preferred' } |
            Select-Object -First 1 -ExpandProperty IPAddress)
        if (-not $lanIp) { $lanIp = 'YOUR-LAN-IP' }
        Write-Host "[holoairdesk] app on https://$lanIp`:8443 (accept the self-signed certificate)"
        & $python -m uvicorn server.main:app --host 0.0.0.0 --port 8443 --ssl-keyfile $key --ssl-certfile $cert
    }
    else {
        Write-Host "[holoairdesk] app on http://localhost:$appPort"
        & $python -m uvicorn server.main:app --host 127.0.0.1 --port $appPort
    }
}
finally {
    Write-Host '[holoairdesk] shutting down'
    if ($whisperProcess -and -not $whisperProcess.HasExited) { Stop-Process -Id $whisperProcess.Id -Force -ErrorAction SilentlyContinue }
    if ($llamaProcess -and -not $llamaProcess.HasExited) { Stop-Process -Id $llamaProcess.Id -Force -ErrorAction SilentlyContinue }
}
