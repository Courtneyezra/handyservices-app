# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the application
ARG VITE_GOOGLE_MAPS_API_KEY
ARG VITE_GOOGLE_MAPS_API_KEY
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY

ARG VITE_STRIPE_PUBLIC_KEY
ENV VITE_STRIPE_PUBLIC_KEY=$VITE_STRIPE_PUBLIC_KEY

ARG VITE_STRIPE_TEST_PUBLIC_KEY
ENV VITE_STRIPE_TEST_PUBLIC_KEY=$VITE_STRIPE_TEST_PUBLIC_KEY
RUN npm run build

# Production stage
FROM node:20-slim AS runner

WORKDIR /app

# Copy production files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5001

# Expose port
EXPOSE 5001

# Run the app
CMD ["npm", "start"]
