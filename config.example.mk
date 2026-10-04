# Copy this file to config.mk and fill in your values. `config.mk` is loaded
# by the Makefile and is used by the `release` target.
#
# AMO credentials: addons.mozilla.org -> Developer Hub -> API Keys
WEB_EXT_API_KEY    ?= user:00000000:0
WEB_EXT_API_SECRET ?= replace-with-your-jwt-secret
#
# HTTPS base URL where you host the signed .xpi files (Firefox requires HTTPS
# for update manifests; the update_link may be HTTP only if update_hash is set).
DOWNLOAD_BASE_URL  ?= https://example.com/youtube-audio-only
#
# HTTPS URL of the generated, hosted updates.json
# (usually DOWNLOAD_BASE_URL + /updates.json)
UPDATE_URL         ?= https://example.com/youtube-audio-only/updates.json
#
# Where `make release` copies the signed xpi + updates.json
DEPLOY_DIR         ?= /root/dufs/youtube-audio-only

export WEB_EXT_API_KEY WEB_EXT_API_SECRET DOWNLOAD_BASE_URL UPDATE_URL DEPLOY_DIR
