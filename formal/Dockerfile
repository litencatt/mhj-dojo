# Lean 4 toolchain for the formal model. Nothing is installed on the host:
# elan, the toolchain and mathlib live in this image and in named volumes
# (see run.sh and README.md).
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git \
 && rm -rf /var/lib/apt/lists/*

ENV ELAN_HOME=/root/.elan
ENV PATH=/root/.elan/bin:$PATH
RUN curl -sSfL https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh \
    | sh -s -- --default-toolchain none -y

WORKDIR /work/formal
