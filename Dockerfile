FROM node:20

WORKDIR /app

COPY package*.json ./
COPY .env .env
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "app.js"]
