# syntax=docker/dockerfile:1
# Go backend + React/Vite frontend embedded in the binary (templates/app-web). Multi-arch via buildx.
FROM --platform=$BUILDPLATFORM node:24.22-alpine3.24 AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.26-alpine3.24 AS build
ARG TARGETOS TARGETARCH
ARG VERSION=1.1.0
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
COPY --from=web /web/dist ./web/dist
# distroless has no shell: create /data here, the runtime stage copies it with nonroot ownership
RUN mkdir /data && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/app ./cmd/app

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/app /app
COPY --from=build --chown=65532:65532 /data /data
ENV PORT=8080
EXPOSE 8080
VOLUME ["/data"]
USER nonroot:nonroot
# `app healthcheck` GETs http://127.0.0.1:$PORT/healthz and exits non-zero on failure
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD ["/app", "healthcheck"]
ENTRYPOINT ["/app"]
