FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 5173

# "npm run dev" calls vite, and vite.config.ts sets host: '0.0.0.0'
# so the dev server binds to all interfaces inside the container.
CMD ["npm", "run", "dev"]
