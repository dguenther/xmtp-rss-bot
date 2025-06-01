# TODO: Use the Bun image and Dockerfile from https://bun.sh/guides/ecosystem/docker

FROM ubuntu:latest
WORKDIR /app
RUN apt update && apt install -y unzip curl
RUN curl -fsSL https://bun.sh/install | bash
COPY . .
RUN /root/.bun/bin/bun install

ENTRYPOINT [ "/root/.bun/bin/bun", "run", "index.ts" ]