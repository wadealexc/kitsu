FROM node:22-alpine

WORKDIR /app

# Install git (needed by svelte.config.js for version resolution)
RUN apk add --no-cache git

# Install dependencies first (cached layer)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source (will be overridden by bind mount in compose)
COPY . .

EXPOSE 5050

CMD ["npm", "run", "dev"]
