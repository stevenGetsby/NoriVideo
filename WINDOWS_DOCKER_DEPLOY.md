# Windows Docker Deployment

This package runs NoriVideo on Windows through Docker Desktop Linux containers.

## Prerequisites

- Docker Desktop for Windows
- WSL 2 backend enabled in Docker Desktop
- At least 8 GB memory assigned to Docker Desktop, 12 GB recommended

## First Run

From PowerShell in the project directory:

```powershell
Copy-Item .env.docker.example .env.docker
docker compose -f docker-compose.windows.yml --env-file .env.docker up --build -d
```

The default target platform is `linux/amd64`, which matches normal Windows Docker Desktop machines.

If Docker Hub is slow or blocked, set `NORI_NODE_IMAGE` in `.env.docker` to an accessible mirror image that provides `node:22-bookworm-slim`.

Shortcut:

```powershell
.\scripts\windows-docker-up.ps1
```

To export the built application image:

```powershell
.\scripts\windows-docker-save.ps1
```

Open:

- App: http://localhost:13000
- Queue board: http://localhost:13010/admin/queues
- MinIO console: http://localhost:19001

## Useful Commands

```powershell
docker compose -f docker-compose.windows.yml --env-file .env.docker ps
docker compose -f docker-compose.windows.yml --env-file .env.docker logs -f web
docker compose -f docker-compose.windows.yml --env-file .env.docker logs -f worker
docker compose -f docker-compose.windows.yml --env-file .env.docker restart web worker
docker compose -f docker-compose.windows.yml --env-file .env.docker down
```

## Storage Note

The default Windows compose uses MinIO for local object storage.
Some image/video providers cannot fetch `localhost` MinIO URLs from outside your machine. For real provider workflows, set:

```env
NORI_STORAGE_TYPE=tos
TOS_BUCKET=...
TOS_ACCESS_KEY=...
TOS_SECRET_KEY=...
```

Then restart:

```powershell
docker compose -f docker-compose.windows.yml --env-file .env.docker up -d
```

## Persistent Data

- MySQL data: Docker named volume `nori-video_mysql_data`
- Redis data: Docker named volume `nori-video_redis_data`
- MinIO data: Docker named volume `nori-video_minio_data`
- App uploads: `./docker-data`
- Downloads: `./downloads`
- Logs: `./docker-logs`
