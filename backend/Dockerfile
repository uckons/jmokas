FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --only=production

COPY . .

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 5700

# Run migrations then start server
CMD ["sh", "-c", "node db/migrate.js && node db/seed.js && node server.js"]
