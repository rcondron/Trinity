FROM node:22-slim

WORKDIR /app
RUN corepack enable

# Workspace manifests first for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/protocol/package.json packages/protocol/
COPY services/orchestrator/package.json services/orchestrator/

RUN pnpm install --filter @trinity-avatar/orchestrator... --prod=false

COPY packages/protocol packages/protocol
COPY services/orchestrator services/orchestrator

ENV ORCHESTRATOR_PORT=8790
EXPOSE 8790

WORKDIR /app/services/orchestrator
CMD ["pnpm", "start"]
