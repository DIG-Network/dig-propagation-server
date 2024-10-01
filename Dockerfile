# syntax=docker/dockerfile:1.4

# Use an official Ubuntu base image with platform support
FROM --platform=$TARGETPLATFORM ubuntu:20.04

# Set environment variables for non-interactive installs
ENV DEBIAN_FRONTEND=noninteractive

# Set the working directory inside the container
WORKDIR /app

# Set build arguments for architecture
ARG TARGETARCH

# Preconfigure tzdata to prevent interactive prompt
RUN ln -fs /usr/share/zoneinfo/Etc/UTC /etc/localtime && \
    echo "Etc/UTC" > /etc/timezone

# Install curl, build-essential, and other dependencies, including tzdata
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    libsecret-1-dev \
    pkg-config \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20
RUN NODE_VERSION=20.8.0 \
    && if [ "$TARGETARCH" = "arm64" ]; then \
        ARCH="arm64"; \
    elif [ "$TARGETARCH" = "amd64" ]; then \
        ARCH="x64"; \
    else \
        echo "Unsupported architecture: $TARGETARCH"; exit 1; \
    fi \
    && wget https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$ARCH.tar.xz \
    && tar -xf node-v$NODE_VERSION-linux-$ARCH.tar.xz -C /usr/local --strip-components=1 \
    && rm node-v$NODE_VERSION-linux-$ARCH.tar.xz \
    && npm install -g npm@latest

# Copy the current directory contents into the container at /app
COPY . .

# Install any needed packages specified in package.json
RUN npm install

# Install architecture-specific datalayer driver
RUN if [ "$TARGETARCH" = "arm64" ]; then \
        npm install @dignetwork/datalayer-driver-linux-arm64-gnu; \
    elif [ "$TARGETARCH" = "amd64" ]; then \
        npm install @dignetwork/datalayer-driver-linux-x64-gnu; \
    else \
        echo "Unsupported architecture: $TARGETARCH"; exit 1; \
    fi

# Build the application
RUN npm run build

# Rebuild any native modules for the current environment
RUN npm rebuild

# Expose the port the app runs on
EXPOSE 4159

# Run the application
CMD ["node", "dist/cluster.js"]
