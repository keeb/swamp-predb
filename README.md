# @keeb/predb

Swamp model for the [PreDB.net API](https://predb.net/api-documentation/), a
public record of scene releases: when each release was pre'd, by which group,
its size and file count, and whether it was nuked.

PreDB records release names and metadata only. It does not host or link any
content.

## Model: `@keeb/predb`

| Method            | What it does                                                                                                     | Resource (instance name)                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `search`          | Prefix search plus `group`/`section`/`genre`/`tag`/`status` filters. With no filters it returns the latest pres. | `releases` (`search-<filters>` or `search-latest`) |
| `pre`             | Exact lookup of one release name                                                                                 | `release` (`release-<name>`)                       |
| `nfo`             | NFO and NFO-image URLs, plus the NFO text                                                                        | `nfo` (`nfo-<name>`)                               |
| `stats`           | `general`, `nuked`, `unnuked`, `group`, or `section` statistics                                                  | `stats` (`stats-<kind>[-<target>]`)                |
| `season_coverage` | Every release for one show season, grouped into per-group variants, with complete and missing episodes for each  | `coverage` (`coverage-<show>-s<NN>`)               |

Each release is parsed into show, season, episodes, resolution, source, codec,
HDR/DV tags, language tags (`foreign` is true when any are present), and flags
(PROPER, REPACK, FINAL, …).

### Season coverage

A **variant** is one group plus one set of language, resolution, source, codec,
and HDR tags, for example `ETHEL 1080p WEB H264` or
`UKDTV MULTI 1080p WEB H264`. A variant is `complete` when its live releases
cover episodes 1..N. Nuked and delpre'd releases don't count; they're listed
under `nuked` with the reason. A season pack covers every episode.

N comes from, in order:

1. `episodeCount` argument
2. the episode tagged `FiNAL`
3. the highest episode seen (`episodeCountSource: max-seen`); the season may
   still be airing

```sh
swamp model method run predb season_coverage --input show='Criminal Minds' --input season=19
swamp data query 'modelName == "predb" && name == "coverage-criminal-minds-s19"' \
  --select 'attributes.variants.filter(v, v.complete && !v.foreign).map(v, v.label)'
```

### Other examples

```sh
# Latest pres from one group (the group page / RSS feed equivalent)
swamp model method run predb search --input group=ETHEL --input limit=50

# Is this release nuked?
swamp model method run predb pre --input release=Criminal.Minds.S19E09.1080p.WEB.h264-ETHEL

# How active is a group?
swamp model method run predb stats --input kind=group --input target=ETHEL
```

## Rate limit

The API allows 30 requests per 60s. Paged requests are spaced 2.1s apart, and a
429 response waits 60s before retrying.
