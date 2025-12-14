FROM node:20-alpine

WORKDIR /app

# 1. Setup Shared
COPY shared ./shared
WORKDIR /app/shared
# Install all dependencies (dev included) because we need tsc
RUN npm install
RUN npm run build

# 2. Setup Frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
# Install all dependencies (including devDeps for ts-node)
RUN npm install

# Copy source code
COPY frontend ./

# Generate Prisma Client
RUN npx prisma generate

# Build Next.js
RUN npm run build

EXPOSE 3000

# Start application (using ts-node as per package.json 'start')
CMD ["npm", "start"]
