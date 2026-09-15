# ==============================================================================
# Stage 1: Build & Release (Debian Bookworm)
# ==============================================================================
FROM hexpm/elixir:1.20.4-erlang-29.0.6-debian-bookworm-20240130-slim AS builder

WORKDIR /app

# Install compilation essentials
RUN apt-get update -y && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    ca-certificates \
    && apt-get clean && rm -f /var/lib/apt/lists/*_*

# Install hex and rebar
RUN mix local.hex --force && \
    mix local.rebar --force

ENV MIX_ENV=prod

# Cache and compile dependencies
COPY mix.exs mix.lock* ./
RUN mix deps.get --only prod
RUN mix deps.compile

# Copy application code and config
COPY config config
COPY lib lib

# Compile application and assemble self-contained release
RUN mix compile
RUN mix release nexus_socket --overwrite

# ==============================================================================
# Stage 2: Minimal Production Runtime
# ==============================================================================
FROM debian:bookworm-20240130-slim AS runner

WORKDIR /app

# Install runtime libraries required by Erlang VM
RUN apt-get update -y && apt-get install -y --no-install-recommends \
    libstdc++6 \
    openssl \
    libncurses5 \
    locales \
    ca-certificates \
    curl \
    && apt-get clean && rm -f /var/lib/apt/lists/*_*

# Set UTF-8 locale
RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8

# Create non-root system user and group (Principle of Least Privilege)
RUN groupadd -g 10001 nexus && \
    useradd -u 10001 -g nexus -s /bin/sh -m -d /app nexus

# Copy release artifact with proper non-root ownership
COPY --from=builder --chown=nexus:nexus /app/_build/prod/rel/nexus_socket ./

# Runtime environment
ENV MIX_ENV=prod
ENV PORT=3001
ENV RELEASE_DISTRIBUTION=none
ENV HOME=/app

USER 10001:10001

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

ENTRYPOINT ["/app/bin/nexus_socket"]
CMD ["start"]
