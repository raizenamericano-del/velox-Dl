# Fallback for PaaS providers that use a buildpack instead of the Dockerfile
# (Heroku, Render, Fly.io, or Railway with the Node buildpack selected).
#
# NOTE: with a buildpack there is no apt/pip, so yt-dlp is installed by
# scripts/ensure-ytdlp.js during `npm install` (standalone binary → ./vendor).
web: node server/index.js
