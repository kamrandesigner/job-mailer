FROM node:18-alpine

# Install build tools for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY . .

# Create data directory for SQLite database
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "backend/server.js"]
