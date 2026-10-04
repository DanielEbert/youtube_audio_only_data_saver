# YouTube Audio Only (Data Saver)

A Firefox extension that streams audio only on YouTube by blocking video
streams, saving mobile data and battery. Toggle it on/off from the toolbar
popup.

## Layout

- `youtube-audio-only/` – extension source (`manifest.json`, content/background scripts, popup)
- `scripts/release.js` – version bump, AMO signing, update manifest, deploy
- `test/` – background request-filter unit tests

## Commands

```sh
make            # build package and copy to /root/dufs
make build      # package into dist/*.zip and dist/*.xpi
make lint       # run web-ext lint
make test       # run unit tests
make clean      # remove build artifacts
```

## Releasing

Copy `config.example.mk` to `config.mk`, fill in your AMO API keys and hosting
URLs, then run:

```sh
make release            # bump patch and publish
make release BUMP=minor # bump minor
```

`config.mk` holds secrets and is git-ignored.
