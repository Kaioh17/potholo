FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Vite bakes these into the bundle at build time.
ARG VITE_API_URL=https://api-potholo.usemaison.io
ARG VITE_STADIA_API_KEY
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_STADIA_API_KEY=$VITE_STADIA_API_KEY
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8840
