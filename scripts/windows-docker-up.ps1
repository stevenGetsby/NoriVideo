param(
  [switch] $Build = $true
)

$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

if (!(Test-Path ".env.docker")) {
  Copy-Item ".env.docker.example" ".env.docker"
  Write-Host "Created .env.docker from .env.docker.example. Review provider keys before production use."
}

$args = @("compose", "-f", "docker-compose.windows.yml", "--env-file", ".env.docker", "up", "-d")
if ($Build) {
  $args += "--build"
}

docker @args

Write-Host ""
Write-Host "NoriVideo: http://localhost:13000"
Write-Host "Queue board: http://localhost:13010/admin/queues"
Write-Host "MinIO console: http://localhost:19001"
