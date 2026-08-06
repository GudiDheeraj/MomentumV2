# NOTE: build context must be the project ROOT (not this folder), since this
# needs the root .env and generate_frontend_env.py to build frontend/env.js.
#   docker build -f frontend/Dockerfile -t momentum-frontend .
# (docker-compose.yml already does this correctly — see project root.)
#
# This used to be `python -m http.server`, which is a development convenience
# rather than a web server: single-threaded, no compression, no cache headers.
# It was shipping 2.1MB of uncompressed JavaScript and CSS one request at a
# time. nginx serves the same files gzipped (~558KB) and in parallel — see
# nginx.conf, which explains each directive.
#
# python3 is still here because env.js is regenerated from the root .env on
# every container start, so editing .env and restarting remains all that's
# needed with no rebuild. generate_frontend_env.py falls back to a stdlib .env
# parser when python-dotenv is absent, so this needs no pip install.
FROM nginx:1.27-alpine

RUN apk add --no-cache python3

WORKDIR /app

COPY frontend/ ./frontend
COPY generate_frontend_env.py .
COPY .env ./

COPY frontend/nginx.conf /etc/nginx/nginx.conf

EXPOSE 5173

# Regenerate env.js from .env, then hand off to nginx in the foreground.
# `exec` matters: it makes nginx PID 1 so `docker stop` reaches it and the
# container shuts down promptly instead of waiting out the kill timeout.
CMD ["sh", "-c", "python3 /app/generate_frontend_env.py && exec nginx -g 'daemon off;'"]
