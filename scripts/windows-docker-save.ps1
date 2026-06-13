param(
  [string] $Output = "nori-video-windows.tar"
)

$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

if (!(Test-Path ".env.docker")) {
  Copy-Item ".env.docker.example" ".env.docker"
  Write-Host "Created .env.docker from .env.docker.example."
}

docker compose -f docker-compose.windows.yml --env-file .env.docker build
docker save nori-video:windows -o $Output

Write-Host "Saved Docker image to $Output"
