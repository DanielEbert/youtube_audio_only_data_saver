# Makefile - YouTube Audio Only (Data Saver)
#
#   make          build the package and copy it to /root/dufs
#   make build    package into dist/*.zip and dist/*.xpi
#   make cp       copy built packages to /root/dufs
#   make lint     run web-ext lint
#   make test     run the player-response filter unit tests
#   make release  bump + sign (unlisted) + generate updates.json + deploy
#   make clean    remove build artifacts
#
# `make release` reads settings from config.mk (copy config.example.mk).

EXT_DIR  := youtube-audio-only
DIST_DIR := dist
DEST_DIR := /root/dufs
NAME     := youtube-audio-only
VERSION  := $(shell jq -r .version $(EXT_DIR)/manifest.json 2>/dev/null)
SOURCES  := $(shell find $(EXT_DIR) -type f)
ZIP      := $(DIST_DIR)/$(NAME).zip
XPI      := $(DIST_DIR)/$(NAME).xpi

-include config.mk

BUMP ?= patch

.PHONY: all build cp lint test sign release release-version release-dry clean help

all: build cp

build: $(ZIP) $(XPI)

$(ZIP): $(SOURCES)
	@mkdir -p $(DIST_DIR)
	@rm -f $@
	@cd $(EXT_DIR) && zip -r -X ../$@ . >/dev/null
	@echo "built $@ (v$(VERSION))"

$(XPI): $(ZIP)
	@cp $(ZIP) $(XPI)
	@echo "built $@ (v$(VERSION))"

cp: build
	@mkdir -p $(DEST_DIR)
	@cp $(ZIP) $(XPI) $(DEST_DIR)/
	@echo "copied $(ZIP) $(XPI) -> $(DEST_DIR)/"

lint:
	@npx --yes web-ext@latest lint --source-dir $(EXT_DIR)

test:
	@node test/inject.test.js

# sign the current source without bumping (legacy convenience target)
sign: build
	@npx --yes web-ext@latest sign --source-dir $(EXT_DIR) \
		--channel unlisted --artifacts-dir $(DIST_DIR) --no-input

# full release: version bump + sign + updates.json + deploy
release:
	@python3 scripts/release.py --bump $(BUMP)

release-version:
	@test -n "$(NEW_VERSION)" || (echo "usage: make release-version NEW_VERSION=1.3"; exit 1)
	@python3 scripts/release.py --version $(NEW_VERSION)

# tooling test: no AMO signing, validates staging/updates.json/deploy
release-dry:
	@python3 scripts/release.py --bump $(BUMP) --dry-run

clean:
	@rm -rf $(DIST_DIR) web-ext-artifacts build release
	@echo "cleaned"

help:
	@grep -E '^#   ' $(MAKEFILE_LIST) | sed 's/^#   //'
