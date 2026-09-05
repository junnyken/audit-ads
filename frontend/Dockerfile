FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=/
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
# A TEMPLATE, not a finished config: the official nginx image runs envsubst over
# /etc/nginx/templates/*.template at container start, so API_ORIGIN is resolved when the
# container runs rather than when the image is built. The API's address is not known at build
# time on a platform that assigns subdomains.
COPY default.conf.template /etc/nginx/templates/default.conf.template
# Same origin unless a deployment says otherwise, so the compose stack needs no extra setting.
ENV API_ORIGIN=""
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost/ >/dev/null || exit 1
