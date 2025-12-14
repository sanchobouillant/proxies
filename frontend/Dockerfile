# On remplace alpine par slim (basé sur Debian)
# C'est beaucoup plus compatible avec Prisma et OpenSSL
FROM node:22-slim

WORKDIR /app

# Sur Debian/Slim, on utilise apt-get au lieu de apk.
# On installe openssl pour être sûr (libc6 est déjà inclus dans Debian)
RUN apt-get update -y && apt-get install -y openssl

# Install tsx globally for Prisma Config loading
RUN npm install -g tsx


# 1. Setup Shared
COPY shared ./shared
WORKDIR /app/shared
RUN npm install
RUN npm run build

# 2. Setup Frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm install

# Copy source code
COPY frontend ./

# Generate Prisma Client
# IMPORTANT : Avec cette image, Prisma va télécharger le moteur "debian-openssl-..."
# Assure-toi que ton schema.prisma a "native" ou pas de binaryTargets spécifique.
# Set dummy env for build time validation (no connection made during generate)
ENV DATABASE_URL="mysql://proxy_user:securepassword@db:3306/proxy_farm"
RUN npx prisma generate

# Build Next.js
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
