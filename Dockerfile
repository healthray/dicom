# syntax=docker/dockerfile:1.7-labs
# This dockerfile is used to publish the `ohif/app` image on dockerhub.
#
# It's a good example of how to build our static application and package it
# with a web server capable of hosting it as static content.
#
# docker build
# --------------
# If you would like to use this dockerfile to build and tag an image, make sure
# you set the context to the project's root directory:
# https://docs.docker.com/engine/reference/commandline/build/
#
#
# SUMMARY
# --------------
# This dockerfile has two stages:
#
# 1. Building the React application for production
# 2. Setting up our Nginx (Alpine Linux) image w/ step one's output
#


# Stage 1: Build the application
# docker build -t ohif/viewer:latest .
# Copy Files
FROM node:24.15.0-slim as builder

RUN apt-get update && apt-get install -y --no-install-recommends build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11

RUN mkdir /usr/src/app
WORKDIR /usr/src/app
ENV PATH=/usr/src/app/node_modules/.bin:$PATH

# Copy package manifests for install caching. preinstall.js is included because
# the root package.json's "preinstall" lifecycle script (node preinstall.js)
# runs during `pnpm install` below -- before the full source is copied -- so the
# script file must already be present or install fails with MODULE_NOT_FOUND.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc preinstall.js ./
COPY --parents ./extensions/*/package.json ./modes/*/package.json ./platform/*/package.json ./
# Run the install before copying the rest of the files.
# Keep --no-frozen-lockfile here (unlike CI): .dockerignore excludes
# platform/docs, so the lockfile's docs importer has no manifest in the build
# context and a frozen install would fail. pnpm reconciles (drops docs) instead.
RUN pnpm install --no-frozen-lockfile
# Copy the local directory
COPY --link --exclude=pnpm-lock.yaml --exclude=package.json --exclude=Dockerfile . .

# Build here
# After install it should hopefully be stable until the local directory changes
#
# QUICK_BUILD skips minification (and source maps). It is a fast-iteration
# switch, not a production one: with it on, the image ships an unminified,
# readable bundle. Left off here so the published image is minified. Override
# with --build-arg QUICK_BUILD=true for a throwaway local image.
ARG QUICK_BUILD=false
ENV QUICK_BUILD=${QUICK_BUILD}
# With QUICK_BUILD off, the production devtool ('source-map') applies again, so
# opt out explicitly rather than serving application source from the web root.
ARG GENERATE_SOURCEMAP=false
ENV GENERATE_SOURCEMAP=${GENERATE_SOURCEMAP}
# The ENV is what actually reaches webpack. Without it `--build-arg APP_CONFIG`
# is silently ignored and the build falls back to webpack's own default
# (config/default.js for a production build) -- which matched the ARG default,
# so the setting looked like it worked while doing nothing.
ARG APP_CONFIG=config/default.js
ENV APP_CONFIG=${APP_CONFIG}
ARG PUBLIC_URL=/
ENV PUBLIC_URL=${PUBLIC_URL}

RUN pnpm run show:config
# NOTE: the version/commit stamped into the bundle comes from the committed
# version.txt and commit.txt. `version.mjs` cannot regenerate them here because
# .dockerignore excludes .git, so a stale commit.txt silently ships an image
# that misreports which build it is. Run `pnpm run version:custom` on the host
# BEFORE `docker build`.
RUN pnpm run build

# Precompress files
RUN chmod u+x .docker/compressDist.sh
RUN ./.docker/compressDist.sh

# Stage 2: Bundle the built application into a Docker container
# which runs Nginx using Alpine Linux
FROM nginxinc/nginx-unprivileged:1.27-alpine as final
#RUN apk add --no-cache bash
ARG PUBLIC_URL=/
ENV PUBLIC_URL=${PUBLIC_URL}
ARG PORT=80
ENV PORT=${PORT}
RUN rm /etc/nginx/conf.d/default.conf
USER nginx
COPY --chown=nginx:nginx .docker/Viewer-v3.x /usr/src
RUN chmod 755 /usr/src/entrypoint.sh
COPY --from=builder /usr/src/app/platform/app/dist /usr/share/nginx/html${PUBLIC_URL}
# Copy paths that are renamed/redirected generally
# Microscopy libraries depend on root level include, so must be copied
COPY --from=builder /usr/src/app/platform/app/dist/dicom-microscopy-viewer /usr/share/nginx/html/dicom-microscopy-viewer

# entrypoint.sh rewrites app-config.js, so the web root must be writeable by the
# nginx user. Ownership is what grants that -- 777 additionally made every
# served file world-writable, which would let any other process in the container
# rewrite the application. 755/644 keeps owner write and drops the rest.
USER root
RUN chown -R nginx:nginx /usr/share/nginx/html \
    && find /usr/share/nginx/html -type d -exec chmod 755 {} + \
    && find /usr/share/nginx/html -type f -exec chmod 644 {} +
USER nginx
ENTRYPOINT ["/usr/src/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
