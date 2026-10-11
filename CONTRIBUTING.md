# Contributing

Thanks for helping. Bug reports, fixes and improvements are welcome.

## Before you open a pull request

- Run `npm run lint` and `npm test` (type-check, build and the test suite). CI runs the same.
- Keep each pull request to one change, with a short note on what a user would see differently.
- Don't add deal, restaurant or location data here. The catalog is maintained separately through
  Radar's review and verification process; suggest a deal at radar.cheap instead.

## How a change reaches this repository

This repository is published from the copy of the code radar.cheap runs from, and every update
replaces its contents. So an accepted pull request is applied there and arrives here with the next
update; the pull request itself is then closed, with a note saying so, rather than merged.

## Licensing of contributions

Radar is licensed under the GNU AGPL v3.0. Radar's operator also runs the service from a private
copy of this code. So that a contribution can go into both, we'll ask you to sign a short
Contributor License Agreement before your first pull request is merged. You keep the copyright in
what you write.

## Security

Please don't open public issues for security problems. See [SECURITY.md](SECURITY.md).
