# Supply a tested Node >=22.18 image by digest at build time.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /app
COPY supabase/functions/_shared /app/supabase/functions/_shared
COPY scripts/whatsapp-worker.mjs /app/scripts/whatsapp-worker.mjs
USER node
CMD ["node", "scripts/whatsapp-worker.mjs"]
